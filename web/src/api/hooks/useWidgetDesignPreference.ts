import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { request } from '@/api/client';
import { useMutationToast } from './_toastHelpers';
import { resolveAvailablePackId, type PackId } from '@/features/dashboard/widgets/designPacks/types';

export interface WidgetDesignPreference {
  pack_id: PackId;
  scope: string;
  app_wide: boolean;
}

export const widgetDesignPreferenceKey = (origin: string, scope: string | null) =>
  ['widget-design-preference', origin, scope] as const;
export const widgetDesignIdentityKey = (origin: string) => ['widget-design-identity', origin] as const;

// QueryObservers each own refetchInterval timers. With 132 widgets, staggered
// mounts would otherwise produce 132 independent polling schedules. Reference
// count one timer per QueryClient/server instead; ordinary renders do nothing.
const revalidators = new WeakMap<QueryClient, Map<string, { users: number; stop: () => void }>>();

export function useWidgetDesignRevalidation(origin: string, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let entries = revalidators.get(client);
    if (!entries) {
      entries = new Map();
      revalidators.set(client, entries);
    }
    let entry = entries.get(origin);
    if (!entry) {
      let active = true;
      const timer = window.setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        void client.refetchQueries({ queryKey: widgetDesignIdentityKey(origin), exact: true, type: 'active' })
          .then(() => {
            if (active) return client.refetchQueries({ queryKey: ['widget-design-preference', origin], type: 'active' });
          });
      }, 20_000);
      entry = { users: 0, stop: () => { active = false; window.clearInterval(timer); } };
      entries.set(origin, entry);
    }
    entry.users++;
    return () => {
      entry.users--;
      if (entry.users === 0) {
        entry.stop();
        entries.delete(origin);
      }
    };
  }, [client, origin, enabled]);
}

/** Same byte-for-byte contract as domain/widgetdesign.Scope, not an email key. */
export async function widgetDesignScope(subject: string | null): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(subject === null ? 'open' : `forward_auth:${subject}`),
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function checkedPreference(value: WidgetDesignPreference, scope: string): WidgetDesignPreference {
  if (!value || value.scope !== scope || typeof value.pack_id !== 'string' ||
    (value.app_wide !== undefined && typeof value.app_wide !== 'boolean')) {
    throw new Error('Widget design preference identity mismatch');
  }
  const pack_id = resolveAvailablePackId(value.pack_id);
  return { scope, pack_id, app_wide: pack_id === value.pack_id && value.app_wide === true };
}

export function useWidgetDesignPreference(origin: string, scope: string | null, enabled: boolean) {
  return useQuery({
    queryKey: widgetDesignPreferenceKey(origin, scope),
    queryFn: async ({ signal }) => {
      if (!scope) throw new Error('Widget design identity is not verified');
      return checkedPreference(await request<WidgetDesignPreference>('/settings/widget-design-pack', {
        signal, cache: 'no-store', skipAuthRefresh: true,
      }), scope);
    },
    enabled: enabled && !!scope,
    staleTime: 15_000,
    gcTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: 'always',
    refetchInterval: false,
  });
}

interface SavePreference {
  pack_id: PackId;
  app_wide?: boolean;
  scope: string;
  origin: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

/**
 * Mode-independent cosmetic preference: changing the dashboard's appearance
 * while viewing historical telemetry does not alter vehicle/operational state.
 * Offline saves still fail immediately; no retries, deferred writes, browser
 * migration, or optimistic selection.
 */
export function useSaveWidgetDesignPreference() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationKey: ['widget-design-preference-save'],
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: SavePreference) => {
      if (!input.isCurrent() || input.signal.aborted) throw new Error('Widget design identity changed');
      if (navigator.onLine === false) throw new Error('Widget design preference cannot be saved offline');
      if (resolveAvailablePackId(input.pack_id) !== input.pack_id) throw new Error('Invalid widget design pack');
      await client.cancelQueries({ queryKey: widgetDesignPreferenceKey(input.origin, input.scope), exact: true });
      input.signal.throwIfAborted();
      if (!input.isCurrent()) throw new Error('Widget design identity changed');
      return checkedPreference(await request<WidgetDesignPreference>('/settings/widget-design-pack', {
        method: 'PUT',
        body: JSON.stringify({ pack_id: input.pack_id, app_wide: input.app_wide }),
        signal: input.signal,
        cache: 'no-store',
        skipAuthRefresh: true,
      }), input.scope);
    },
    onSuccess: async (value, input) => {
      // Focus/poll reads can start while PUT is in flight. Cancel those before
      // publishing the committed result so a delayed pre-write snapshot cannot
      // replace the new selection.
      if (!input.isCurrent() || input.signal.aborted) return;
      await client.cancelQueries({ queryKey: widgetDesignPreferenceKey(input.origin, input.scope), exact: true });
      if (!input.isCurrent() || input.signal.aborted) return;
      client.setQueryData(widgetDesignPreferenceKey(input.origin, input.scope), value);
      toast.success('toast.settings.widgetDesignPack.success', 'Widget design pack saved');
    },
    onError: (error, input) => {
      if (input.isCurrent() && !input.signal.aborted) {
        toast.error(error, 'toast.settings.widgetDesignPack.error', 'Failed to save widget design pack');
      }
    },
  });
}
