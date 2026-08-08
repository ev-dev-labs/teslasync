import { describe, it, expect } from 'vitest';
import { isIndexedDbAvailable, createIndexedDbDashcamDb } from '../lib/db/indexedDbAdapter';
import { createDashcamDb } from '../lib/db';

/**
 * jsdom (this project's vitest environment) does NOT implement IndexedDB —
 * `typeof indexedDB === 'undefined'` is genuinely true here, with no mocking
 * required. This lets us assert the "fail explicitly when a browser API is
 * unavailable" contract for real rather than simulating it.
 */
describe('IndexedDB availability (real jsdom environment)', () => {
  it('isIndexedDbAvailable() is false under jsdom', () => {
    expect(isIndexedDbAvailable()).toBe(false);
  });

  it('createIndexedDbDashcamDb() throws a descriptive error instead of silently degrading', () => {
    expect(() => createIndexedDbDashcamDb()).toThrow(/IndexedDB is not available/);
  });

  it('createDashcamDb() falls back to the memory adapter and reports non-persistent with a reason', () => {
    const handle = createDashcamDb();
    expect(handle.persistent).toBe(false);
    expect(handle.fallbackReason).toMatch(/IndexedDB is not available/);
  });

  it('the fallback memory db is still fully functional for the current session', async () => {
    const handle = createDashcamDb();
    expect(await handle.db.listClips()).toEqual([]);
    const settings = await handle.db.getSettings();
    expect(settings.reconstructionPreRollSeconds).toBeGreaterThan(0);
  });
});
