import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
import type { SignalHistoryResponse, SignalStats, TelemetryStatus, VehicleTelemetry } from '@/types/telemetry';
import { telemetryUptimeSeconds, telemetryVehicleList } from '@/types/telemetry';
import type { SignalCatalogEntry, SignalObservation } from '@/types/signals';

export const telemetryKeys = {
  signals: (vehicleId: number) => ['signals', vehicleId] as const,
  liveSignals: (vehicleId?: number) => ['live-signals', vehicleId] as const,
  signalStats: (vehicleId: number) => ['signal-stats', vehicleId] as const,
  signalHistory: (vehicleId: number, signal: string, hours: number) => ['signal-history', vehicleId, signal, hours] as const,
  signalAnalysisHistory: (vehicleId: number, signal: string, hours: number, limit: number) =>
    ['signal-analysis-history', vehicleId, signal, hours, limit] as const,
  signalEvidenceHistory: (vehicleId: number, signal: string, hours: number, limit: number) =>
    ['signal-evidence-history', vehicleId, signal, hours, limit] as const,
  signalLog: (vehicleId: number, signal: string, hours: number, page: number) => ['signal-log', vehicleId, signal, hours, page] as const,
  signalDiff: (vehicleId: number, signal: string, from: string, to: string) => ['signal-diff', vehicleId, signal, from, to] as const,
  signalDiffServer: (vehicleId: number, atA: string, atB: string, signalsCsv: string) =>
    ['signal-diff-server', vehicleId, atA, atB, signalsCsv] as const,
  signalSnapshot: (vehicleId: number, at: string, signalsCsv: string) =>
    ['signal-snapshot', vehicleId, at, signalsCsv] as const,
  signalGaps: (vehicleId: number) => ['signal-gaps', vehicleId] as const,
  mqttStatus: ['mqtt-status'] as const,
};

export interface VehicleLiveSignal {
  value: unknown;
  timestamp?: string;
  /**
   * Canonical `protomodel.ValueKind` name for the field, e.g.
   * `"ValueKindFloat"` / `"ValueKindBool"` (Phase-42 typed live envelope).
   */
  kind?: string;
  /**
   * Layered live-state source classification emitted by the backend
   * `signalinspect` handler: `'l1'` (fresh in-process), `'l2'` (legacy Redis),
   * `'stale'` (older than the freshness window), or `'unknown'`.
   */
  source?: string;
  /** Age of the value in milliseconds at read time. */
  age_ms?: number;
  /** Typed timestamp mirror of `timestamp`. */
  ts?: string;
}

export interface SignalEvidenceBundleSeries {
  signal: string;
  response: SignalHistoryResponse;
}

export interface SignalEvidenceBundleResult {
  data: SignalEvidenceBundleSeries[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export interface VehicleLiveSignalsResponse {
  vehicle_id?: number;
  /** Number of live signals in the snapshot (backend-computed). */
  count?: number;
  /** Server timestamp when the snapshot was assembled. */
  at?: string;
  signals?: Record<string, VehicleLiveSignal | unknown>;
}

/**
 * useSignals — list of available signal NAMES for a vehicle.
 *
 * Backend returns the rich catalog shape `{ signals: AvailableSignal[] }`
 * where each entry is
 * `{ name, category, value_kind, unit_kind, is_compound, is_setting_unit }`.
 * This hook normalizes that response down to `string[]` of signal names
 * because every consumer (SignalLogViewerPage, SignalExplorerPage,
 * SignalDiffPage, LiveSignalSparklinesWidget, SignalHealthWidget)
 * already treats the result as a flat list of names.
 *
 * For the typed/rich catalog (with value_kind / unit_kind discriminators)
 * use `useAvailableSignals` from `@/api/hooks/useSignals` instead.
 *
 * Legacy fallback: older deployments returned bare `string[]` or
 * `{ signals: string[] }`. Both shapes are still accepted; malformed
 * entries (non-string, missing `name`) are dropped silently.
 */
export function useSignals(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signals(vehicleId),
    queryFn: async ({ signal }): Promise<string[]> => {
      const resp = await request<
        | { signals?: Array<{ name?: unknown } | string> }
        | Array<{ name?: unknown } | string>
      >(`/signals/${vehicleId}/available`, { signal });

      const arr: unknown[] = Array.isArray(resp)
        ? resp
        : ((resp as { signals?: unknown[] })?.signals ?? []);

      return arr.reduce<string[]>((acc, entry) => {
        if (typeof entry === 'string') {
          acc.push(entry);
        } else if (entry && typeof entry === 'object' && 'name' in entry) {
          const name = (entry as { name: unknown }).name;
          if (typeof name === 'string' && name.length > 0) acc.push(name);
        }
        return acc;
      }, []);
    },
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function getVehicleLiveSignals(
  vehicleId: number,
  opts?: { signal?: AbortSignal | null },
) {
  return request<VehicleLiveSignalsResponse>(`/signals/${vehicleId}/live`, {
    signal: opts?.signal,
  });
}

export interface UseVehicleLiveSignalsOptions {
  /**
   * Override the default refetch cadence. The page-level Live Signal
   * Inspector uses 1 s for a near-realtime feel; widgets embedded on
   * a dashboard can stay on STALE_TIMES.REALTIME (5 s) to keep cost low.
   */
  refetchInterval?: number;
  /** Disable polling without unmounting the hook. */
  enabled?: boolean;
}

export function useVehicleLiveSignals(
  vehicleId?: number,
  opts?: UseVehicleLiveSignalsOptions,
) {
  const enabled = opts?.enabled ?? true;
  return useQuery({
    queryKey: telemetryKeys.liveSignals(vehicleId),
    queryFn: ({ signal }) => getVehicleLiveSignals(vehicleId ?? 0, { signal }),
    enabled: !!vehicleId && enabled,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: opts?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useSignalStats(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalStats(vehicleId),
    queryFn: ({ signal }) => request<SignalStats>(`/signals/${vehicleId}/stats`, { signal }),
    enabled: vehicleId > 0,
  });
}

export function useSignalHistory(vehicleId: number, signal: string, hours: number) {
  return useQuery({
    queryKey: telemetryKeys.signalHistory(vehicleId, signal, hours),
    // Rename the query context's AbortSignal so it does NOT shadow the outer
    // `signal` (the signal NAME). Destructuring `{ signal }` here would
    // stringify the AbortSignal into the URL path segment
    // (`/signals/1/[object AbortSignal]/history`) and drop the name entirely.
    queryFn: ({ signal: abortSignal }) =>
      request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?hours=${hours}`, { signal: abortSignal }),
    enabled: vehicleId > 0 && !!signal,
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * Fetches the backend's largest supported signal window for statistical
 * analysis without expanding ordinary sparkline/history queries.
 */
export function useSignalAnalysisHistory(
  vehicleId: number,
  signalName: string,
  hours: number,
  limit = 10_000,
) {
  const boundedHours = Number.isFinite(hours)
    ? Math.max(1, Math.min(24 * 365, Math.floor(hours)))
    : 24;
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(10_000, Math.floor(limit)))
    : 10_000;
  return useQuery({
    queryKey: telemetryKeys.signalAnalysisHistory(
      vehicleId,
      signalName,
      boundedHours,
      boundedLimit,
    ),
    queryFn: ({ signal }) =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${encodeURIComponent(signalName)}/history?hours=${boundedHours}&limit=${boundedLimit}`,
        { signal },
      ),
    enabled: vehicleId > 0 && signalName.length > 0,
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
  });
}

/**
 * Loads a bounded set of signal histories for local evidence analysis.
 * Each signal keeps an independent cache entry and cancellation signal so
 * changing the focal signal does not strand obsolete multi-request work.
 */
export function useSignalEvidenceBundle(
  vehicleId: number,
  signalNames: readonly string[],
  hours: number,
  limit = 10_000,
): SignalEvidenceBundleResult {
  const boundedHours = Number.isFinite(hours)
    ? Math.max(1, Math.min(24 * 365, Math.floor(hours)))
    : 72;
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(10_000, Math.floor(limit)))
    : 10_000;
  const normalizedSignals = Array.from(
    new Set(signalNames.map((name) => name.trim()).filter((name) => name.length > 0)),
  ).slice(0, 8);

  return useQueries({
    queries: normalizedSignals.map((signalName) => ({
      queryKey: telemetryKeys.signalEvidenceHistory(
        vehicleId,
        signalName,
        boundedHours,
        boundedLimit,
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request<SignalHistoryResponse>(
          `/signals/${vehicleId}/${encodeURIComponent(signalName)}/history?hours=${boundedHours}&limit=${boundedLimit}`,
          { signal },
        ),
      enabled: vehicleId > 0,
      staleTime: STALE_TIMES.MODERATE,
      refetchInterval: false,
    })),
    combine: (results): SignalEvidenceBundleResult => ({
      data: results.flatMap((result, index) =>
        result.data == null
          ? []
          : [{ signal: normalizedSignals[index]!, response: result.data }],
      ),
      isLoading: results.some((result) => result.isLoading),
      isFetching: results.some((result) => result.isFetching),
      isError: results.some((result) => result.isError),
      error: results.find((result) => result.error != null)?.error ?? null,
      refetch: async () => {
        await Promise.all(results.map((result) => result.refetch()));
      },
    }),
  });
}

export function useSignalLog(vehicleId: number, signal: string, hours: number, page: number, pageSize: number) {
  return useQuery({
    queryKey: telemetryKeys.signalLog(vehicleId, signal, hours, page),
    queryFn: ({ signal: abortSignal }) =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signal}/history?hours=${hours}&page=${page}&page_size=${pageSize}`, { signal: abortSignal }
      ),
    enabled: vehicleId > 0 && !!signal,
  });
}

export function useSignalDiff(vehicleId: number, signal: string, from: string, to: string) {
  return useQuery({
    queryKey: telemetryKeys.signalDiff(vehicleId, signal, from, to),
    queryFn: ({ signal: abortSignal }) =>
      request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?from=${from}&to=${to}`, { signal: abortSignal }),
    enabled: vehicleId > 0 && !!signal && !!from && !!to,
  });
}

// ─── Server-side diff & point-in-time snapshot ────────────────────────────

export type SignalSourceLayer = 'l1' | 'l2' | 'log' | 'stale' | 'unknown';

export interface SignalSnapshotEntry {
  value: unknown;
  timestamp?: string;
  source?: SignalSourceLayer;
  age_ms?: number;
}

export interface SignalSnapshotResponse {
  vehicle_id: number;
  at?: string;
  count: number;
  signals: Record<string, SignalSnapshotEntry>;
}

export interface SignalDiffRow {
  name: string;
  value_a: unknown;
  value_b: unknown;
  source_a?: SignalSourceLayer;
  source_b?: SignalSourceLayer;
  age_ms_a?: number;
  age_ms_b?: number;
  changed: boolean;
}

export interface SignalDiffServerResponse {
  vehicle_id: number;
  at_a: string;
  at_b: string;
  count: number;
  data: SignalDiffRow[];
}

/**
 * Fetch a point-in-time signal snapshot. Pass `at=''` to read live state.
 * Supplying a CSV of signal names narrows the
 * server-side response so dense vehicles don't ship 200+ values per call.
 */
export function useSignalSnapshot(
  vehicleId: number,
  at: string,
  signalsCsv: string = '',
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery({
    queryKey: telemetryKeys.signalSnapshot(vehicleId, at, signalsCsv),
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (at) usp.set('at', at);
      if (signalsCsv) usp.set('signals', signalsCsv);
      const qs = usp.toString();
      return request<SignalSnapshotResponse>(
        `/signals/${vehicleId}/snapshot${qs ? `?${qs}` : ''}`, { signal },
      );
    },
    enabled: (options?.enabled ?? true) && vehicleId > 0,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Fetch the server-side diff between two snapshots. Unchanged signals are
 * filtered out by the backend so the response stays
 * compact.
 */
export function useSignalDiffServer(
  vehicleId: number,
  atA: string,
  atB: string,
  signalsCsv: string = '',
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: telemetryKeys.signalDiffServer(vehicleId, atA, atB, signalsCsv),
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (atA) usp.set('at_a', atA);
      if (atB) usp.set('at_b', atB);
      if (signalsCsv) usp.set('signals', signalsCsv);
      return request<SignalDiffServerResponse>(
        `/signals/${vehicleId}/diff?${usp.toString()}`, { signal },
      );
    },
    enabled: (options?.enabled ?? true) && vehicleId > 0 && !!atA && !!atB,
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useSignalGaps(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalGaps(vehicleId),
    queryFn: async ({ signal }) => {
      const res = await request<{ signals?: Record<string, { value: unknown; timestamp: string }> }>(`/signals/${vehicleId}/live`, { signal });
      return res.signals ?? {};
    },
    enabled: vehicleId > 0,
    refetchInterval: INTERVALS.REALTIME,
  });
}

export function useMQTTStatus() {
  return useQuery({
    queryKey: telemetryKeys.mqttStatus,
    queryFn: async ({ signal }) => {
      const raw = await request<TelemetryStatus>('/telemetry', { signal });
      // The backend has shipped vehicles as an array or a Record<vin, …> map,
      // under `vehicles` or the older `streaming_vehicles`, in either casing.
      // telemetryVehicleList() collapses all of that to one normalized array
      // (and telemetryUptimeSeconds() resolves the dual-shape uptime field).
      return {
        ...raw,
        uptimeSeconds: telemetryUptimeSeconds(raw),
        vehicles: telemetryVehicleList(raw),
      } as TelemetryStatus & { vehicles: VehicleTelemetry[] };
    },
    refetchInterval: INTERVALS.REALTIME,
  });
}

// ─── Typed Signal Hooks ──────────────────────────────────────────────────────

/**
 * DEPRECATED. The backend `/signals/catalog` route was deleted alongside
 * `signal_catalog_handler.go`; the typed
 * `signal_log` pipeline (migrations 000167+) plus
 * `internal/api/signal_handler.go`'s `/signals/{vehicleID}/available`
 * endpoint are now the authoritative catalog surface. This hook will
 * reliably 404 in production. Kept (not removed) because the
 * `features/dashboard` SignalCatalogWidget still imports it; its UI
 * surfaces the resulting query error gracefully. A future replacement
 * should source the catalog from `useSignals()` (via `/available`) or
 * from `protomodel.Signals` exposed through a new endpoint.
 */
export function useSignalCatalog() {
  return useQuery({
    queryKey: ['signal-catalog'],
    queryFn: ({ signal }) => request<SignalCatalogEntry[]>('/signals/catalog', { signal }),
    staleTime: STALE_TIMES.SLOW,
  });
}

/**
 * RESTORED. The backend `/signals/observations` route is back, but with
 * a modern enveloped contract that does NOT match the legacy
 * `signal_observations` table the hook was originally written against.
 * Specifically, the new backend:
 *   - filters by `field=` (not `signal_name=`),
 *   - returns `{count, total, observations: [{vehicle_id, ts, field,
 *     value_kind, value}]}` (not a bare array),
 *   - encodes value as a single `value` column with a `value_kind`
 *     discriminator (`ValueKindFloat`, `ValueKindDouble`,
 *     `ValueKindInt32`, `ValueKindInt64`, `ValueKindString`,
 *     `ValueKindBool`, `ValueKindEnum`, …) — not the trio of
 *     `value_numeric` / `value_text` / `value_bool` columns the legacy
 *     `signal_observations` table had.
 *
 * The hook bridges the gap so the existing callers — AutopilotSection,
 * PowersharePage, SignalLogWidget — keep their `latestNumeric`,
 * `latestBool`, `latestText` extractors and the `signal_name`-shaped
 * frontend `SignalObservation` type. Without this adapter:
 *   - the `signal_name` query param was silently dropped server-side
 *     (the backend ignored it and returned WHATEVER rows were latest in
 *     `signal_log`), so panels showed the wrong signal's value, and
 *   - the envelope unwrapping never happened, so `data?.[0]` returned
 *     `undefined` and every consumer rendered "—".
 */
export function useSignalObservations(
  vehicleId: number | string | undefined,
  opts?: { signal_name?: string; since?: string; until?: string; limit?: number; refetchInterval?: number },
) {
  const params = new URLSearchParams();
  if (vehicleId != null) params.set('vehicle_id', String(vehicleId));
  // Backend accepts `field=` (matches `signal_log.field`); frontend
  // callers still use `signal_name` historically, so translate at the
  // wire boundary rather than ripple the rename through every caller.
  if (opts?.signal_name) params.set('field', opts.signal_name);
  if (opts?.since) params.set('since', opts.since);
  if (opts?.until) params.set('until', opts.until);
  if (opts?.limit) params.set('limit', String(opts.limit));

  return useQuery({
    queryKey: ['signal-observations', vehicleId, opts],
    queryFn: async ({ signal }) => {
      const envelope = await request<SignalsObservationsResponseRaw>(
        `/signals/observations?${params}`,
        { signal },
      );
      return adaptObservations(envelope);
    },
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: opts?.refetchInterval,
  });
}

// Wire shape returned by the modern /signals/observations endpoint.
// Both snake_case (`value_kind`) and camelCase (`valueKind`)
// shapes are tolerated because some `request` middleware variants in
// the codebase camelCase response keys; production uses snake_case but
// keeping both branches makes the adapter forward-compatible and keeps
// unit tests independent of the `request` mock's casing choice.
interface SignalsObservationsRowRaw {
  vehicle_id?: number;
  vehicleId?: number;
  ts: string;
  field?: string;
  value_kind?: string;
  valueKind?: string;
  value: unknown;
}

interface SignalsObservationsResponseRaw {
  count?: number;
  total?: number;
  observations?: SignalsObservationsRowRaw[];
}

// ValueKind enum literals emitted by `protomodel.ValueKind.String()`
// (cmd/pub-test-signal/main.go documents the full set). Grouped by how
// the legacy frontend `SignalObservation` shape stores them.
const NUMERIC_VALUE_KINDS = new Set([
  'ValueKindFloat',
  'ValueKindDouble',
  'ValueKindInt32',
  'ValueKindInt64',
  'ValueKindUnixTime', // seconds since epoch — numeric for legacy callers
]);
const TEXT_VALUE_KINDS = new Set([
  'ValueKindString',
  'ValueKindEnum', // proto-prefixed enum names like "ShiftStateD" or "FollowDistance7"
]);
const BOOL_VALUE_KINDS = new Set(['ValueKindBool', 'ValueKindBoolean']);

function adaptObservations(envelope: SignalsObservationsResponseRaw | null | undefined): SignalObservation[] {
  const rows = envelope?.observations ?? [];
  return rows.map((row): SignalObservation => {
    const kind = row.value_kind ?? row.valueKind ?? '';
    const field = row.field ?? '';
    const vehicleId = row.vehicle_id ?? row.vehicleId ?? 0;

    let valueNumeric: number | null = null;
    let valueText: string | null = null;
    let valueBool: boolean | null = null;

    if (NUMERIC_VALUE_KINDS.has(kind)) {
      // Number(null) = 0 and Number(undefined) = NaN — guard explicitly
      // so neither sentinel coerces to a misleading 0 in downstream
      // aggregations (helpers.ts:computeMotorStats, etc.).
      if (row.value == null) {
        valueNumeric = null;
      } else {
        const n = typeof row.value === 'number' ? row.value : Number(row.value);
        valueNumeric = Number.isFinite(n) ? n : null;
      }
    } else if (TEXT_VALUE_KINDS.has(kind)) {
      valueText = row.value == null ? null : String(row.value);
    } else if (BOOL_VALUE_KINDS.has(kind)) {
      valueBool = typeof row.value === 'boolean' ? row.value : null;
    }
    // Compound kinds (CompoundLocation, CompoundDoors, CompoundTireLoc,
    // StringCompound) and unknown kinds intentionally fall through to
    // all-null — none of the legacy callers consume them via
    // latestNumeric / latestText / latestBool.

    return {
      vehicle_id: vehicleId,
      ts: row.ts,
      signal_name: field,
      value_numeric: valueNumeric,
      value_text: valueText,
      value_bool: valueBool,
      // The modern /signals/observations envelope does not expose the
      // ingestion source. Default to the dominant per-field MQTT path so
      // SignalLogWidget's source-color mapping renders something sane
      // rather than undefined.
      source: 'fleet_telemetry',
    };
  });
}

// ─── Fleet Telemetry Error Types ─────────────────────────────────────────────

export interface FleetTelemetryErrorVIN {
  id: number;
  vin: string;
  active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface FleetTelemetryError {
  id: number;
  vin: string;
  error_code: string | null;
  error_message: string | null;
  reported_at: string | null;
  tesla_updated_at: string | null;
  fetched_at: string;
}

// ─── Fleet Telemetry Error Hooks ─────────────────────────────────────────────

export function useFleetTelemetryErrorVINs() {
  return useQuery({
    queryKey: ['fleet-telemetry-error-vins'],
    queryFn: ({ signal }) => request<FleetTelemetryErrorVIN[]>('/tesla/fleet-telemetry/error-vins', { signal }),
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useFleetTelemetryErrors(vin?: string) {
  return useQuery({
    queryKey: ['fleet-telemetry-errors', vin],
    queryFn: ({ signal }) =>
      request<FleetTelemetryError[]>(
        `/tesla/fleet-telemetry/errors${vin ? `?vin=${vin}` : ''}`, { signal }
      ),
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useRefreshFleetTelemetryErrorVINs() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => request('/tesla/fleet-telemetry/error-vins/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet-telemetry-error-vins'] });
      toast.success('Telemetry error VINs refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh error VINs: ${err.message}`);
    },
  });
}

export function useRefreshFleetTelemetryErrors() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => request('/tesla/fleet-telemetry/errors/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet-telemetry-errors'] });
      toast.success('Telemetry errors refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh telemetry errors: ${err.message}`);
    },
  });
}
