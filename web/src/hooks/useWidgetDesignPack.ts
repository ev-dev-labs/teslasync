import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthMode } from '@/api/hooks/useAuthMode';
import { subscribe } from '@/lib/broadcast';
import { getServerBaseUrl } from '@/lib/serverConnection';
import { resolveAvailablePackId } from '@/features/dashboard/widgets/designPacks/manifest';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';

const PREFIX = 'teslasync.widget-design-pack.v1.';
const CHANGE_EVENT = 'teslasync:widget-design-pack-changed';
const SERVER_KEY = 'teslasync-server-base-url';

interface Preference {
  version: 1;
  packId: PackId;
}

interface Selection {
  key: string;
  generation: number;
  packId: PackId;
  error: string | null;
}

async function preferenceKey(id: string | { mode: 'open' }, origin: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([origin, id]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return PREFIX + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function readPreference(key: string): PackId {
  const raw = window.localStorage.getItem(key);
  if (!raw) return 'classic';
  try {
    const stored: unknown = JSON.parse(raw);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const { version, packId } = stored as Record<string, unknown>;
      if (version === 1) return resolveAvailablePackId(packId);
    }
  } catch {
    // A corrupt value only affects this preference; leave other settings intact.
  }
  return 'classic';
}

/**
 * Browser/profile-only preference. Open deployments use a server-confirmed
 * profile scope; authenticated deployments require a freshly confirmed user.
 */
export function useWidgetDesignPack() {
  const authMode = useAuthMode();
  const origin = typeof window === 'undefined'
    ? ''
    : getServerBaseUrl() || window.location.origin;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    const currentGeneration = ++generation.current;
    setSelection(null);
    setIdentityError(null);
    // Revalidate rather than trusting a cached principal after a
    // server-profile or authenticated-session change.
    void authMode.refetch().then(async mode => {
      if (!active || generation.current !== currentGeneration) return;
      if (!mode.isSuccess || !mode.data || !['open', 'forward_auth'].includes(mode.data.mode)) {
        setIdentityError('Server authentication mode could not be verified');
        return;
      }
      const id = mode.data.mode === 'open' ? { mode: 'open' as const }
        : typeof mode.data.subject === 'string' ? mode.data.subject.trim() : null;
      if (!id) {
        setIdentityError('Authenticated identity could not be verified');
        return;
      }
      try {
        const key = await preferenceKey(id, origin);
        if (!active || generation.current !== currentGeneration) return;
        const packId = readPreference(key);
        if (active && generation.current === currentGeneration) {
          setSelection({ key, generation: currentGeneration, packId, error: null });
        }
      } catch {
        if (active && generation.current === currentGeneration) setIdentityError('Browser preference storage is unavailable');
      }
    }).catch(() => {
      if (active && generation.current === currentGeneration) setIdentityError('Authenticated identity could not be verified');
    });
    return () => { active = false; ++generation.current; };
  }, [origin, authMode.refetch, retryGeneration]);

  const key = selection?.key;
  useEffect(() => subscribe(message => {
    if (message.type === 'auth.logout') {
      ++generation.current;
      setSelection(null);
      setIdentityError('Sign in to select a widget design pack');
    }
  }), []);

  useEffect(() => {
    const refresh = () => {
      if (!key) return;
      try {
        const packId = readPreference(key);
        setSelection(current => current?.key === key ? { ...current, packId, error: null } : current);
      } catch {
        setSelection(current => current?.key === key
          ? { ...current, error: 'Browser preference storage is unavailable' } : current);
      }
    };
    const storage = (event: StorageEvent) => {
      if (key && (event.key === key || event.key === null)) refresh();
      if (event.key === SERVER_KEY) {
        ++generation.current;
        setSelection(null);
        setIdentityError('Server profile changed; reload to verify your identity');
      }
    };
    const local = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(CHANGE_EVENT, local);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(CHANGE_EVENT, local);
    };
  }, [key]);

  const setPackId = useCallback((requested: PackId): boolean => {
    if (!selection || selection.generation !== generation.current || identityError) return false;
    if (resolveAvailablePackId(requested) !== requested) {
      setSelection(current => current ? { ...current, error: 'This pack is not available yet' } : current);
      return false;
    }
    try {
      const next: Preference = { version: 1, packId: requested };
      window.localStorage.setItem(selection.key, JSON.stringify(next));
      setSelection(current => current?.key === selection.key
        ? { ...current, packId: requested, error: null } : current);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: selection.key }));
      return true;
    } catch {
      setSelection(current => current?.key === selection.key
        ? { ...current, error: 'Could not save this browser preference' } : current);
      return false;
    }
  }, [selection, identityError]);

  return {
    packId: selection?.packId ?? 'classic',
    isReady: selection !== null && identityError === null,
    isSaving: false,
    error: identityError ?? selection?.error ?? null,
    setPackId,
    retry: () => setRetryGeneration(current => current + 1),
  };
}
