// Settings reset hooks.
//
// Native parity keeps the web TanStack Query contract and backend reset paths.
// The shared request client handles SUDO_REQUIRED by delegating to the native
// reauth challenge provider, then replaying the request with the step-up token.

import {useMutation, useQueryClient} from '@tanstack/react-query';

import {request, SudoCanceledError} from '../client';
import {useMutationToast} from './_toastHelpers';

export {SudoCanceledError};

/**
 * Stable query keys for the reset feature. There's no read-side query yet (the
 * hook is mutation-only) but exposing the namespace lets native screens cache a
 * future "last reset" preview without changing call sites.
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
 * `database.SettingsResetResult`. `reset` is the sum of per-section counts and
 * `sections` lists each section in the order it ran.
 */
export interface SettingsResetResult {
  reset: number;
  sections: SettingsResetSectionResult[];
}

/**
 * Mutation hook for a single-section reset.
 *
 * `section` is the canonical lower-snake-case name as listed in
 * `database.AllSettingsResetSections()`; invalid values are rejected by the
 * server as SECTION_UNKNOWN or SECTION_DENIED.
 */
export function useResetSection(section: string) {
  const qc = useQueryClient();
  const {error} = useMutationToast();
  return useMutation<SettingsResetResult, Error, void>({
    mutationFn: () =>
      request<SettingsResetResult>('/settings/reset', {
        method: 'POST',
        body: JSON.stringify({section}),
      }),
    onSuccess: result => {
      qc.setQueryData<SettingsResetResult>(settingsResetKeys.lastReset, result);
      qc.invalidateQueries();
    },
    onError: err => {
      if (err instanceof SudoCanceledError) {
        return;
      }
      error(err, 'toast.settings.reset.error', 'Failed to reset section');
    },
  });
}

/**
 * Mutation hook for the global "Reset ALL settings" danger zone.
 *
 * Sends an empty body which the backend interprets as "reset every whitelisted
 * section". SUDO interception and cache flushing match useResetSection.
 */
export function useResetAllSettings() {
  const qc = useQueryClient();
  const {error} = useMutationToast();
  return useMutation<SettingsResetResult, Error, void>({
    mutationFn: () =>
      request<SettingsResetResult>('/settings/reset', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: result => {
      qc.setQueryData<SettingsResetResult>(settingsResetKeys.lastReset, result);
      qc.invalidateQueries();
    },
    onError: err => {
      if (err instanceof SudoCanceledError) {
        return;
      }
      error(
        err,
        'toast.settings.reset.allError',
        'Failed to reset all settings',
      );
    },
  });
}
