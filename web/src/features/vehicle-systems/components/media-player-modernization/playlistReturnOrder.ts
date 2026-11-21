import type { PlaylistCandidate, PlaylistDraft } from '@/types/privatePlaylist';

const storageKey = 'teslasync-spotify-playlist-return-order';
const authorizationWindowMs = 10 * 60 * 1000;

interface ReturnOrder {
  draftId: number;
  vehicleId: number;
  revision: string;
  until: number;
  positions: number[];
}

export function keepPlaylistReturnOrder(draft: PlaylistDraft, positions: number[]) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({
      draftId: draft.id,
      vehicleId: draft.vehicle_id,
      revision: draft.created_at,
      until: Math.min(Date.parse(draft.expires_at), Date.now() + authorizationWindowMs),
      positions,
    } satisfies ReturnOrder));
  } catch { /* Storage restrictions should not prevent Spotify sign-in. */ }
}

export function restorePlaylistReturnOrder(draft: PlaylistDraft): PlaylistCandidate[] | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    const order: Partial<ReturnOrder> | null = JSON.parse(raw);
    // The current draft came from a principal-fenced GET. Only its owner can read this revision.
    if (!order || order.vehicleId !== draft.vehicle_id || order.draftId !== draft.id || order.revision !== draft.created_at ||
        typeof order.until !== 'number' || !Number.isFinite(order.until) || order.until <= Date.now() ||
        !Array.isArray(order.positions)) return;
    return selectionForPositions(draft, order.positions);
  } catch {
    return undefined;
  }
}

export function selectionForPositions(draft: PlaylistDraft, positions: number[]): PlaylistCandidate[] | undefined {
  const candidates = new Map((draft.candidates ?? []).map(candidate => [candidate.position, candidate]));
  if (positions.length > candidates.size || new Set(positions).size !== positions.length) return;
  const selected: PlaylistCandidate[] = [];
  for (const position of positions) {
    const candidate = candidates.get(position);
    if (!candidate) return;
    selected.push(candidate);
  }
  return selected;
}

export function forgetPlaylistReturnOrder() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch { /* The tab cannot access storage. */ }
}
