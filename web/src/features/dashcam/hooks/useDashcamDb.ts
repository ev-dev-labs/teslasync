import { useMemo } from 'react';
import { createDashcamDb, type DashcamDbHandle } from '../lib/db';

/**
 * Lazily creates (once per browser tab) and returns the storage backend
 * for the dashcam feature. A module-level singleton is used — rather than
 * one instance per mounted component — so every hook/component in the
 * feature reads and writes the same underlying clip catalog.
 */
let singleton: DashcamDbHandle | null = null;
function getDashcamDbHandle(): DashcamDbHandle {
  if (!singleton) singleton = createDashcamDb();
  return singleton;
}

/**
 * Resets the module-level singleton. Test-only escape hatch so each test
 * file gets an isolated in-memory database instead of leaking clips across
 * test files that import the real hook.
 */
export function __resetDashcamDbForTests(): void {
  singleton = null;
}

export function useDashcamDb(): DashcamDbHandle {
  // The handle itself is a stable module-level singleton; `useMemo` here
  // just avoids re-reading the module binding on every render.
  return useMemo(() => getDashcamDbHandle(), []);
}
