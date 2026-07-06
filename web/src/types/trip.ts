/**
 * Trip domain view-models.
 *
 * The canonical trip shapes emitted by the Go trips handlers (snake_case
 * keys — keep in sync with the response maps in `internal/api/trips` and
 * `internal/api/tripsdetail`). They are re-exported from `@/api/types` — the
 * single source of truth for API wire contracts — so trip-domain code can
 * follow the `@/types/*` module convention (mirroring `@/types/driving` and
 * `@/types/energy`) instead of reaching into the aggregate `@/api/types`
 * barrel.
 *
 *   • {@link Trip}             — the list-row shape from `GET /trips`.
 *   • {@link TripDriveSummary} — one per-drive row inside a trip detail.
 *   • {@link TripDetail}       — `GET /trips/{trip_id}`: a superset of
 *     {@link Trip} that additionally carries `drives[]` and the
 *     `energy_used_wh` alias of `total_energy_wh`.
 *
 * All distance/energy/duration figures are SI canonical (`*_m`, `*_wh`,
 * `*_s`) per the Phase-48 migration — never miles/kWh/minutes. Read them
 * verbatim and apply the user's unit preference at the render boundary via
 * `useUnits()`.
 */
export type { Trip, TripDetail, TripDriveSummary } from '@/api/types';
