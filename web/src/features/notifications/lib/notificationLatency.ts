/**
 * Notification delivery-latency analysis.
 *
 * Prefer the backend's measured `latency_ms`; older rows fall back to the
 * elapsed time from `created_at` to `sent_at`. Apdex uses a documented
 * threshold T (default 1 second): satisfied <= T, tolerating <= 4T, and
 * frustrated > 4T.
 *
 * Pure and React-free.
 */

import type { NotificationLog } from '@/api/types';

export type LatencySource = 'measured' | 'derived';

export interface LatencyRecord {
  id: number;
  title: string;
  severity: string;
  status: NotificationLog['status'];
  latencyMs: number;
  source: LatencySource;
  createdAt: string;
  sentAt: string | null;
}

export interface LatencyCohort {
  key: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
  tailShare: number;
}

export interface LatencyHistogramBin {
  lowerMs: number;
  upperMs: number | null;
  count: number;
  share: number;
}

export interface NotificationLatencySummary {
  count: number;
  thresholdMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  trimmedMeanMs: number | null;
  apdex: number | null;
  satisfied: number;
  tolerating: number;
  frustrated: number;
  tailShare: number | null;
  measuredShare: number | null;
  severityCohorts: LatencyCohort[];
  statusCohorts: LatencyCohort[];
  histogram: LatencyHistogramBin[];
  slowest: LatencyRecord[];
}

export interface NotificationLatencyOptions {
  thresholdMs?: number;
  trimFraction?: number;
  slowestLimit?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Linear R-7 percentile, matching common monitoring backends. */
export function percentile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp01(probability) * (sorted.length - 1);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower]! + ((sorted[lower + 1] ?? sorted[lower]!) - sorted[lower]!) * fraction;
}

export function latencyOf(log: NotificationLog): {
  latencyMs: number;
  source: LatencySource;
} | null {
  if (typeof log.latency_ms === 'number' && Number.isFinite(log.latency_ms) && log.latency_ms >= 0) {
    return { latencyMs: log.latency_ms, source: 'measured' };
  }
  if (log.sent_at == null) return null;
  const createdMs = Date.parse(log.created_at);
  const sentMs = Date.parse(log.sent_at);
  const latencyMs = sentMs - createdMs;
  return Number.isFinite(latencyMs) && latencyMs >= 0
    ? { latencyMs, source: 'derived' }
    : null;
}

export function trimmedMean(values: readonly number[], trimFraction = 0.1): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.min(
    Math.floor(sorted.length / 2),
    Math.floor(sorted.length * clamp01(trimFraction)),
  );
  const kept = sorted.slice(trim, sorted.length - trim);
  if (kept.length === 0) return null;
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function buildCohorts(
  records: readonly LatencyRecord[],
  keyOf: (record: LatencyRecord) => string,
  tailThresholdMs: number,
): LatencyCohort[] {
  const groups = new Map<string, number[]>();
  for (const record of records) {
    const key = keyOf(record);
    const group = groups.get(key) ?? [];
    group.push(record.latencyMs);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, values]) => ({
      key,
      count: values.length,
      p50Ms: round(percentile(values, 0.5) ?? 0),
      p95Ms: round(percentile(values, 0.95) ?? 0),
      meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
      tailShare: round(values.filter((value) => value > tailThresholdMs).length / values.length),
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count || a.key.localeCompare(b.key));
}

export function analyzeNotificationLatency(
  logs: readonly NotificationLog[],
  options: NotificationLatencyOptions = {},
): NotificationLatencySummary {
  const thresholdMs =
    options.thresholdMs != null && Number.isFinite(options.thresholdMs) && options.thresholdMs > 0
      ? options.thresholdMs
      : 1_000;
  const records: LatencyRecord[] = [];
  for (const log of logs) {
    const latency = latencyOf(log);
    if (latency == null) continue;
    records.push({
      id: log.id,
      title: log.title,
      severity: log.severity?.trim().toLowerCase() || 'unknown',
      status: log.status,
      latencyMs: latency.latencyMs,
      source: latency.source,
      createdAt: log.created_at,
      sentAt: log.sent_at,
    });
  }
  const values = records.map((record) => record.latencyMs);
  const satisfied = values.filter((value) => value <= thresholdMs).length;
  const tolerating = values.filter(
    (value) => value > thresholdMs && value <= thresholdMs * 4,
  ).length;
  const frustrated = values.filter((value) => value > thresholdMs * 4).length;
  const boundaries = [
    thresholdMs * 0.25,
    thresholdMs * 0.5,
    thresholdMs,
    thresholdMs * 2,
    thresholdMs * 4,
  ];
  const histogram = [...boundaries, null].map((upper, index) => {
    const lower = index === 0 ? 0 : boundaries[index - 1]!;
    const count = values.filter((value) =>
      upper == null
        ? value > lower
        : index === 0
          ? value <= upper
          : value > lower && value <= upper,
    ).length;
    return {
      lowerMs: lower,
      upperMs: upper,
      count,
      share: records.length > 0 ? round(count / records.length) : 0,
    };
  });
  const measured = records.filter((record) => record.source === 'measured').length;

  return {
    count: records.length,
    thresholdMs,
    p50Ms: values.length > 0 ? round(percentile(values, 0.5)!) : null,
    p95Ms: values.length > 0 ? round(percentile(values, 0.95)!) : null,
    p99Ms: values.length > 0 ? round(percentile(values, 0.99)!) : null,
    trimmedMeanMs: values.length > 0
      ? round(trimmedMean(values, options.trimFraction ?? 0.1)!)
      : null,
    apdex: records.length > 0 ? round((satisfied + tolerating / 2) / records.length) : null,
    satisfied,
    tolerating,
    frustrated,
    tailShare: records.length > 0 ? round(frustrated / records.length) : null,
    measuredShare: records.length > 0 ? round(measured / records.length) : null,
    severityCohorts: buildCohorts(records, (record) => record.severity, thresholdMs * 4),
    statusCohorts: buildCohorts(records, (record) => record.status, thresholdMs * 4),
    histogram,
    slowest: [...records]
      .sort((a, b) => b.latencyMs - a.latencyMs || b.id - a.id)
      .slice(0, Math.max(0, Math.floor(options.slowestLimit ?? 10))),
  };
}
