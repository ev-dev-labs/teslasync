/**
 * Pure, null-safe derivations for the Live Signal Inspector.
 *
 * The backend `signalinspect.LiveState` handler returns a rich per-signal
 * envelope — `{ kind, value, ts, timestamp, source, age_ms }` — or, for
 * legacy/codec-flattened rows, a bare scalar. Every consumer on the page
 * (KPI band, source-layer breakdown, kind breakdown, snapshot table) reads
 * from the flat `LiveSignalRow[]` + `LiveSignalStats` shapes produced here so
 * the coercion logic lives in exactly one tested place.
 */
import type {
  VehicleLiveSignal,
  VehicleLiveSignalsResponse,
} from '@/api/hooks/useTelemetry';
import type { SignalSource } from '@/components/data-display';

/** Flat row consumed by the table + breakdown panels. */
export interface LiveSignalRow {
  name: string;
  value: unknown;
  kind?: string;
  source?: SignalSource;
  ageMs?: number;
  timestamp?: string;
}

/** High-level value-kind buckets surfaced in the kind breakdown chart. */
export type KindCategory =
  | 'numeric'
  | 'boolean'
  | 'text'
  | 'enum'
  | 'time'
  | 'compound'
  | 'other';

/** Normalised live-state source buckets (matches the layered contract). */
export type LiveSourceKey = 'l1' | 'l2' | 'stale' | 'unknown';

export interface KindBucket {
  category: KindCategory;
  count: number;
}

export interface LiveSignalStats {
  total: number;
  /** L1 — fresh in-process reads. */
  live: number;
  /** Values older than the 2-minute freshness window. */
  stale: number;
  /** L2 — legacy Redis entries of unknown freshness. */
  legacy: number;
  /** Count of numeric-kind fields. */
  numeric: number;
  bySource: Record<LiveSourceKey, number>;
  byKind: KindBucket[];
  /** Age (ms) of the freshest signal in the snapshot, or null when unknown. */
  freshestAgeMs: number | null;
}

/** Discriminates the render state of each self-sufficient page section. */
export type SectionStatus = 'no-vehicle' | 'loading' | 'error' | 'empty' | 'ready';

const NUMERIC_KINDS = new Set([
  'ValueKindFloat',
  'ValueKindDouble',
  'ValueKindInt32',
  'ValueKindInt64',
  'ValueKindUint32',
  'ValueKindUint64',
]);
const BOOL_KINDS = new Set(['ValueKindBool', 'ValueKindBoolean']);
const TEXT_KINDS = new Set(['ValueKindString']);
const ENUM_KINDS = new Set(['ValueKindEnum']);
const TIME_KINDS = new Set(['ValueKindTime', 'ValueKindUnixTime']);

/** Stable display order for the kind breakdown. */
export const KIND_ORDER: readonly KindCategory[] = [
  'numeric',
  'boolean',
  'text',
  'enum',
  'time',
  'compound',
  'other',
];

/** i18n key + fallback for each kind category (shared by chart + table). */
export const KIND_LABELS: Record<
  KindCategory,
  { key: string; fallback: string }
> = {
  numeric: { key: 'admin.liveSignals.kind.numeric', fallback: 'Numeric' },
  boolean: { key: 'admin.liveSignals.kind.boolean', fallback: 'Boolean' },
  text: { key: 'admin.liveSignals.kind.text', fallback: 'Text' },
  enum: { key: 'admin.liveSignals.kind.enum', fallback: 'Enum' },
  time: { key: 'admin.liveSignals.kind.time', fallback: 'Time' },
  compound: { key: 'admin.liveSignals.kind.compound', fallback: 'Compound' },
  other: { key: 'admin.liveSignals.kind.other', fallback: 'Other' },
};

function isEnvelope(raw: unknown): raw is VehicleLiveSignal {
  return (
    !!raw &&
    typeof raw === 'object' &&
    'value' in (raw as Record<string, unknown>)
  );
}

/**
 * Normalise a single `signals` entry into a flat row. Accepts both the typed
 * envelope and a bare scalar; unknown/malformed shapes degrade gracefully.
 */
export function rowFromEntry(name: string, raw: unknown): LiveSignalRow {
  if (isEnvelope(raw)) {
    const env = raw as VehicleLiveSignal;
    return {
      name,
      value: env.value,
      kind: typeof env.kind === 'string' ? env.kind : undefined,
      source:
        typeof env.source === 'string'
          ? (env.source as SignalSource)
          : undefined,
      ageMs:
        typeof env.age_ms === 'number' && Number.isFinite(env.age_ms)
          ? env.age_ms
          : undefined,
      timestamp: env.timestamp ?? env.ts,
    };
  }
  return { name, value: raw };
}

/** Flatten the API response into rows. Always returns an array. */
export function rowsFromResponse(
  data: VehicleLiveSignalsResponse | undefined,
): LiveSignalRow[] {
  const signals = (data?.signals ?? {}) as Record<string, unknown>;
  return Object.keys(signals).map((name) => rowFromEntry(name, signals[name]));
}

/**
 * Bucket a signal into a high-level kind category. Prefers the backend's
 * canonical `ValueKind` name; falls back to the JS runtime type of the value
 * for bare-scalar legacy rows that carry no `kind`.
 */
export function classifyKind(
  kind: string | undefined,
  value: unknown,
): KindCategory {
  if (kind) {
    if (NUMERIC_KINDS.has(kind)) return 'numeric';
    if (BOOL_KINDS.has(kind)) return 'boolean';
    if (TEXT_KINDS.has(kind)) return 'text';
    if (ENUM_KINDS.has(kind)) return 'enum';
    if (TIME_KINDS.has(kind)) return 'time';
    if (kind.includes('Compound')) return 'compound';
  }
  const tv = typeof value;
  if (tv === 'number') return 'numeric';
  if (tv === 'boolean') return 'boolean';
  if (tv === 'string') return 'text';
  if (value != null && tv === 'object') return 'compound';
  return 'other';
}

/** Map any backend source string onto the four normalised buckets. */
export function normalizeSource(source: string | undefined): LiveSourceKey {
  switch ((source ?? '').toLowerCase()) {
    case 'l1':
      return 'l1';
    case 'l2':
      return 'l2';
    case 'stale':
      return 'stale';
    default:
      return 'unknown';
  }
}

/**
 * Compute all page-level aggregates in a single pass. Null-safe: a nullish
 * `rows` (e.g. before the first live poll resolves) degrades to a fully
 * zeroed snapshot rather than throwing.
 */
export function computeStats(
  rows: LiveSignalRow[] | null | undefined,
): LiveSignalStats {
  const list = rows ?? [];
  const bySource: Record<LiveSourceKey, number> = {
    l1: 0,
    l2: 0,
    stale: 0,
    unknown: 0,
  };
  const kindCounts = new Map<KindCategory, number>();
  let numeric = 0;
  let freshestAgeMs: number | null = null;

  for (const row of list) {
    bySource[normalizeSource(row.source)] += 1;
    const category = classifyKind(row.kind, row.value);
    kindCounts.set(category, (kindCounts.get(category) ?? 0) + 1);
    if (category === 'numeric') numeric += 1;
    if (typeof row.ageMs === 'number' && Number.isFinite(row.ageMs)) {
      freshestAgeMs =
        freshestAgeMs == null ? row.ageMs : Math.min(freshestAgeMs, row.ageMs);
    }
  }

  const byKind: KindBucket[] = KIND_ORDER.map((category) => ({
    category,
    count: kindCounts.get(category) ?? 0,
  })).filter((bucket) => bucket.count > 0);

  return {
    total: list.length,
    live: bySource.l1,
    stale: bySource.stale,
    legacy: bySource.l2,
    numeric,
    bySource,
    byKind,
    freshestAgeMs,
  };
}

/** Compact human-readable age. Returns an em dash for unknown ages. */
export function formatAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
