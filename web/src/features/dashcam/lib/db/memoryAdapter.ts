import { defaultDashcamSettings, type ClipRecord, type DashcamSettings } from '../types';
import { canChangeRetention, type ClipRetention } from '../clipRetention';
import type { DashcamDb } from './types';

/**
 * In-memory `DashcamDb`. Used by unit tests (no jsdom IndexedDB support)
 * and as an explicit fallback when the real IndexedDB API is unavailable
 * in the current browser context. Data does NOT survive a page reload —
 * callers that fall back to this adapter must surface that limitation to
 * the user rather than silently pretending clips are durable.
 */
export function createMemoryDashcamDb(): DashcamDb {
  const clips = new Map<string, ClipRecord>();
  const retention = new Map<string, ClipRetention>();
  let settings: DashcamSettings = defaultDashcamSettings();

  return {
    async listClips() {
      return Array.from(clips.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getClip(id) {
      return clips.get(id) ?? null;
    },
    async putClip(clip) {
      clips.set(clip.id, clip);
    },
    async deleteClip(id) {
      clips.delete(id);
      for (const [key, plan] of retention) {
        if (plan.clipId === id) retention.delete(key);
      }
    },
    async getSettings() {
      return settings;
    },
    async putSettings(next) {
      settings = next;
    },
    async listRetention(subject, vehicleId) {
      return [...retention.values()].filter(plan => plan.subject === subject && plan.vehicleId === vehicleId);
    },
    async changeRetention(change) {
      const key = JSON.stringify(change.key);
      if (!canChangeRetention(retention.get(key), clips.get(change.key[2]), change)) return false;
      if (change.next) retention.set(key, change.next);
      else retention.delete(key);
      return true;
    },
  };
}
