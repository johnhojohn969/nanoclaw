/**
 * Vector memory layer for NanoClaw using ChromaDB + all-MiniLM-L6-v2.
 *
 * ChromaDB runs as a separate container (custom/docker-compose.chroma.yml).
 * Embeddings are computed locally via @xenova/transformers (CPU-only, ~80MB).
 *
 * All public functions fail silently when ChromaDB is unavailable so the
 * rest of NanoClaw is never blocked by the memory layer.
 */
import path from 'path';

import { ChromaClient, type Collection } from 'chromadb';

import { CHROMA_URL, DATA_DIR, MEMORY_ENABLED, MEMORY_TOP_K } from './config.js';
import { logger } from './logger.js';
import type { NewMessage } from './types.js';

// ── Embedding ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmbedFn = (texts: string[]) => Promise<number[][]>;
let _embedder: Promise<EmbedFn> | null = null;

function getEmbedder(): Promise<EmbedFn> {
  if (!_embedder) {
    _embedder = (async () => {
      // Dynamic import so startup is not blocked when memory is disabled
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { pipeline, env } = (await import('@xenova/transformers')) as any;
      env.cacheDir = path.join(DATA_DIR, 'models');
      const pipe = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { quantized: true },
      );
      return async (texts: string[]): Promise<number[][]> => {
        const out = await pipe(texts, { pooling: 'mean', normalize: true });
        return out.tolist() as number[][];
      };
    })();
  }
  return _embedder;
}

async function embed(texts: string[]): Promise<number[][]> {
  const fn = await getEmbedder();
  return fn(texts);
}

// ── ChromaDB client ────────────────────────────────────────────────────────

let client: ChromaClient | null = null;
let available = false;
let retryTimer: NodeJS.Timeout | null = null;
const colCache = new Map<string, Collection>();

function collectionName(groupFolder: string): string {
  // ChromaDB rules: 3-63 chars, [a-zA-Z0-9._-], no leading/trailing dot or dash
  const raw = `nw_${groupFolder}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return raw.slice(0, 63).padEnd(3, '_');
}

async function getCollection(groupFolder: string): Promise<Collection | null> {
  if (!client || !available) return null;
  const name = collectionName(groupFolder);
  if (colCache.has(name)) return colCache.get(name)!;
  const col = await client.getOrCreateCollection({
    name,
    metadata: { 'hnsw:space': 'cosine' },
  });
  colCache.set(name, col);
  return col;
}

// ── Public API ─────────────────────────────────────────────────────────────

async function tryConnect(): Promise<boolean> {
  try {
    client = new ChromaClient({ path: CHROMA_URL });
    await client.heartbeat();
    available = true;
    colCache.clear();
    logger.info({ url: CHROMA_URL }, 'ChromaDB connected');

    // Warm up embedder in background — downloads model (~80 MB) on first use
    getEmbedder()
      .then((fn) => fn(['warmup']))
      .then(() => logger.info('Embedding model ready (all-MiniLM-L6-v2)'))
      .catch((err: unknown) =>
        logger.warn({ err }, 'Embedding model warmup failed'),
      );
    return true;
  } catch {
    return false;
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    tryConnect().then((ok) => {
      if (ok && retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
    }).catch(() => undefined);
  }, 30_000);
}

/**
 * Connect to ChromaDB and warm up the embedder.
 * Safe to call multiple times; idempotent after the first successful init.
 * If ChromaDB is not reachable, retries every 30s and memory functions become no-ops until then.
 */
export async function initMemory(): Promise<void> {
  if (!MEMORY_ENABLED) {
    logger.info('Vector memory disabled (MEMORY_ENABLED=false)');
    return;
  }
  const ok = await tryConnect();
  if (!ok) {
    logger.warn(
      { url: CHROMA_URL },
      'ChromaDB not reachable — vector memory disabled. ' +
        'Will retry every 30s. Start it with: docker compose -f custom/docker-compose.chroma.yml up -d',
    );
    scheduleRetry();
  }
}

/**
 * Persist a document in a group's vector collection.
 * @param key   Stable unique ID — same key upserts/overwrites
 * @param content  Plain text to embed and store
 * @param metadata  String key/value pairs stored alongside the embedding
 * @param groupFolder  Collection namespace (default: 'global')
 */
export async function saveMemory(
  key: string,
  content: string,
  metadata: Record<string, string>,
  groupFolder = 'global',
): Promise<void> {
  if (!available || !content.trim()) return;
  try {
    const col = await getCollection(groupFolder);
    if (!col) return;
    const embeddings = await embed([content]);
    await col.upsert({
      ids: [key],
      embeddings,
      documents: [content],
      metadatas: [{ ...metadata, groupFolder }],
    });
  } catch (err) {
    logger.warn({ err, key, groupFolder }, 'saveMemory failed');
  }
}

export interface MemoryResult {
  id: string;
  document: string;
  metadata: Record<string, unknown>;
  /** Cosine distance [0=identical, 2=opposite]. Lower = more relevant. */
  distance: number;
}

/**
 * Find the top-K most semantically similar memories to a query.
 * Returns an empty array when ChromaDB is unavailable or the collection is empty.
 */
export async function searchMemory(
  query: string,
  groupFolder = 'global',
  topK = MEMORY_TOP_K,
): Promise<MemoryResult[]> {
  if (!available || !query.trim()) return [];
  try {
    const col = await getCollection(groupFolder);
    if (!col) return [];
    const count = await col.count();
    if (count === 0) return [];

    const embeddings = await embed([query]);
    const results = await col.query({
      queryEmbeddings: embeddings,
      nResults: Math.min(topK, count),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      include: ['documents', 'metadatas', 'distances'] as any,
    });

    const docs = results.documents[0] ?? [];
    const metas = results.metadatas?.[0] ?? [];
    const dists = results.distances?.[0] ?? [];
    const ids = results.ids[0] ?? [];

    return docs
      .map((doc, i) => ({
        id: ids[i] ?? '',
        document: doc ?? '',
        metadata: (metas[i] ?? {}) as Record<string, unknown>,
        distance: dists[i] ?? 1,
      }))
      .filter((r) => r.document);
  } catch (err) {
    logger.warn({ err, query, groupFolder }, 'searchMemory failed');
    return [];
  }
}

/**
 * Persist a typed event (agent success, error, etc.) to vector memory.
 * The event is JSON-stringified and embedded for future semantic retrieval.
 */
export async function saveEvent(
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!available) return;
  const groupFolder = (data.groupFolder as string | undefined) ?? 'global';
  const ts = new Date().toISOString();
  const content = `[${eventType} @ ${ts}] ${JSON.stringify(data)}`;
  const key = `event_${eventType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await saveMemory(key, content, { type: eventType, ts }, groupFolder);
}

/**
 * Save a batch of processed messages as individual memory documents.
 * Only non-bot messages are saved. Call after a successful agent turn.
 */
export async function saveConversationToMemory(
  messages: NewMessage[],
  groupFolder: string,
): Promise<void> {
  if (!available || messages.length === 0) return;
  const MAX_LEN = 400;
  for (const msg of messages) {
    if (msg.is_from_me || msg.is_bot_message) continue;
    const content = `[${msg.sender_name}] ${msg.content}`.slice(0, MAX_LEN);
    if (!content.trim()) continue;
    const key = `msg_${groupFolder}_${msg.timestamp}`;
    await saveMemory(
      key,
      content,
      { type: 'message', ts: msg.timestamp, sender: msg.sender_name },
      groupFolder,
    );
  }
}

/**
 * Build a <memory> XML block to prepend to the agent prompt.
 * Returns an empty string when no relevant results are found.
 *
 * Token budget: top-5 results × ~200 chars ≈ 500 tokens max.
 */
export async function buildMemoryContext(
  query: string,
  groupFolder: string,
): Promise<string> {
  const RELEVANCE_THRESHOLD = 0.7; // cosine distance < 0.7 → similarity > 0.3
  const MAX_DOC_CHARS = 200;

  const results = await searchMemory(query, groupFolder);
  const relevant = results
    .filter((r) => r.distance < RELEVANCE_THRESHOLD)
    .slice(0, MEMORY_TOP_K);

  if (relevant.length === 0) return '';

  const entries = relevant.map((r) => `- ${r.document.slice(0, MAX_DOC_CHARS)}`).join('\n');
  return `<memory>\n${entries}\n</memory>\n`;
}
