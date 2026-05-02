import { useCallback, useEffect, useState } from 'react';
import { broadcast, subscribe } from '@/lib/broadcast';

/**
 * useOnboardingSkip — Phase 40 follow-up.
 *
 * Lets the user bypass the OnboardingGate while setup anchors are
 * still incomplete. The flag is persisted in localStorage so it
 * survives reloads, and broadcast across tabs so a "Skip" in one
 * tab takes effect in others.
 *
 * The flag is intentionally NOT cleared when onboarding completes
 * — keeping it set is harmless (the gate also bypasses on
 * `is_complete`) and avoids re-trapping the user on /onboarding if
 * they later disconnect their Tesla account.
 */

const STORAGE_KEY = 'teslasync:onboarding:skipped:v1';

function readSkipped(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSkipped(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota / private mode — best-effort drop */
  }
}

/**
 * Synchronous read for callers that run outside React (e.g. the
 * gate effect that needs the value on the very first render).
 */
export function isOnboardingSkippedSync(): boolean {
  return readSkipped();
}

export interface UseOnboardingSkip {
  isSkipped: boolean;
  skip: () => void;
  unskip: () => void;
}

export function useOnboardingSkip(): UseOnboardingSkip {
  const [isSkipped, setIsSkipped] = useState<boolean>(readSkipped);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'onboarding.skip.changed') {
        setIsSkipped(msg.skipped);
      }
    });
  }, []);

  const skip = useCallback(() => {
    writeSkipped(true);
    setIsSkipped(true);
    broadcast({ type: 'onboarding.skip.changed', skipped: true });
  }, []);

  const unskip = useCallback(() => {
    writeSkipped(false);
    setIsSkipped(false);
    broadcast({ type: 'onboarding.skip.changed', skipped: false });
  }, []);

  return { isSkipped, skip, unskip };
}
