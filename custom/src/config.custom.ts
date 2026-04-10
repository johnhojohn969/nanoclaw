/**
 * Custom config extensions — ChromaDB vector memory settings.
 * Imported by memory.ts. Not part of upstream src/config.ts.
 */
import { readEnvFile } from './env.js';

const customEnv = readEnvFile(['CHROMA_URL', 'MEMORY_ENABLED', 'MEMORY_TOP_K']);

export const CHROMA_URL =
  process.env.CHROMA_URL || customEnv.CHROMA_URL || 'http://localhost:8000';
export const MEMORY_ENABLED =
  (process.env.MEMORY_ENABLED ?? customEnv.MEMORY_ENABLED ?? 'true') !== 'false';
export const MEMORY_TOP_K = Math.max(
  1,
  parseInt(process.env.MEMORY_TOP_K || customEnv.MEMORY_TOP_K || '5', 10) || 5,
);
