import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePersonalIdentity } from '@/api/hooks/usePersonalIdentity';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  matchesRetentionClip, retentionStatus, RETENTION_SNOOZE_MS,
  type ClipRetention,
} from '../lib/clipRetention';
import type { ClipRecord } from '../lib/types';
import { useDashcamDb } from './useDashcamDb';

export type RetentionAction = 'pause' | 'resume' | 'snooze' | 'copy_confirmed' | 'clear' | 'download';

export function useClipRetention(subject: string, vehicleId: number, enabled: boolean) {
  const { db } = useDashcamDb();
  const client = useQueryClient();
  const identity = usePersonalIdentity(false);
  const vehicles = useVehicles(false);
  const key = ['dashcam', 'retention', subject, vehicleId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => db.listRetention(subject, vehicleId),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: 'always',
  });

  async function act(
    clip: ClipRecord, plan: ClipRetention | null, action: RetentionAction | { deadline: string },
    isCurrent: () => boolean,
  ): Promise<ClipRecord | null> {
    const [principal, fleet] = await Promise.all([
      identity.refetch({ cancelRefetch: false, throwOnError: true }),
      vehicles.refetch({ cancelRefetch: false, throwOnError: true }),
    ]);
    if (!isCurrent() || principal.data?.mode !== 'forward_auth' || principal.data.impersonating !== false
      || principal.data.subject !== subject
      || !fleet.data?.some(vehicle => vehicle.id === vehicleId)) {
      throw new Error('Retention scope changed.');
    }

    const now = Date.now();
    const status = plan && retentionStatus(plan, now);
    if (action === 'download') {
      const currentPlan = (await db.listRetention(subject, vehicleId)).find(item => item.clipId === clip.id);
      const currentClip = await db.getClip(clip.id);
      if (!isCurrent() || !plan || !currentPlan || currentPlan.revision !== plan.revision
        || !matchesRetentionClip(currentPlan, currentClip) || retentionStatus(currentPlan, Date.now()) !== 'due') {
        await client.invalidateQueries({ queryKey: key });
        throw new Error('Retention recommendation is no longer actionable.');
      }
      return currentClip;
    }

    let next: ClipRetention | null;
    if (typeof action === 'object') {
      if (!(Date.parse(action.deadline) > now)) throw new Error('Retention deadline is not in the future.');
      next = { subject, vehicleId, clipId: clip.id, clipImportedAt: clip.createdAt,
        deadline: action.deadline, confirmedAt: new Date(now).toISOString(),
        revision: crypto.randomUUID(), hold: null, snoozeUntil: null };
    } else if (action === 'clear') {
      next = null;
    } else {
      if (!plan || status === 'expired' ||
        (action === 'snooze' && (status !== 'due' || Date.parse(plan.deadline) <= now + RETENTION_SNOOZE_MS))
        || (action === 'copy_confirmed' && status !== 'due')) {
        throw new Error('Retention recommendation is no longer actionable.');
      }
      next = { ...plan, revision: crypto.randomUUID(),
        hold: action === 'pause' ? 'paused' : action === 'copy_confirmed' ? 'copy_confirmed' : null,
        snoozeUntil: action === 'snooze' ? new Date(now + RETENTION_SNOOZE_MS).toISOString() : null };
    }
    if (!isCurrent()) return null;
    const changed = await db.changeRetention({ key: [subject, vehicleId, clip.id],
      clipImportedAt: clip.createdAt, expectedRevision: plan?.revision ?? null, next });
    await client.invalidateQueries({ queryKey: key });
    if (!changed) throw new Error('Clip or retention reminder changed.');
    return null;
  }

  return { query, act };
}
