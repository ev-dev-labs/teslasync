// Settings export/import hooks.
//
// Native parity keeps the TanStack Query API contracts and backend paths from
// the web hook. The browser save-as helper is represented by an explicit
// unavailable error because this native app has no filesystem/share dependency.

import {useMutation, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

export const settingsBackupKeys = {
  root: ['settings', 'backup'] as const,
  lastExport: ['settings', 'backup', 'last-export'] as const,
  lastImport: ['settings', 'backup', 'last-import'] as const,
};

export const nativeSettingsBackupCapabilities = {
  exportEndpointAvailable: true,
  importEndpointAvailable: true,
  saveAsDownloadAvailable: false,
  unavailableReason:
    'React Native parity has no browser Blob, URL.createObjectURL, document anchor, or filesystem/share dependency for save-as downloads.',
} as const;

export interface SettingsBundle {
  schema_version: number;
  exported_at: string;
  sections: {
    settings?: Record<string, unknown>;
    alert_rules?: unknown[];
    geofences?: unknown[];
    quiet_hours?: unknown[];
  };
}

export type SettingsBundleSectionKey =
  | 'settings'
  | 'alert_rules'
  | 'geofences'
  | 'quiet_hours';

export interface SettingsImportSectionResult {
  added: number;
  updated: number;
  skipped: number;
  conflicts?: string[];
}

export interface SettingsImportResult {
  dry_run: boolean;
  sections: Partial<Record<SettingsBundleSectionKey, SettingsImportSectionResult>>;
}

export interface SettingsBundleExportPayload {
  json: string;
  filename: string;
  mimeType: 'application/json';
}

export class SettingsBundleDownloadUnavailableError extends Error {
  constructor() {
    super(nativeSettingsBackupCapabilities.unavailableReason);
    this.name = 'SettingsBundleDownloadUnavailableError';
  }
}

export function defaultExportFilename(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `teslasync-settings-${yyyy}${mm}${dd}.json`;
}

export function createSettingsBundleExportPayload(
  bundle: SettingsBundle,
  filename?: string,
): SettingsBundleExportPayload {
  return {
    json: JSON.stringify(bundle, null, 2),
    filename: filename ?? defaultExportFilename(),
    mimeType: 'application/json',
  };
}

/**
 * Mutation hook for the export endpoint. Returns the parsed bundle so native
 * screens can preview/cache it and pass it to a platform-specific save/share
 * flow when one is available.
 */
export function useExportSettings() {
  const qc = useQueryClient();
  const {error} = useMutationToast();
  return useMutation<SettingsBundle, Error, void>({
    mutationFn: () =>
      request<SettingsBundle>('/settings/export', {method: 'GET'}),
    onSuccess: bundle => {
      qc.setQueryData<SettingsBundle>(settingsBackupKeys.lastExport, bundle);
    },
    onError: e =>
      error(e, 'toast.settings.export.error', 'Failed to export settings'),
  });
}

/**
 * Browser web uses Blob + URL.createObjectURL + a temporary anchor to trigger a
 * download. React Native has none of those primitives in this app, so callers
 * get a deterministic unavailable error plus createSettingsBundleExportPayload
 * for platform-specific file/share adapters.
 */
export function downloadSettingsBundle(
  bundle: SettingsBundle,
  filename?: string,
): void {
  createSettingsBundleExportPayload(bundle, filename);
  throw new SettingsBundleDownloadUnavailableError();
}

export interface ImportArgs {
  bundle: SettingsBundle;
}

/**
 * Mutation hook for the dry-run preview. Returns the per-section
 * {added, updated, skipped} summary while preserving the web request body.
 */
export function useDryRunImport() {
  const qc = useQueryClient();
  const {error} = useMutationToast();
  return useMutation<SettingsImportResult, Error, ImportArgs>({
    mutationFn: ({bundle}) =>
      request<SettingsImportResult>('/settings/import', {
        method: 'POST',
        body: JSON.stringify({dry_run: true, bundle}),
      }),
    onSuccess: result => {
      qc.setQueryData<SettingsImportResult>(
        settingsBackupKeys.lastImport,
        result,
      );
    },
    onError: e =>
      error(e, 'toast.settings.import.dryRunError', 'Failed to preview import'),
  });
}

/**
 * Mutation hook for the apply path. SUDO interception stays delegated to the
 * shared native parity request client and its registered challenge provider.
 */
export function useApplyImport() {
  const qc = useQueryClient();
  const {error} = useMutationToast();
  return useMutation<SettingsImportResult, Error, ImportArgs>({
    mutationFn: ({bundle}) =>
      request<SettingsImportResult>('/settings/import', {
        method: 'POST',
        body: JSON.stringify({dry_run: false, bundle}),
      }),
    onSuccess: result => {
      qc.setQueryData<SettingsImportResult>(
        settingsBackupKeys.lastImport,
        result,
      );
    },
    onError: e =>
      error(e, 'toast.settings.import.applyError', 'Failed to apply import'),
  });
}
