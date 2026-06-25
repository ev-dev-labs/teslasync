import { useMutation, useQueryClient } from '@tanstack/react-query';

import { isApiError, request } from '../client';
import type { ApiError } from '../client';
import type { AppSettings } from '../../../api/types';
import { useMutationToast } from './_toastHelpers';

const settingsKeys = {
  settings: ['settings'] as const,
};

/**
 * Validation request body posted to the backend.
 *
 * Mirrors `validateConfigRequest` in
 * `internal/api/ai_settings_validate_handler.go`. Cloud mode uses the
 * extended set (api_key / model / api_version / flavor / deployment /
 * embedding_*); local mode only consults `mode` + `base_url`. All
 * cloud fields are optional and fall back to the saved per-provider
 * entry server-side, so editing one field doesn't force the user to
 * re-state the rest.
 */
export interface ValidateAiProviderRequest {
  mode: 'off' | 'local' | 'cloud';
  provider?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  api_version?: string;
  flavor?: string;
  deployment?: string;
  embedding_model?: string;
  embedding_deployment?: string;
}

/**
 * Successful validation response. The backend always returns
 * `ok: true` on a 200; the optional `pinned_ip` is populated only
 * when the local validator resolved a hostname (literal IPs and
 * the loopback short-circuit return an empty string upstream which
 * we surface as `undefined`). For cloud mode `probed_model` echoes
 * the model the probe actually exercised so the UI can render
 * "OK - gpt-4o reachable".
 */
export interface ValidateAiProviderSuccess {
  ok: true;
  mode: 'local' | 'cloud';
  base_url: string;
  pinned_ip?: string;
  probed_model?: string;
  note?: string;
}

/**
 * Validation rejection. The backend returns a 422 with the
 * standard `{error, code}` shape (via `writeErrorCode`); we wrap
 * that into a discriminated failure so consumers can switch on
 * `reason` without parsing free-form prose.
 *
 * Known reasons mirror constants in
 * `internal/api/ai_settings_validate_handler.go`.
 */
export type ValidateAiProviderReason =
  | 'not_local'
  | 'invalid'
  | 'bad_mode'
  | 'bad_request'
  | 'unknown_provider'
  | 'missing_api_key'
  | 'missing_base_url'
  | 'missing_deployment'
  | 'unauthorized'
  | 'not_found'
  | 'upstream_error'
  | 'timeout'
  | 'unknown';

export interface ValidateAiProviderFailure {
  ok: false;
  reason: ValidateAiProviderReason;
  message: string;
}

export type ValidateAiProviderResult =
  | ValidateAiProviderSuccess
  | ValidateAiProviderFailure;

/**
 * useSaveAiSettings - partial-merge wrapper for PUT /settings.
 *
 * Reads the latest AppSettings from the TanStack cache, deep-merges
 * the AI patch on top, and re-submits the full document. This is
 * safe because /settings is single-document; non-AI fields stay at
 * their last-known values.
 */
export function useSaveAiSettings() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => {
      const current = qc.getQueryData<AppSettings>(settingsKeys.settings);
      if (current == null) {
        throw new Error(
          'settings cache empty - refresh settings and try again',
        );
      }

      const merged: AppSettings = { ...current, ...patch };
      return request<AppSettings>('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.settings });
      success('toast.settings.ai.save.success', 'AI settings saved');
    },
    onError: e =>
      error(e, 'toast.settings.ai.save.error', 'Failed to save AI settings'),
  });
}

function reasonFromCode(code: string | undefined): ValidateAiProviderReason {
  switch (code) {
    case 'not_local':
    case 'invalid':
    case 'bad_mode':
    case 'bad_request':
    case 'unknown_provider':
    case 'missing_api_key':
    case 'missing_base_url':
    case 'missing_deployment':
    case 'unauthorized':
    case 'not_found':
    case 'upstream_error':
    case 'timeout':
      return code;
    default:
      return 'unknown';
  }
}

/**
 * useValidateAiProvider - pre-flight validation hook.
 *
 * Always resolves with a `ValidateAiProviderResult` discriminated union; non-422
 * network failures still throw so consumers can distinguish validation outcomes
 * from transport failures.
 */
export function useValidateAiProvider() {
  return useMutation<
    ValidateAiProviderResult,
    Error,
    ValidateAiProviderRequest
  >({
    mutationFn: async req => {
      try {
        return await request<ValidateAiProviderResult>(
          '/settings/ai/validate-config',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
          },
        );
      } catch (e: unknown) {
        if (isApiError(e) && e.status === 422) {
          const apiErr = e as ApiError;
          return {
            ok: false,
            reason: reasonFromCode(apiErr.code),
            message: apiErr.message,
          };
        }
        throw e;
      }
    },
  });
}
