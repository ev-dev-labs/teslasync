// Settings export/import hooks.
//
// Three thin wrappers around `request()` that drive the
// SettingsExportImport component:
//   • useExportSettings  → GET /settings/export, returns the bundle in
//                          memory so the page can both preview the raw
//                          JSON AND trigger a save-as download.
//   • useDryRunImport    → POST /settings/import { dry_run: true }
//   • useApplyImport     → POST /settings/import { dry_run: false }
//
// Apply runs through the standard `request()` client which already
// understands SUDO_REQUIRED — when the backend's RequireSudo middleware
// rejects with 401+SUDO_REQUIRED the cached interceptor opens the
// existing <ReauthDialog>, replays the request with the resulting
// step-up token, and returns the result transparently. No bespoke
// step-up plumbing here.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '../client';
import {
  defaultExportFilename,
  type SettingsBundle,
  type SettingsImportResult,
} from '@/lib/settingsImportSchema';
import { useMutationToast } from './_toastHelpers';

export const settingsBackupKeys = {
  root: ['settings', 'backup'] as const,
  lastExport: ['settings', 'backup', 'last-export'] as const,
  lastImport: ['settings', 'backup', 'last-import'] as const,
};

/**
 * Mutation hook for the export endpoint. Returns the parsed bundle so
 * the SPA can both display a "X bytes ready" preview AND fire the
 * blob download. Implemented as a mutation (not a query) because the
 * user explicitly clicks "Export" — there's no polling case.
 */
export function useExportSettings() {
  const qc = useQueryClient();
  const { error } = useMutationToast();
  return useMutation<SettingsBundle, Error, void>({
    mutationFn: () => request<SettingsBundle>('/settings/export', { method: 'GET' }),
    onSuccess: (bundle) => {
      qc.setQueryData<SettingsBundle>(settingsBackupKeys.lastExport, bundle);
    },
    onError: (e) =>
      error(e, 'toast.settings.export.error', 'Failed to export settings'),
  });
}

/**
 * Trigger a save-as download for the supplied bundle. Pulled out as
 * a free function so unit tests can call it directly with a mock
 * `URL.createObjectURL` and the React component stays free of side
 * effects beyond `mutate()`.
 */
export function downloadSettingsBundle(bundle: SettingsBundle, filename?: string): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    // A blank/whitespace `filename` is not the same as an omitted one:
    // `??` only guards null/undefined, so `''` would set an empty
    // download name and the browser silently drops the intended `.json`
    // filename. Fall back to the dated default in that case too.
    const trimmed = filename?.trim();
    a.download = trimmed ? trimmed : defaultExportFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ImportArgs {
  bundle: SettingsBundle;
}

/**
 * Mutation hook for the dry-run preview. Returns the per-section
 * {added, updated, skipped} summary the page renders in collapsible
 * panels. Does NOT trip the SUDO interceptor in practice because
 * dry-run only reads — the route is still gated so the cached step-up
 * token is reused for the subsequent apply, avoiding a double-prompt.
 */
export function useDryRunImport() {
  const qc = useQueryClient();
  const { error } = useMutationToast();
  return useMutation<SettingsImportResult, Error, ImportArgs>({
    mutationFn: ({ bundle }) =>
      request<SettingsImportResult>('/settings/import', {
        method: 'POST',
        body: JSON.stringify({ dry_run: true, bundle }),
      }),
    onSuccess: (result) => {
      qc.setQueryData<SettingsImportResult>(settingsBackupKeys.lastImport, result);
    },
    onError: (e) =>
      error(e, 'toast.settings.import.dryRunError', 'Failed to preview import'),
  });
}

/**
 * Mutation hook for the apply path. SUDO interception is handled
 * transparently by the shared `request()` client; on user-cancel the
 * mutation rejects with `SudoCanceledError` (re-exported from
 * `@/api/client`) which the page handles as a non-error.
 */
export function useApplyImport() {
  const qc = useQueryClient();
  const { error } = useMutationToast();
  return useMutation<SettingsImportResult, Error, ImportArgs>({
    mutationFn: ({ bundle }) =>
      request<SettingsImportResult>('/settings/import', {
        method: 'POST',
        body: JSON.stringify({ dry_run: false, bundle }),
      }),
    onSuccess: (result) => {
      qc.setQueryData<SettingsImportResult>(settingsBackupKeys.lastImport, result);
    },
    onError: (e) =>
      error(e, 'toast.settings.import.applyError', 'Failed to apply import'),
  });
}
