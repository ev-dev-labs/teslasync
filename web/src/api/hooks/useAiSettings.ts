// Phase-50 / 0003 — F2 Settings UI for AI.
//
// Mutation hooks for the Settings → AI panel.
//
//   - useSaveAiSettings : convenience PUT /settings wrapper. The
//     settings endpoint is single-document and transactional (the
//     backend upserts every typed key in one shot), so this hook
//     reads the latest cached AppSettings, deep-merges the supplied
//     AI patch on top, and re-submits the full blob. Callers stay
//     focused on the AI sub-tree without threading the entire
//     settings document through their components.
//
//   - useValidateAiProvider : POST /settings/ai/validate-config —
//     pre-flight provider URL validation. Returns a discriminated
//     `ValidateAiProviderResult` so the SPA can render inline
//     feedback (success: pinned IP banner, failure: structured
//     reason chip). The validate route lives outside `/api/v1/ai/*`
//     by design (ADR-015 §I7): a user opting IN must reach the
//     validator while AI is still off, so gating it behind aiGuard
//     would deadlock.
//
// Both hooks live alongside the existing `useSaveSettings` (they
// would feel at home in `useSettings.ts`, but the prompt's allowed-
// files list scopes AI work to this file so churn stays bounded).

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { request, ApiError, isApiError } from '../client'
import { useMutationToast } from './_toastHelpers'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import { settingsKeys } from './useSettings'
import type { AppSettings } from '@/api/types'

/**
 * Validation request body posted to the backend.
 *
 * Mirrors `validateConfigRequest` in
 * `internal/api/ai_settings_validate_handler.go`.
 */
export interface ValidateAiProviderRequest {
  mode: 'off' | 'local' | 'cloud'
  provider?: string
  base_url?: string
}

/**
 * Successful validation response. The backend always returns
 * `ok: true` on a 200; the optional `pinned_ip` is populated only
 * when the local validator resolved a hostname (literal IPs and
 * the loopback short-circuit return an empty string upstream which
 * we surface as `undefined`).
 */
export interface ValidateAiProviderSuccess {
  ok: true
  mode: 'local' | 'cloud'
  base_url: string
  pinned_ip?: string
  note?: string
}

/**
 * Validation rejection. The backend returns a 422 with the
 * standard `{error, code}` shape (via `writeErrorCode`); we wrap
 * that into a discriminated failure so consumers can switch on
 * `reason` without parsing free-form prose.
 *
 * Known reasons (mirror constants in
 * `internal/api/ai_settings_validate_handler.go`):
 *   - `not_local`  — base URL resolved to a public address.
 *   - `invalid`    — malformed URL, DNS failure, or other generic
 *                    rejection from the local validator.
 *   - `bad_mode`   — request body had `mode='off'` or unknown.
 *   - `bad_request`— body was malformed JSON.
 *   - `unknown`    — fallback when the server omitted the code.
 */
export type ValidateAiProviderReason =
  | 'not_local'
  | 'invalid'
  | 'bad_mode'
  | 'bad_request'
  | 'unknown'

export interface ValidateAiProviderFailure {
  ok: false
  reason: ValidateAiProviderReason
  message: string
}

export type ValidateAiProviderResult =
  | ValidateAiProviderSuccess
  | ValidateAiProviderFailure

/**
 * useSaveAiSettings — partial-merge wrapper for PUT /settings.
 *
 * Reads the latest AppSettings from the TanStack cache, deep-merges
 * the AI patch on top, and re-submits the full document. This is
 * safe because /settings is single-document; non-AI fields stay at
 * their last-known values.
 *
 * The backend re-applies ADR-015 invariants on the round-trip:
 *   - mode→off transitions clear `ai_features` and archive them
 *     into `ai_features_archived`;
 *   - off-mode GETs redact `ai_provider_config` and
 *     `ai_features_archived` so the next render is always safe.
 */
export function useSaveAiSettings() {
  const qc = useQueryClient()
  const { success, error } = useMutationToast()

  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => {
      const current = qc.getQueryData<AppSettings>(settingsKeys.settings)
      if (current == null) {
        // Cache miss is rare in practice — the Settings page mounts
        // the useSettings hook before this mutation can fire — but
        // we fail closed rather than submit an undefined-laden blob
        // that would partial-overwrite the user's saved preferences.
        throw new Error('settings cache empty — refresh the page and try again')
      }
      const merged: AppSettings = { ...current, ...patch }
      return request<AppSettings>('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
    },
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: settingsKeys.settings })
      success('toast.settings.ai.save.success', 'AI settings saved')
    },
    onError: (e) =>
      error(e, 'toast.settings.ai.save.error', 'Failed to save AI settings'),
  })
}

/**
 * Maps the backend's structured `code` value to one of our typed
 * reasons. Defensive against future codes the server may add: the
 * fallback is the literal string so the UI can still display it
 * verbatim, but the type-narrowing branch becomes `'unknown'` so
 * exhaustiveness checks keep working.
 */
function reasonFromCode(code: string | undefined): ValidateAiProviderReason {
  switch (code) {
    case 'not_local':
    case 'invalid':
    case 'bad_mode':
    case 'bad_request':
      return code
    default:
      return 'unknown'
  }
}

/**
 * useValidateAiProvider — pre-flight validation hook.
 *
 * Always resolves with a `ValidateAiProviderResult` discriminated
 * union; non-422 network failures still throw (TanStack Query's
 * onError fires) so the consumer can distinguish "user gave a bad
 * URL" from "the network is down". 422 responses are caught and
 * re-shaped into the failure variant because they are a *validation
 * outcome*, not an error condition.
 */
export function useValidateAiProvider() {
  return useMutation<ValidateAiProviderResult, Error, ValidateAiProviderRequest>({
    mutationFn: async (req) => {
      try {
        return await request<ValidateAiProviderResult>(
          '/settings/ai/validate-config',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
          },
        )
      } catch (e: unknown) {
        // 422 is the validator's structured rejection — we surface
        // it as the failure variant of the discriminated union so
        // consumers can render an inline banner without try/catch.
        // Any other ApiError (500, network down, etc.) re-throws so
        // the mutation's onError fires.
        if (isApiError(e) && e.status === 422) {
          const apiErr = e as ApiError
          return {
            ok: false,
            reason: reasonFromCode(apiErr.code),
            message: apiErr.message,
          }
        }
        throw e
      }
    },
  })
}
