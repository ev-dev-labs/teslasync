import {useCallback, useEffect, useState} from 'react';

import {apiUrl} from '../client';

export interface LifetimeAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
  current: number;
}

/**
 * `achievement_unlocked` SSE payload shape, mirroring the Go
 * `achievementUnlockedEvent` struct in internal/api/lifetime/handler.go.
 *
 * The raw SSE stream is not passed through camelCaseKeys, so keys remain
 * snake_case.
 */
export interface AchievementUnlockedEvent {
  vehicle_id: number;
  unlocked_at: string;
  achievement: LifetimeAchievement;
}

export type AchievementUnlocksRealtimeStatus = 'subscribed' | 'unavailable';

export interface UseAchievementUnlocksResult {
  recent: AchievementUnlockedEvent[];
  dismiss: (achievementId: string) => void;
  realtimeStatus: AchievementUnlocksRealtimeStatus;
  unavailableReason: string | null;
}

const MAX_RECENT = 25;
const ACHIEVEMENT_UNLOCKED_EVENT = 'achievement_unlocked';
const EVENTS_PATH = '/events';

export const ACHIEVEMENT_UNLOCKS_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; install a compatible polyfill to receive achievement_unlocked SSE events.';

type NativeEventSourceEvent = {
  readonly data: string;
};

type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSource {
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  removeEventListener?(
    event: string,
    listener: NativeEventSourceListener,
  ): void;
  close(): void;
}

type NativeEventSourceConstructor = new (url: string) => NativeEventSource;
type UnlockListener = (data: unknown) => void;

const unlockListeners = new Set<UnlockListener>();
let source: NativeEventSource | null = null;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & {EventSource?: unknown})
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

function emitUnlock(data: unknown): void {
  for (const listener of Array.from(unlockListeners)) {
    listener(data);
  }
}

function handleUnlockEvent(event: NativeEventSourceEvent): void {
  emitUnlock(event.data ? JSON.parse(event.data) : null);
}

function subscribeAchievementUnlocks(
  listener: UnlockListener,
): AchievementUnlocksRealtimeStatus {
  unlockListeners.add(listener);

  if (source != null) {
    return 'subscribed';
  }

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    return 'unavailable';
  }

  source = new EventSourceCtor(apiUrl(EVENTS_PATH));
  source.addEventListener(ACHIEVEMENT_UNLOCKED_EVENT, handleUnlockEvent);
  return 'subscribed';
}

function unsubscribeAchievementUnlocks(listener: UnlockListener): void {
  unlockListeners.delete(listener);

  if (unlockListeners.size === 0 && source != null) {
    source.removeEventListener?.(
      ACHIEVEMENT_UNLOCKED_EVENT,
      handleUnlockEvent,
    );
    source.close();
    source = null;
  }
}

/**
 * useAchievementUnlocks — subscribes to the realtime `achievement_unlocked`
 * SSE stream and exposes an in-memory queue of unlocks received during the
 * current native session.
 *
 * The list is newest-first, bounded, de-duped by `achievement.id`, and
 * transient. Consumers should call `dismiss(id)` after showing the unlock.
 */
export function useAchievementUnlocks(): UseAchievementUnlocksResult {
  const [recent, setRecent] = useState<AchievementUnlockedEvent[]>([]);
  const [realtimeStatus, setRealtimeStatus] =
    useState<AchievementUnlocksRealtimeStatus>(() =>
      getEventSourceConstructor() == null ? 'unavailable' : 'subscribed',
    );

  useEffect(() => {
    const onUnlock = (data: unknown) => {
      const payload = data as AchievementUnlockedEvent | null | undefined;
      if (!payload || !payload.achievement || !payload.achievement.id) {
        return;
      }

      setRecent(prev => {
        if (
          prev.some(e => e.achievement.id === payload.achievement.id)
        ) {
          return prev;
        }

        const next = [payload, ...prev];
        if (next.length > MAX_RECENT) {
          next.length = MAX_RECENT;
        }
        return next;
      });
    };

    setRealtimeStatus(subscribeAchievementUnlocks(onUnlock));
    return () => {
      unsubscribeAchievementUnlocks(onUnlock);
    };
  }, []);

  const dismiss = useCallback((achievementId: string) => {
    setRecent(prev =>
      prev.filter(e => e.achievement.id !== achievementId),
    );
  }, []);

  return {
    recent,
    dismiss,
    realtimeStatus,
    unavailableReason:
      realtimeStatus === 'unavailable'
        ? ACHIEVEMENT_UNLOCKS_UNAVAILABLE_REASON
        : null,
  };
}
