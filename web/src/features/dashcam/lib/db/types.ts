import type { ClipRecord, DashcamSettings } from '../types';
import type { ClipRetention, RetentionChange } from '../clipRetention';

/**
 * Storage abstraction for the dashcam feature. Two implementations exist:
 *  - `memoryAdapter.ts` — in-memory, fully synchronous-under-the-hood, used
 *    in unit tests and as an explicit last-resort fallback.
 *  - `indexedDbAdapter.ts` — real persistent browser storage.
 *
 * Both keep bytes/metadata entirely local; nothing here ever touches the
 * network.
 */
export interface DashcamDb {
  listClips(): Promise<ClipRecord[]>;
  getClip(id: string): Promise<ClipRecord | null>;
  putClip(clip: ClipRecord): Promise<void>;
  deleteClip(id: string): Promise<void>;
  getSettings(): Promise<DashcamSettings>;
  putSettings(settings: DashcamSettings): Promise<void>;
  listRetention(subject: string, vehicleId: number): Promise<ClipRetention[]>;
  changeRetention(change: RetentionChange): Promise<boolean>;
}
