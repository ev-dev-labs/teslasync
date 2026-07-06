/**
 * @module api/hooks/useVehicleSettings
 *
 * Per-vehicle settings layer hooks.
 *
 * Three hooks back the <VehicleSettingsTab> section:
 *
 *   • useVehicleSettings(vehicleId)
 *       Fetches the resolver's full per-key effective payload.
 *       Always returns the complete key whitelist so the SPA can
 *       render every row without presence checks.
 *
 *   • useUpsertVehicleSetting()
 *       PUT /vehicles/{id}/settings/{key} with { value: <typed> }.
 *       Surfaces 400 INVALID_VALUE / INVALID_KEY as ApiError so the
 *       form can show inline validation; success invalidates both the
 *       per-vehicle settings query AND the parent vehicleKeys.detail
 *       (because nickname feeds the page title).
 *
 *   • useResetVehicleSetting()
 *       DELETE /vehicles/{id}/settings/{key}. Idempotent — backend
 *       returns 204 even when the override row is already gone.
 *
 * Mute_until is sent as an RFC3339 string (the backend parses with
 * time.Parse(time.RFC3339, ...)). The component is responsible for
 * the datetime-local ⇄ RFC3339 conversion; this hook just forwards
 * the typed value.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, request } from '../client'
import { useMutationToast } from './_toastHelpers'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import { vehicleKeys } from './useVehicles'
import type {
  EffectiveSetting,
  VehicleSettingValue,
  VehicleSettingsResponse,
} from '@/api/types'

export type { EffectiveSetting, VehicleSettingValue, VehicleSettingsResponse }

/** Stable React-Query key namespace for per-vehicle settings. */
export const vehicleSettingsKeys = {
  all: ['vehicle-settings'] as const,
  detail: (vehicleId: number) => ['vehicle-settings', vehicleId] as const,
}

/** GET /api/v1/vehicles/{vehicleID}/settings */
export function useVehicleSettings(vehicleId: number, options?: { enabled?: boolean }) {
  return useQuery<VehicleSettingsResponse, ApiError>({
    queryKey: vehicleSettingsKeys.detail(vehicleId),
    queryFn: ({ signal }) =>
      request<VehicleSettingsResponse>(`/vehicles/${vehicleId}/settings`, { signal }),
    // Normalise the envelope so `data.settings` is ALWAYS an array. The
    // resolver is documented to return the full key whitelist, but a
    // malformed body (null envelope, missing/non-array `settings`) must
    // never reach a consumer that iterates without a presence check.
    select: (raw): VehicleSettingsResponse => ({
      settings: Array.isArray(raw?.settings) ? raw.settings : [],
    }),
    enabled: (options?.enabled ?? true) && Number.isFinite(vehicleId) && vehicleId > 0,
    staleTime: 30_000,
  })
}

/**
 * PUT /api/v1/vehicles/{vehicleID}/settings/{key} with { value }.
 *
 * The SPA passes the typed JS value (string | number | boolean); the
 * mutation forwards it verbatim — the backend dispatches on the
 * key's kind. For mute_until the caller MUST pre-format the value as
 * an RFC3339 string before invoking the mutation.
 *
 * On success both the per-vehicle settings query AND the parent
 * vehicleKeys.detail query are invalidated. The latter exists because
 * the nickname override is rendered as the vehicle's display name
 * across the app — invalidating the parent guarantees the title bar
 * stays in sync without the user having to navigate away and back.
 */
export function useUpsertVehicleSetting(vehicleId: number) {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<void, ApiError, { key: string; value: VehicleSettingValue }>({
    mutationFn: ({ key, value }) =>
      request<void>(`/vehicles/${vehicleId}/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: vehicleSettingsKeys.detail(vehicleId) })
      invalidateAndBroadcast(qc, { queryKey: vehicleKeys.detail(String(vehicleId)) })
      toast.success(
        'vehicleSettings.toasts.saved',
        'Setting saved.',
      )
    },
    onError: (err) =>
      toast.error(err, 'vehicleSettings.errors.save', 'Failed to save setting'),
  })
}

/**
 * DELETE /api/v1/vehicles/{vehicleID}/settings/{key}.
 *
 * Idempotent — the backend returns 204 even when no override row
 * existed, so a "Reset to user default" button can fire without
 * pre-checking the row's existence.
 */
export function useResetVehicleSetting(vehicleId: number) {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<void, ApiError, string>({
    mutationFn: (key: string) =>
      request<void>(`/vehicles/${vehicleId}/settings/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: vehicleSettingsKeys.detail(vehicleId) })
      invalidateAndBroadcast(qc, { queryKey: vehicleKeys.detail(String(vehicleId)) })
      toast.success(
        'vehicleSettings.toasts.reset',
        'Reverted to default.',
      )
    },
    onError: (err) =>
      toast.error(err, 'vehicleSettings.errors.reset', 'Failed to reset setting'),
  })
}

/**
 * Convenience selector: pull a single key's effective value from the
 * resolver payload. Returns the entire row (so callers can also
 * inspect `source`) or undefined when the key isn't present.
 */
export function findEffectiveSetting(
  payload: VehicleSettingsResponse | undefined,
  key: string,
): EffectiveSetting | undefined {
  // Guard against a malformed envelope: `settings` may be absent, null,
  // or (defensively) a non-array shape leaking through. Calling `.find`
  // on a non-array would throw and crash the row render, so coerce first.
  const settings = payload?.settings
  if (!Array.isArray(settings)) return undefined
  return settings.find((s) => s?.key === key)
}
