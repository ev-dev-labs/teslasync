// Settings reset hooks.

// Two thin wrappers around `request` that drive ResetSection.tsx:

//   • useResetSection(section) → POST /settings/reset { section }
//   • useResetAllSettings → POST /settings/reset {}

// Both invalidate every cached query (no-args invalidate) because a
// reset can touch alert rules, geofences, channels, automations, the
// dashboard layout library, the typed settings rows that drive every
// preference panel, and the per-user quiet-hours window. Listing them
// individually would be incomplete and brittle; a global flush is
// honest about what just happened.

// The shared `request` client transparently handles SUDO_REQUIRED
// when the backend's RequireSudo middleware rejects with 401 +
// SUDO_REQUIRED the cached interceptor opens the existing
// <ReauthDialog>, replays the request with the resulting step-up
// token, and returns the result transparently. On user-cancel the
// mutation rejects with SudoCanceledError (re-exported below) which
// the page handles as a non-error.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request, SudoCanceledError } from '../client';
import { useMutationToast } from './_toastHelpers';

export { SudoCanceledError };

/**
 * Stable query keys for the reset feature. There's no read-side
 * query yet (the hook is mutation-only) but exposing the namespace
 * up front lets us add a "last reset" preview later without churning
 * existing call sites.
 */
export const settingsResetKeys = {
  root: ['settings', 'reset'] as const,
  lastReset: ['settings', 'reset', 'last'] as const,
};

/**
 * Per-section row count as returned by the backend. Mirrors
 * `database.SettingsResetSectionResult`.
 */
export interface SettingsResetSectionResult {
  section: string;
  reset: number;
}

/**
 * Top-level reset receipt as returned by the backend. Mirrors
 * `database.SettingsResetResult`. `reset` is the sum of per-section
 * counts and `sections` lists each section in the order it ran.
 */
export interface SettingsResetResult {
  reset: number;
  sections: SettingsResetSectionResult[];
}

/**
 * Coerces a raw reset receipt into a fully-populated shape so every
 * consumer can rely on `reset` being a number and `sections` being an
 * array.
 *
 * Two real wire cases make this necessary:
 *   • Go marshals a nil `[]SettingsResetSectionResult` slice as JSON
 *     `null`, not `[]` — a `result.sections.length` read (as done in
 *     <ResetSection>) would then throw.
 *   • A no-content edge (`204`) leaves `request` resolving `undefined`.
 * Normalising once at the hook boundary protects every current and
 * future call site instead of scattering `?? []` guards downstream.
 */
function normalizeResetResult(
  raw: SettingsResetResult | null | undefined,
): SettingsResetResult {
  return {
    reset: raw?.reset ?? 0,
    sections: raw?.sections ?? [],
  };
}

/**
 * Mutation hook for a single-section reset.
 *
 * `section` is the canonical lower-snake-case name as listed in
 * `database.AllSettingsResetSections()` — anything else returns 400
 * SECTION_UNKNOWN or 400 SECTION_DENIED from the server.
 *
 * `mutate()` accepts no argument because the section is captured at
 * hook construction; render one hook per section in the list panel.
 */
export function useResetSection(section: string) {
  const qc = useQueryClient();
  const { error } = useMutationToast();
  return useMutation<SettingsResetResult, Error, void>({
    mutationFn: async () =>
      normalizeResetResult(
        await request<SettingsResetResult>('/settings/reset', {
          method: 'POST',
          body: JSON.stringify({ section }),
        }),
      ),
    onSuccess: (result) => {
      qc.setQueryData<SettingsResetResult>(settingsResetKeys.lastReset, result);
      // Reset can touch any preference / rule / channel cache
      // flush everything so the next render reflects defaults.
      qc.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof SudoCanceledError) return;
      error(e, 'toast.settings.reset.error', 'Failed to reset section');
    },
  });
}

/**
 * Mutation hook for the global "Reset ALL settings" Danger zone.
 *
 * Sends an empty body which the backend interprets as "reset every
 * whitelisted section". Same SUDO interception + cache flush
 * semantics as useResetSection.
 */
export function useResetAllSettings() {
  const qc = useQueryClient();
  const { error } = useMutationToast();
  return useMutation<SettingsResetResult, Error, void>({
    mutationFn: async () =>
      normalizeResetResult(
        await request<SettingsResetResult>('/settings/reset', {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      ),
    onSuccess: (result) => {
      qc.setQueryData<SettingsResetResult>(settingsResetKeys.lastReset, result);
      qc.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof SudoCanceledError) return;
      error(e, 'toast.settings.reset.allError', 'Failed to reset all settings');
    },
  });
}
