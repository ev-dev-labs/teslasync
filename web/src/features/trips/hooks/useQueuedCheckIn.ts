import { useCallback, useEffect, useRef, useState } from 'react';
import { useCheckIn } from '@/api/hooks/useJourney';
import { useMutationToast } from '@/api/hooks/_toastHelpers';
import { getConnectionStatus, isApiError, onStatusChange } from '@/lib/resilience';
import {
  dequeueCheckIn,
  enqueueCheckIn,
  outboxFor,
} from '../lib/checkInOutbox';

/**
 * Queued check-ins: tap to snapshot a trail point now, or queue it
 * when offline and replay on reconnect. Replays carry their original
 * `recorded_at`, which the server dedupes idempotently.
 *
 * Queue triggers are exactly two: tapping while `getConnectionStatus`
 * reads offline, or a send failing with a NON-ApiError (raw fetch
 * failures never carry a status). HTTP errors toast through
 * `useCheckIn` and never queue — a 4xx replay would fail the same way.
 */
export function useQueuedCheckIn(sessionId: number) {
  const checkIn = useCheckIn();
  const { warning } = useMutationToast();
  const [queued, setQueued] = useState(() => outboxFor(sessionId).length);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  const refresh = useCallback(() => {
    setQueued(outboxFor(sessionId).length);
  }, [sessionId]);

  const queueOne = useCallback(() => {
    enqueueCheckIn({ session_id: sessionId, recorded_at: new Date().toISOString() });
    refresh();
    warning('toast.journey.checkin.queued', 'Offline — check-in queued');
  }, [sessionId, refresh, warning]);

  const flush = useCallback(async () => {
    if (flushingRef.current || getConnectionStatus() !== 'online') return;
    const pending = outboxFor(sessionId);
    if (pending.length === 0) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      // Sequential replay preserves trail order; the chain rejects at
      // the first failure and the rest stays queued.
      await pending.reduce(async (chain, entry) => {
        await chain;
        await checkIn.mutateAsync({ id: entry.session_id, recorded_at: entry.recorded_at });
        dequeueCheckIn(entry.session_id, entry.recorded_at);
        refresh();
      }, Promise.resolve());
    } catch {
      // Stop at the first failure; the rest stays queued for the next
      // flush. HTTP errors already toasted via useCheckIn.
    } finally {
      flushingRef.current = false;
      setFlushing(false);
      refresh();
    }
  }, [sessionId, checkIn, refresh]);

  useEffect(() => {
    refresh();
    void flush();
    return onStatusChange((status) => {
      if (status === 'online') void flush();
    });
  }, [refresh, flush]);

  const checkInNow = useCallback(() => {
    if (getConnectionStatus() !== 'online') {
      queueOne();
      return;
    }
    checkIn.mutate(
      { id: sessionId },
      {
        onError: (err) => {
          if (!isApiError(err)) queueOne();
        },
      },
    );
  }, [sessionId, checkIn, queueOne]);

  return {
    checkIn: checkInNow,
    queued,
    flushing,
    isPending: checkIn.isPending || flushing,
  };
}
