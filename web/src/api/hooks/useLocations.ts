import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { chargingKeys } from './useCharging';
import type { Location, Geofence } from '@/types/location';
// Canonical snake_case Charging Places DTOs (@/api/types). Aliased to avoid
// colliding with the legacy camelCase `Geofence` above — same split, and
// same reasoning, as `ChargingSession`/`ApiChargingSession` in useCharging.ts.
import type {
  Geofence as ApiGeofence,
  GeofenceRate,
  GeofenceRateCreateRequest,
  GeofenceRateImpactPreview,
  GeofenceRateApplyResult,
  GeofenceChargingSummary,
  GeofenceChargingActivity,
} from '../types';

export const locationKeys = {
  all: (vehicleId?: string) => ['locations', vehicleId ?? 'all'] as const,
  geofences: ['geofences'] as const,
  geofencesFull: (includeArchived: boolean) =>
    ['geofences', 'full', includeArchived ? 'with-archived' : 'active'] as const,
  geofencesNeedsReview: ['geofences', 'needs-review'] as const,
  geofenceRatesCurrent: ['geofences', 'rates', 'current'] as const,
  geofenceRates: (geofenceId: number) => ['geofences', geofenceId, 'rates'] as const,
  geofenceRatePreview: (geofenceId: number, rateId: number, from?: string, to?: string) =>
    ['geofences', geofenceId, 'rates', rateId, 'preview', from ?? '', to ?? ''] as const,
  geofenceChargingSummary: (geofenceId: number) =>
    ['geofences', geofenceId, 'charging-summary'] as const,
  geofenceChargingActivity: (geofenceId: number, limit: number, offset: number) =>
    ['geofences', geofenceId, 'charging-activity', limit, offset] as const,
};

/**
 * useLocations — GET /locations[?vehicle_id=...]
 *
 * @deprecated The hook return type points at the legacy camelCase
 * `Location` interface in `@/types/location` (`addressName`, `visitCount`,
 * `lastVisited`, etc). The new backend wire shape is the snake_case
 * `VisitedLocation` in `@/api/types.ts`. The two are reconciled at
 * runtime by `camelCaseKeys` in `@/lib/resilience` which retains BOTH
 * casings on the response object, so consumers reading either form work
 * today. This hook keeps the legacy type import to preserve TS-compile
 * across out-of-scope
 * consumers (LocationFavoritesWidget). A future audit prompt can
 * unify the two type modules in lockstep with all consumers.
 */
export function useLocations(vehicleId?: string) {
  return useQuery({
    queryKey: locationKeys.all(vehicleId),
    queryFn: ({ signal }) => request<Location[]>(
      vehicleId ? `/locations?vehicle_id=${encodeURIComponent(vehicleId)}` : '/locations', { signal },
    ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/**
 * useGeofences — GET /geofences
 *
 * The legacy camelCase `Geofence` type in `@/types/location` now matches
 * the post-migration backend `models.Geofence` (internal/models/system.go)
 * field-for-field: `enabled`, `alertOnEntry`, `alertOnExit`, `origin`,
 * `needsReview`, optional `category`/`archivedAt`. Backend MarshalJSON
 * augments the response with `latitude`, `longitude`, `radius` (centroid +
 * max-vertex meters, derived from the stored polygon) alongside the raw
 * `polygon_wkt`. The legacy type intentionally omits `polygon_wkt` and
 * `updated_at` since no consumer of this hook needs them — reach for the
 * canonical snake_case `Geofence` in `@/api/types` (used by the newer
 * Charging Places hooks below) if a future page needs the full wire shape.
 *
 * The one field this backend model never persisted or emitted —
 * `cost_per_kwh` — has been fully removed from the frontend type too. A
 * geofence's electricity rate is a first-class, time-versioned resource
 * (`GeofenceRate` / `rate_per_wh`) fetched via the dedicated Charging
 * Places hooks below, never a field on the geofence itself.
 */
export function useGeofences() {
  return useQuery({
    queryKey: locationKeys.geofences,
    queryFn: ({ signal }) => request<Geofence[]>('/geofences', { signal }),
    select: safeArray,
  });
}

/**
 * useGeofencesFull — GET /geofences (canonical snake_case shape)
 *
 * Uses a dedicated cache key because the Charging Places workspace can
 * explicitly request archived rows while the legacy geofence-management
 * surface must continue receiving active rows only. The workspace also
 * polls so a newly discovered charging place appears without a page reload.
 */
export function useGeofencesFull(includeArchived = false) {
  return useQuery({
    queryKey: locationKeys.geofencesFull(includeArchived),
    queryFn: ({ signal }) =>
      request<ApiGeofence[]>(
        includeArchived ? '/geofences?include_archived=true' : '/geofences',
        { signal },
      ),
    select: safeArray,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export interface GeofenceBulkResult {
  deleted: number;
  failed: { id: number; reason: string }[];
}

/**
 * useBulkGeofencesDelete — POST /geofences/bulk
 * Deletes a batch of geofences (op=delete is the only allowlisted op
 * today) and refreshes the geofences list cache.
 */
export function useBulkGeofencesDelete() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<GeofenceBulkResult>('/geofences/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, op: 'delete' }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofences });
      success('toast.geofence.bulkDelete.success', 'Geofences deleted');
    },
    onError: (err) =>
      error(err, 'toast.geofence.bulkDelete.error', 'Failed to delete geofences'),
  });
}

// =============================================================================
// Charging Places — geofence-based charging-place pricing feature
// (migration 000228_geofence_charging_place_pricing;
// internal/api/geofence/rate_handler.go is the wire-contract source of
// truth). All rate amounts on the wire are `rate_per_wh` — SI-canonical
// currency-per-watt-hour, never per-kWh. Convert to currency/kWh only at
// the render/request boundary (see
// features/maps/components/charging-places/helpers.ts).
// =============================================================================

/**
 * useGeofenceNeedsReview — GET /geofences/needs-review
 *
 * The auto-discovered "Needs Setup" queue: provisional charging-place
 * geofences (`origin: 'charging_discovery'`, `needs_review: true`) awaiting
 * a human to confirm/edit their name, category, or location.
 */
export function useGeofenceNeedsReview() {
  return useQuery({
    queryKey: locationKeys.geofencesNeedsReview,
    queryFn: ({ signal }) => request<ApiGeofence[]>('/geofences/needs-review', { signal }),
    select: safeArray,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/**
 * useGeofenceCurrentRates — GET /geofences/rates/current
 *
 * The currently-active rate (if any) for every geofence in one round trip
 * — powers the Charging Places list's rate column without a per-row N+1
 * lookup. A geofence with no row here has never had a rate configured.
 */
export function useGeofenceCurrentRates() {
  return useQuery({
    queryKey: locationKeys.geofenceRatesCurrent,
    queryFn: ({ signal }) => request<GeofenceRate[]>('/geofences/rates/current', { signal }),
    select: safeArray,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/** Shared invalidation for the three archive-lifecycle mutations below. */
function invalidateGeofenceLifecycle(qc: ReturnType<typeof useQueryClient>) {
  invalidateAndBroadcast(qc, { queryKey: locationKeys.geofences });
  invalidateAndBroadcast(qc, { queryKey: locationKeys.geofencesNeedsReview });
  invalidateAndBroadcast(qc, { queryKey: locationKeys.geofenceRatesCurrent });
}

/**
 * useArchiveGeofence — POST /geofences/{geofenceID}/archive
 *
 * Soft-deletes a charging place: idempotent, excludes it from default
 * active listings, but keeps it resolvable by id for historical charging
 * activity (never a hard delete once a place has sessions/rates).
 */
export function useArchiveGeofence() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (geofenceId: number) =>
      request<ApiGeofence>(`/geofences/${geofenceId}/archive`, { method: 'POST' }),
    onSuccess: () => {
      invalidateGeofenceLifecycle(qc);
      success('toast.geofence.archive.success', 'Place archived');
    },
    onError: (err) => error(err, 'toast.geofence.archive.error', 'Failed to archive place'),
  });
}

/**
 * useUnarchiveGeofence — POST /geofences/{geofenceID}/unarchive
 *
 * Restores a previously archived place to the default active listings.
 * Idempotent.
 */
export function useUnarchiveGeofence() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (geofenceId: number) =>
      request<ApiGeofence>(`/geofences/${geofenceId}/unarchive`, { method: 'POST' }),
    onSuccess: () => {
      invalidateGeofenceLifecycle(qc);
      success('toast.geofence.unarchive.success', 'Place restored');
    },
    onError: (err) => error(err, 'toast.geofence.unarchive.error', 'Failed to restore place'),
  });
}

/**
 * useMarkGeofenceReviewed — POST /geofences/{geofenceID}/reviewed
 *
 * Clears `needs_review` once a human has confirmed/edited an
 * auto-discovered place's name, category, or location — removes it from
 * the "Needs Setup" queue without any other change.
 */
export function useMarkGeofenceReviewed() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (geofenceId: number) =>
      request<ApiGeofence>(`/geofences/${geofenceId}/reviewed`, { method: 'POST' }),
    onSuccess: () => {
      invalidateGeofenceLifecycle(qc);
      success('toast.geofence.reviewed.success', 'Marked reviewed');
    },
    onError: (err) => error(err, 'toast.geofence.reviewed.error', 'Failed to mark reviewed'),
  });
}

/** Rename a charging place without requiring the caller to resend geometry. */
export function useRenameGeofence() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ geofenceId, name }: { geofenceId: number; name: string }) =>
      request<ApiGeofence>(`/geofences/${geofenceId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      invalidateGeofenceLifecycle(qc);
      success('toast.geofence.rename.success', 'Place renamed');
    },
    onError: (err) => error(err, 'toast.geofence.rename.error', 'Failed to rename place'),
  });
}

/**
 * useGeofenceRates — GET /geofences/{geofenceID}/rates
 *
 * Every time-versioned rate row for one place, newest `effective_from`
 * first — the shape the rate-history panel renders directly.
 */
export function useGeofenceRates(geofenceId?: number) {
  return useQuery({
    queryKey: locationKeys.geofenceRates(geofenceId ?? 0),
    queryFn: ({ signal }) => request<GeofenceRate[]>(`/geofences/${geofenceId}/rates`, { signal }),
    enabled: !!geofenceId,
    select: safeArray,
  });
}

/**
 * useCreateGeofenceRate — POST /geofences/{geofenceID}/rates
 *
 * Adds a new time-versioned rate for a place — first-time setup, a future
 * scheduled change, or a correction. There is no separate "replace"
 * endpoint: a correction is just another call with an `effective_from` at
 * or after the point the correction should take hold; an open-ended new
 * version closes the existing unbounded interval. Callers pass `rate_per_wh`
 * (never a per-kWh value) — convert user-entered currency/kWh at the call
 * site (see charging-places/helpers.ts).
 */
export function useCreateGeofenceRate() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ geofenceId, ...body }: { geofenceId: number } & GeofenceRateCreateRequest) =>
      request<GeofenceRate>(`/geofences/${geofenceId}/rates`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofenceRates(vars.geofenceId) });
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofenceRatesCurrent });
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofences });
      success('toast.geofenceRate.create.success', 'Rate saved');
    },
    onError: (err) => error(err, 'toast.geofenceRate.create.error', 'Failed to save rate'),
  });
}

/**
 * useDeleteGeofenceRate — DELETE /geofences/{geofenceID}/rates/{rateID}
 *
 * Cancels an unused future schedule. Effective or referenced rates are
 * immutable; the backend restores the prior adjacent interval so no future
 * pricing gap is introduced.
 */
export function useDeleteGeofenceRate() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ geofenceId, rateId }: { geofenceId: number; rateId: number }) =>
      request<void>(`/geofences/${geofenceId}/rates/${rateId}`, { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofenceRates(vars.geofenceId) });
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofenceRatesCurrent });
      success('toast.geofenceRate.delete.success', 'Scheduled rate cancelled');
    },
    onError: (err) =>
      error(err, 'toast.geofenceRate.delete.error', 'Failed to cancel scheduled rate'),
  });
}

/**
 * useGeofenceRatePreview — GET
 * /geofences/{geofenceID}/rates/{rateID}/preview[?from&to]
 *
 * Read-only: reports how many charging sessions are matched (in scope by
 * place + time), eligible (would actually be repriced — unpriced or
 * previously geofence-derived), and protected (in scope but already carry
 * a manual/Tesla-actual cost or an existing cost with unknown provenance),
 * plus the estimated total cost at this rate. `from`/`to` optionally narrow
 * the scope further; both default to the rate's own effective interval.
 * Disabled until both ids are known (e.g. before a rate row is selected).
 */
export function useGeofenceRatePreview(
  geofenceId?: number,
  rateId?: number,
  range: { from?: string; to?: string } = {},
) {
  return useQuery({
    queryKey: locationKeys.geofenceRatePreview(geofenceId ?? 0, rateId ?? 0, range.from, range.to),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      const qs = params.toString();
      return request<GeofenceRateImpactPreview>(
        `/geofences/${geofenceId}/rates/${rateId}/preview${qs ? `?${qs}` : ''}`,
        { signal },
      );
    },
    enabled: !!geofenceId && !!rateId,
  });
}

/**
 * useApplyGeofenceRate — POST
 * /geofences/{geofenceID}/rates/{rateID}/apply[?from&to]
 *
 * The write-performing, explicit backfill/reprice action — the only way
 * historical sessions are ever repriced. Bounded to this geofence + rate's
 * interval (optionally narrowed further by `from`/`to`), idempotent, and
 * never overwrites a manual/Tesla-actual cost or an existing cost with
 * unknown provenance. On success, invalidates this place's charging
 * summary/activity AND the global charging-sessions cache, since an apply
 * can change `cost_decimal`/`cost_source` on many rows at once.
 */
export function useApplyGeofenceRate() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({
      geofenceId,
      rateId,
      from,
      to,
    }: {
      geofenceId: number;
      rateId: number;
      from?: string;
      to?: string;
    }) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return request<GeofenceRateApplyResult>(
        `/geofences/${geofenceId}/rates/${rateId}/apply${qs ? `?${qs}` : ''}`,
        { method: 'POST' },
      );
    },
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofenceChargingSummary(vars.geofenceId) });
      // charging-activity keys are parameterized by limit/offset per page;
      // invalidate the whole ['geofences', id, 'charging-activity'] subtree
      // (TanStack matches by prefix) rather than enumerate every page.
      invalidateAndBroadcast(qc, {
        queryKey: ['geofences', vars.geofenceId, 'charging-activity'],
      });
      invalidateAndBroadcast(qc, { queryKey: chargingKeys.all });
      success('toast.geofenceRate.apply.success', 'Rate applied to matching sessions');
    },
    onError: (err) => error(err, 'toast.geofenceRate.apply.error', 'Failed to apply rate'),
  });
}

/**
 * useGeofenceChargingSummary — GET /geofences/{geofenceID}/charging-summary
 *
 * Priced charging-activity totals for one place, ALWAYS grouped by
 * currency (never summed across currencies) — one array entry per
 * currency this place has ever billed in.
 */
export function useGeofenceChargingSummary(geofenceId?: number) {
  return useQuery({
    queryKey: locationKeys.geofenceChargingSummary(geofenceId ?? 0),
    queryFn: ({ signal }) =>
      request<GeofenceChargingSummary[]>(`/geofences/${geofenceId}/charging-summary`, { signal }),
    enabled: !!geofenceId,
    select: safeArray,
  });
}

/**
 * useGeofenceChargingActivity — GET
 * /geofences/{geofenceID}/charging-activity[?limit&offset]
 *
 * Paginated session-level activity feed for one place (any pricing
 * state — not just priced rows) backing the rate-history /
 * affected-sessions UI panel. Mirrors the backend's `apiparams.Pagination`
 * defaults (limit 50, offset 0) when not given explicitly.
 */
export function useGeofenceChargingActivity(
  geofenceId?: number,
  limit = 50,
  offset = 0,
) {
  return useQuery({
    queryKey: locationKeys.geofenceChargingActivity(geofenceId ?? 0, limit, offset),
    queryFn: ({ signal }) =>
      request<GeofenceChargingActivity[]>(
        `/geofences/${geofenceId}/charging-activity?limit=${limit}&offset=${offset}`,
        { signal },
      ),
    enabled: !!geofenceId,
    select: safeArray,
  });
}
