import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthMode } from '@/api/hooks/useAuthMode';
import {
  useSaveWidgetDesignPreference, useWidgetDesignPreference, widgetDesignScope,
  useWidgetDesignRevalidation, widgetDesignIdentityKey,
} from '@/api/hooks/useWidgetDesignPreference';
import { subscribe } from '@/lib/broadcast';
import { getServerBaseUrl } from '@/lib/serverConnection';
import { resolveAvailablePackId, type PackId } from '@/features/dashboard/widgets/designPacks/types';

const serverOrigin = () => getServerBaseUrl() || window.location.origin;
const SERVER_KEY = 'teslasync-server-base-url';

/**
 * All widgets share the identity verification and preference queries. Local
 * storage is never read for selection and is never uploaded to the server.
 */
export function useWidgetDesignPack() {
  const authMode = useAuthMode();
  const client = useQueryClient();
  const origin = serverOrigin();
  const [blocked, setBlocked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  const pendingWrite = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const verified = useQuery({
    queryKey: widgetDesignIdentityKey(origin),
    queryFn: async ({ signal }) => {
      // cancelRefetch:false shares the in-flight auth contract request across
      // consumers. Cached useAuthMode.data alone is never verification.
      const mode = await authMode.refetch({ cancelRefetch: false });
      signal.throwIfAborted();
      if (!mode.isSuccess || !mode.data || !['open', 'forward_auth'].includes(mode.data.mode)) {
        throw new Error('Server authentication mode could not be verified');
      }
      const subject = mode.data.mode === 'open' ? null : mode.data.subject;
      if (subject !== null && (typeof subject !== 'string' || subject.trim() === '')) {
        throw new Error('Authenticated identity could not be verified');
      }
      if (mode.data.mode === 'forward_auth' && subject === null) {
        throw new Error('Authenticated identity could not be verified');
      }
      const scope = await widgetDesignScope(subject ?? null);
      signal.throwIfAborted();
      if (serverOrigin() !== origin) throw new Error('Server profile changed');
      return scope;
    },
    enabled: !blocked,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchInterval: false,
  });
  useWidgetDesignRevalidation(origin, !blocked);
  // An auth revalidation failure must never fall back to "open" or expose a
  // cached identity. Preference refresh failures, in contrast, retain selection.
  const scope = !blocked && !verified.isError ? verified.data ?? null : null;
  const read = useWidgetDesignPreference(origin, scope, !blocked);
  const save = useSaveWidgetDesignPreference();
  const active = useRef({ origin, scope, blocked });
  active.current = { origin, scope, blocked };

  useEffect(() => {
    mounted.current = true;
    ++generation.current;
    return () => {
      mounted.current = false;
      ++generation.current;
      pendingWrite.current?.abort();
    };
  }, [origin, scope]);

  useEffect(() => {
    const revoke = () => {
      ++generation.current;
      pendingWrite.current?.abort();
      active.current.blocked = true;
      setBlocked(true);
      setFailure('Server identity changed; reload to verify your identity');
      // Disabled queries may retain data; remove it rather than let a later
      // mount trust the previous session's verification.
      client.removeQueries({ queryKey: widgetDesignIdentityKey(origin) });
      void client.cancelQueries({ queryKey: ['widget-design-preference', origin] });
      client.removeQueries({ queryKey: ['widget-design-preference', origin] });
    };
    const unsubscribe = subscribe(message => { if (message.type === 'auth.logout') revoke(); });
    const storage = (event: StorageEvent) => { if (event.key === SERVER_KEY || event.key === null) revoke(); };
    window.addEventListener('storage', storage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', storage);
    };
  }, [client, origin]);

  const isReady = !!scope && read.data?.scope === scope && !blocked;
  const setPackId = useCallback(async (packId: PackId): Promise<boolean> => {
    if (!isReady || !scope || pendingWrite.current || active.current.blocked ||
      resolveAvailablePackId(packId) !== packId) return false;
    const currentGeneration = generation.current;
    const controller = new AbortController();
    pendingWrite.current = controller;
    const isCurrent = () => mounted.current && !controller.signal.aborted &&
      currentGeneration === generation.current && !active.current.blocked &&
      active.current.origin === origin && active.current.scope === scope && serverOrigin() === origin;
    setFailure(null);
    try {
      await save.mutateAsync({ pack_id: packId, origin, scope, signal: controller.signal, isCurrent });
      return isCurrent();
    } catch (error) {
      if (isCurrent()) setFailure(error instanceof Error ? error.message : 'Widget design preference could not be saved');
      return false;
    } finally {
      if (pendingWrite.current === controller) pendingWrite.current = null;
    }
  }, [isReady, scope, origin, save.mutateAsync]);

  const retry = useCallback(() => {
    if (active.current.blocked) return; // Logout/server changes require fresh navigation.
    setFailure(null);
    if (verified.isError || !scope) void verified.refetch();
    else void read.refetch();
  }, [verified.isError, verified.refetch, read.refetch, scope]);

  return {
    packId: isReady ? read.data!.pack_id : 'classic' as PackId,
    isReady,
    isSaving: isReady && save.isPending,
    error: failure ?? verified.error?.message ?? read.error?.message ?? null,
    retry,
    setPackId,
  };
}
