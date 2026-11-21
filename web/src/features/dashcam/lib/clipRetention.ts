import { uniqueZonedMinuteToUtc } from '@/lib/dateConvert';
import type { ClipRecord } from './types';

export type RetentionKey = [subject: string, vehicleId: number, clipId: string];

export interface ClipRetention {
  subject: string;
  vehicleId: number;
  clipId: string;
  clipImportedAt: string;
  revision: string;
  confirmedAt: string;
  deadline: string;
  hold: 'paused' | 'copy_confirmed' | null;
  snoozeUntil: string | null;
}

export interface RetentionChange {
  key: RetentionKey;
  clipImportedAt: string;
  expectedRevision: string | null;
  next: ClipRetention | null;
}

export const RETENTION_SNOOZE_MS = 60 * 60 * 1000;
const REVIEW_WINDOW_MS = 24 * RETENTION_SNOOZE_MS;

export function eligibleRetentionClip(clip: ClipRecord | null | undefined, vehicleId: number): clip is ClipRecord {
  return !!clip && clip.vehicleId === vehicleId && clip.blob.size > 0;
}

export function matchesRetentionClip(plan: ClipRetention, clip: ClipRecord | null | undefined): clip is ClipRecord {
  return eligibleRetentionClip(clip, plan.vehicleId) && clip.id === plan.clipId && clip.createdAt === plan.clipImportedAt;
}

export function canChangeRetention(current: ClipRetention | undefined, clip: ClipRecord | null | undefined, change: RetentionChange): boolean {
  const [subject, vehicleId, clipId] = change.key;
  if ((current?.revision ?? null) !== change.expectedRevision) return false;
  if (!change.next) return !!current;
  return change.next.subject === subject && change.next.vehicleId === vehicleId && change.next.clipId === clipId
    && change.next.clipImportedAt === change.clipImportedAt && matchesRetentionClip(change.next, clip);
}

export function retentionDeadline(wallTime: string, zone: string, now: number): string | null {
  const instant = uniqueZonedMinuteToUtc(wallTime, zone);
  return instant && instant.getTime() > now ? instant.toISOString() : null;
}

export function retentionStatus(plan: ClipRetention, now: number) {
  const deadline = Date.parse(plan.deadline);
  if (!Number.isFinite(deadline) || deadline <= now) return 'expired';
  if (plan.hold) return plan.hold;
  if (plan.snoozeUntil && Date.parse(plan.snoozeUntil) > now) return 'snoozed';
  return deadline - now <= REVIEW_WINDOW_MS ? 'due' : 'active';
}
