import { createIndexedDbDashcamDb, isIndexedDbAvailable } from './indexedDbAdapter';
import { createMemoryDashcamDb } from './memoryAdapter';
import type { DashcamDb } from './types';

export interface DashcamDbHandle {
  db: DashcamDb;
  /** False when clip storage will NOT survive a page reload (IndexedDB unavailable). */
  persistent: boolean;
  /** Present only when the memory fallback was used, explaining why. */
  fallbackReason?: string;
}

/**
 * Selects the best available storage backend. Real IndexedDB is preferred;
 * the in-memory adapter is used ONLY as an explicit, surfaced fallback so
 * the app still functions (within the current tab session) in a browser
 * or embedded webview that lacks IndexedDB.
 */
export function createDashcamDb(): DashcamDbHandle {
  if (isIndexedDbAvailable()) {
    try {
      return { db: createIndexedDbDashcamDb(), persistent: true };
    } catch (err) {
      return {
        db: createMemoryDashcamDb(),
        persistent: false,
        fallbackReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return {
    db: createMemoryDashcamDb(),
    persistent: false,
    fallbackReason: 'IndexedDB is not available in this browser — clips will not persist after this tab closes.',
  };
}

export type { DashcamDb } from './types';
