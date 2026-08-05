import type { PillItem } from '@/components/forms';
import type { CameraPosition, ClipRecord, ClipSource, EventCandidateType } from '../../lib/types';
import { CAMERA_LABELS, EVENT_TYPE_LABELS, SOURCE_LABELS } from './constants';
import { countByCamera, countByEventType } from '../../lib/clipFilter';

const CAMERA_ORDER: CameraPosition[] = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar', 'unknown'];
const SOURCE_ORDER: ClipSource[] = ['SentryClips', 'SavedClips', 'RecentClips', 'unknown'];
const EVENT_TYPE_ORDER: EventCandidateType[] = ['sentry_trigger', 'impact', 'hard_brake', 'hard_accel', 'sharp_turn', 'motion', 'manual_save', 'unknown'];

export function buildCameraPills(clips: ClipRecord[], allLabel: string): PillItem[] {
  const present = new Set(clips.map((c) => c.cameraPosition));
  const items: PillItem[] = [{ key: 'all', label: allLabel, count: clips.length }];
  for (const camera of CAMERA_ORDER) {
    if (!present.has(camera)) continue;
    items.push({ key: camera, label: CAMERA_LABELS[camera], count: countByCamera(clips, camera) });
  }
  return items;
}

export function buildSourcePills(clips: ClipRecord[], allLabel: string): PillItem[] {
  const present = new Set(clips.map((c) => c.source));
  const items: PillItem[] = [{ key: 'all', label: allLabel, count: clips.length }];
  for (const source of SOURCE_ORDER) {
    if (!present.has(source)) continue;
    const count = clips.reduce((n, c) => (c.source === source ? n + 1 : n), 0);
    items.push({ key: source, label: SOURCE_LABELS[source], count });
  }
  return items;
}

export function buildEventTypePills(clips: ClipRecord[], allLabel: string): PillItem[] {
  const present = new Set(clips.flatMap((c) => c.eventCandidates.map((e) => e.type)));
  const items: PillItem[] = [{ key: 'all', label: allLabel, count: clips.length }];
  for (const type of EVENT_TYPE_ORDER) {
    if (!present.has(type)) continue;
    items.push({ key: type, label: EVENT_TYPE_LABELS[type], count: countByEventType(clips, type) });
  }
  return items;
}

/**
 * Renders a filename-parsed clip timestamp as plain text WITHOUT resolving
 * it to an absolute instant — the string is naive local wall-clock time
 * with no timezone (see `resolveClipEpochMs`), so formatting it through a
 * locale-aware `<DateTime>` would silently assume either UTC or the
 * viewer's own timezone. Honest fallback: show the raw parsed value.
 */
export function formatCapturedAtRaw(capturedAtRaw: string | null): string {
  if (!capturedAtRaw) return '—';
  return capturedAtRaw.replace('T', ' ');
}
