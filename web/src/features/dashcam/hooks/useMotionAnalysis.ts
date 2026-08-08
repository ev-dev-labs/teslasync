import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDashcamDb } from './useDashcamDb';
import { useMutationToast } from '@/api/hooks/_toastHelpers';
import { computeClipMotionScore, type SampleableVideo } from '../lib/motionScore';
import { deriveMotionCandidate, mergeEventCandidates } from '../lib/eventDetection';
import { dashcamKeys } from './useClipCatalog';
import type { ClipRecord } from '../lib/types';

/**
 * Waits for an `HTMLVideoElement`'s metadata to become available (or fails
 * explicitly if it never does). Kept separate from `computeClipMotionScore`
 * so that module stays pure/mockable while this orchestration touches the
 * real DOM video element lifecycle.
 */
function waitForMetadata(video: HTMLVideoElement, timeoutMs = 8000): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('video metadata never became available')), timeoutMs);
    video.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    video.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('video failed to load for motion analysis'));
      },
      { once: true },
    );
  });
}

/**
 * Runs the local sampled-frame motion heuristic against a clip's video
 * bytes and persists the (honestly-labeled) result plus any derived
 * "motion" event candidate. Explicitly surfaces `unavailable` rather than
 * pretending a score was computed when the browser lacks the needed APIs.
 */
export function useMotionAnalysis() {
  const { db } = useDashcamDb();
  const qc = useQueryClient();
  const { error } = useMutationToast();

  return useMutation({
    mutationFn: async (clip: ClipRecord): Promise<ClipRecord> => {
      const objectUrl = URL.createObjectURL(clip.blob);
      try {
        const video = document.createElement('video');
        video.muted = true;
        video.src = objectUrl;
        await waitForMetadata(video);

        const result = await computeClipMotionScore(video as unknown as SampleableVideo);
        const motion =
          result.status === 'ok'
            ? { status: 'ok' as const, score: result.score, samplePairs: result.samplePairs, computedAt: new Date().toISOString() }
            : { status: 'unavailable' as const, reason: result.reason, computedAt: new Date().toISOString() };

        const nonMotionCandidates = clip.eventCandidates.filter((c) => c.type !== 'motion');
        const eventCandidates =
          result.status === 'ok' ? mergeEventCandidates(nonMotionCandidates, deriveMotionCandidate(motion)) : nonMotionCandidates;

        const updated: ClipRecord = { ...clip, motion, eventCandidates, updatedAt: new Date().toISOString() };
        await db.putClip(updated);
        return updated;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dashcamKeys.clips }),
    onError: (e) => error(e, 'dashcam.motion.error', 'Motion analysis is unavailable in this browser'),
  });
}
