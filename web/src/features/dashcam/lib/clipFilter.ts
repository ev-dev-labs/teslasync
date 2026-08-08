import type { CameraPosition, ClipRecord, ClipSource, EventCandidateType } from './types';

export interface ClipFilterState {
  query: string;
  camera: CameraPosition | 'all';
  source: ClipSource | 'all';
  eventType: EventCandidateType | 'all';
}

export function defaultClipFilterState(): ClipFilterState {
  return { query: '', camera: 'all', source: 'all', eventType: 'all' };
}

/**
 * Pure client-side filter over the local clip catalog: free-text search
 * (filename + notes) combined with camera / source-folder / event-type
 * facets. Every facet is AND-ed; `'all'` means "no constraint" for that
 * facet.
 */
export function filterClips(clips: ClipRecord[], filters: ClipFilterState): ClipRecord[] {
  const q = filters.query.trim().toLowerCase();
  return clips.filter((clip) => {
    if (filters.camera !== 'all' && clip.cameraPosition !== filters.camera) return false;
    if (filters.source !== 'all' && clip.source !== filters.source) return false;
    if (filters.eventType !== 'all' && !clip.eventCandidates.some((e) => e.type === filters.eventType)) {
      return false;
    }
    if (q.length > 0) {
      const haystack = `${clip.fileName} ${clip.notes ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Counts how many clips in the (already-catalog-wide) list match a given camera position, for filter-chip badges. */
export function countByCamera(clips: ClipRecord[], camera: CameraPosition): number {
  return clips.reduce((n, c) => (c.cameraPosition === camera ? n + 1 : n), 0);
}

/** Counts how many clips carry at least one event candidate of the given type, for filter-chip badges. */
export function countByEventType(clips: ClipRecord[], type: EventCandidateType): number {
  return clips.reduce((n, c) => (c.eventCandidates.some((e) => e.type === type) ? n + 1 : n), 0);
}
