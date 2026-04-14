// ══════════════════════════════════════════════════════════════════════════
// OKX Bot Monitor — local web dashboard server
// ══════════════════════════════════════════════════════════════════════════
// Reads the bot's journal.jsonl from $OKX_STATE_DIR, keeps an in-memory ring
// buffer of recent events, and exposes:
//
//   GET /                      → index.html (Preact dashboard)
//   GET /app.js                → frontend bundle
//   GET /app.css               → styles
//   GET /api/latest            → most recent cycle_snapshot
//   GET /api/snapshots         → ?limit=50&bot=main|lab — recent snapshots
//   GET /api/closes            → ?limit=50 — recent closed trades
//   GET /api/stats             → backend health / journal path / event count
//   GET /events                → Server-Sent Events stream of new journal lines
//
// Zero dependencies — pure Node.js built-ins. Tail is implemented by polling
// the file size every 1s and reading only the new bytes since last check.
// ══════════════════════════════════════════════════════════════════════════

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.OKX_STATE_DIR
  || path.resolve(__dirname, '..', 'okx-state');
const JOURNAL_PATH = path.join(STATE_DIR, 'journal.jsonl');
const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_EVENTS = parseInt(process.env.MAX_EVENTS || '5000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);

// ── Ring buffer of parsed events ────────────────────────────────────────────
const events = [];
let fileSize = 0;

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function pushEvent(parsed) {
  if (!parsed) return;
  events.push(parsed);
  if (events.length > MAX_EVENTS) events.shift();
}

function loadInitial() {
  if (!fs.existsSync(JOURNAL_PATH)) {
    console.log(`[ui] Journal not found at ${JOURNAL_PATH} — waiting for first write`);
    fileSize = 0;
    return;
  }
  const data = fs.readFileSync(JOURNAL_PATH, 'utf-8');
  fileSize = Buffer.byteLength(data);
  const lines = data.split('\n').filter(Boolean);
  const recent = lines.slice(-MAX_EVENTS);
  for (const line of recent) pushEvent(parseLine(line));
  console.log(`[ui] Loaded ${events.length} events from ${JOURNAL_PATH}`);
}

function pollFile() {
  try {
    if (!fs.existsSync(JOURNAL_PATH)) {
      if (fileSize !== 0) {
        console.log('[ui] Journal disappeared; resetting buffer');
        events.length = 0;
        fileSize = 0;
      }
      return;
    }
    const stat = fs.statSync(JOURNAL_PATH);
    if (stat.size === fileSize) return;
    if (stat.size < fileSize) {
      // Truncated or rotated — reload from scratch
      console.log('[ui] Journal shrunk (rotation?); reloading');
      events.length = 0;
      fileSize = 0;
      loadInitial();
      // Re-broadcast latest snapshot so clients re-render
      const latest = getLatestSnapshot();
      if (latest) broadcast(latest);
      return;
    }
    const fd = fs.openSync(JOURNAL_PATH, 'r');
    try {
      const buf = Buffer.alloc(stat.size - fileSize);
      fs.readSync(fd, buf, 0, buf.length, fileSize);
      fileSize = stat.size;
      const newLines = buf.toString('utf-8').split('\n').filter(Boolean);
      for (const line of newLines) {
        const parsed = parseLine(line);
        if (parsed) {
          pushEvent(parsed);
          broadcast(parsed);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    console.error('[ui] poll error:', e.message);
  }
}

// ── Accessors ───────────────────────────────────────────────────────────────
function getLatestSnapshot(bot = null) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'cycle_snapshot' && (!bot || ev.bot === bot)) return ev;
  }
  return null;
}

function getRecentSnapshots(limit, bot) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = events[i];
    if (ev.type === 'cycle_snapshot' && (!bot || ev.bot === bot)) out.push(ev);
  }
  return out.reverse();
}

function getRecentCloses(limit) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    if (events[i].type === 'close') out.push(events[i]);
  }
  return out.reverse();
}

function getRecentOpens(limit) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    if (events[i].type === 'open') out.push(events[i]);
  }
  return out.reverse();
}

// ── SSE ─────────────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event) {
  // Only stream the event types dashboard cares about
  if (!event || !event.type) return;
  if (!['cycle_snapshot', 'open', 'close', 'reasoning', 'scan'].includes(event.type)) return;
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  const hb = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(hb);
      sseClients.delete(res);
    }
  }, 30000);
  req.on('close', () => {
    clearInterval(hb);
    sseClients.delete(res);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(res, urlPath) {
  const publicDir = path.join(__dirname, 'public');
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const full = path.join(publicDir, rel);
  if (!full.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

// ── Request router ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/events') return handleSSE(req, res);

  if (p === '/api/latest') {
    const bot = url.searchParams.get('bot');
    return sendJson(res, getLatestSnapshot(bot));
  }
  if (p === '/api/snapshots') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), MAX_EVENTS);
    const bot = url.searchParams.get('bot');
    return sendJson(res, getRecentSnapshots(limit, bot));
  }
  if (p === '/api/closes') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
    return sendJson(res, getRecentCloses(limit));
  }
  if (p === '/api/opens') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
    return sendJson(res, getRecentOpens(limit));
  }
  if (p === '/api/stats') {
    const last = events.length ? events[events.length - 1] : null;
    return sendJson(res, {
      eventCount: events.length,
      latestTs: last ? (last.ts || last.ts_close || last.ts_open || null) : null,
      latestType: last ? last.type : null,
      sseClients: sseClients.size,
      journalPath: JOURNAL_PATH,
      stateDir: STATE_DIR,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  }

  serveStatic(res, p);
});

// ── Startup ─────────────────────────────────────────────────────────────────
loadInitial();
setInterval(pollFile, POLL_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`[ui] OKX monitor running at http://${HOST}:${PORT}`);
  console.log(`[ui] Tailing: ${JOURNAL_PATH}`);
  console.log(`[ui] Events in buffer: ${events.length}/${MAX_EVENTS}`);
});

process.on('SIGINT', () => {
  console.log('\n[ui] shutting down');
  for (const c of sseClients) {
    try { c.end(); } catch {}
  }
  server.close(() => process.exit(0));
});
