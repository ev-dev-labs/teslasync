import { describe, expect, it } from 'vitest';
import type { NotificationLog } from '@/api/types';
import {
  analyzeNotificationLatency,
  latencyOf,
  percentile,
  trimmedMean,
} from './notificationLatency';

const ANCHOR = Date.UTC(2026, 7, 4, 12);
let nextId = 1;

interface LogOptions {
  latencyMs?: number;
  elapsedMs?: number;
  status?: NotificationLog['status'];
  severity?: string;
  title?: string;
}

function log(options: LogOptions = {}): NotificationLog {
  const created = new Date(ANCHOR + nextId * 60_000);
  const status = options.status ?? 'sent';
  const entry: NotificationLog = {
    id: nextId++,
    channel_id: 1,
    alert_id: null,
    title: options.title ?? 'Notification',
    message: '',
    status,
    severity: options.severity ?? 'warning',
    error: '',
    created_at: created.toISOString(),
    sent_at: options.elapsedMs == null
      ? null
      : new Date(created.getTime() + options.elapsedMs).toISOString(),
  };
  if (options.latencyMs !== undefined) entry.latency_ms = options.latencyMs;
  return entry;
}

describe('latency primitives', () => {
  it('prefers measured latency over the timestamp fallback', () => {
    expect(latencyOf(log({ latencyMs: 125, elapsedMs: 9_000 }))).toEqual({
      latencyMs: 125,
      source: 'measured',
    });
  });

  it('derives latency from created to sent for legacy rows', () => {
    expect(latencyOf(log({ elapsedMs: 2_500 }))).toEqual({
      latencyMs: 2_500,
      source: 'derived',
    });
  });

  it('rejects negative or invalid elapsed time', () => {
    expect(latencyOf(log({ elapsedMs: -10 }))).toBeNull();
    const invalid = log();
    invalid.created_at = 'bad';
    invalid.sent_at = new Date(ANCHOR).toISOString();
    expect(latencyOf(invalid)).toBeNull();
  });

  it('falls back to timestamps when measured latency is invalid', () => {
    expect(latencyOf(log({ latencyMs: -1, elapsedMs: 700 }))).toEqual({
      latencyMs: 700,
      source: 'derived',
    });
  });

  it('computes interpolated percentiles', () => {
    expect(percentile([0, 10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([0, 100], 0.95)).toBeCloseTo(95, 8);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('trims symmetric tails before taking a mean', () => {
    const values = [0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10_000];
    expect(trimmedMean(values, 0.1)).toBe(10);
    expect(trimmedMean([], 0.1)).toBeNull();
  });
});

describe('analyzeNotificationLatency', () => {
  it('returns explicit no-data metrics and stable empty histogram bins', () => {
    const result = analyzeNotificationLatency([]);
    expect(result.count).toBe(0);
    expect(result.p95Ms).toBeNull();
    expect(result.apdex).toBeNull();
    expect(result.histogram).toHaveLength(6);
    expect(result.slowest).toEqual([]);
  });

  it('computes p50, p95, p99 and a trimmed mean', () => {
    const logs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 10_000]
      .map((latencyMs) => log({ latencyMs }));
    const result = analyzeNotificationLatency(logs);
    expect(result.p50Ms).toBe(550);
    expect(result.p95Ms).toBeGreaterThan(5_000);
    expect(result.p99Ms).toBeGreaterThan(result.p95Ms!);
    expect(result.trimmedMeanMs).toBe(550);
  });

  it('implements Apdex with T and four-times-T bands', () => {
    const result = analyzeNotificationLatency([
      log({ latencyMs: 500 }),
      log({ latencyMs: 1_000 }),
      log({ latencyMs: 2_000 }),
      log({ latencyMs: 4_000 }),
      log({ latencyMs: 4_001 }),
    ], { thresholdMs: 1_000 });
    expect(result.satisfied).toBe(2);
    expect(result.tolerating).toBe(2);
    expect(result.frustrated).toBe(1);
    expect(result.apdex).toBe(0.6);
    expect(result.tailShare).toBe(0.2);
  });

  it('builds severity cohorts ranked by tail latency', () => {
    const result = analyzeNotificationLatency([
      log({ latencyMs: 100, severity: 'info' }),
      log({ latencyMs: 200, severity: 'info' }),
      log({ latencyMs: 8_000, severity: 'critical' }),
      log({ latencyMs: 9_000, severity: 'critical' }),
    ]);
    expect(result.severityCohorts[0]!.key).toBe('critical');
    expect(result.severityCohorts[0]!.p95Ms).toBeGreaterThan(
      result.severityCohorts[1]!.p95Ms,
    );
  });

  it('builds separate status cohorts when attempts carry latency', () => {
    const result = analyzeNotificationLatency([
      log({ latencyMs: 100, status: 'sent' }),
      log({ latencyMs: 5_000, status: 'failed' }),
      log({ latencyMs: 2_000, status: 'deferred_dnd' }),
    ]);
    expect(result.statusCohorts.map((cohort) => cohort.key).sort()).toEqual([
      'deferred_dnd',
      'failed',
      'sent',
    ]);
  });

  it('accounts for every record exactly once in histogram bins', () => {
    const logs = [100, 250, 251, 500, 501, 1_000, 1_001, 2_000, 4_000, 4_001]
      .map((latencyMs) => log({ latencyMs }));
    const result = analyzeNotificationLatency(logs);
    expect(result.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(logs.length);
    expect(result.histogram.reduce((sum, bin) => sum + bin.share, 0)).toBeCloseTo(1, 6);
  });

  it('ranks and limits the slowest delivery records', () => {
    const result = analyzeNotificationLatency([
      log({ latencyMs: 100, title: 'Fast' }),
      log({ latencyMs: 9_000, title: 'Slowest' }),
      log({ latencyMs: 5_000, title: 'Slow' }),
    ], { slowestLimit: 2 });
    expect(result.slowest.map((record) => record.title)).toEqual(['Slowest', 'Slow']);
  });

  it('reports how much data came from backend measurements', () => {
    const result = analyzeNotificationLatency([
      log({ latencyMs: 100 }),
      log({ elapsedMs: 200 }),
      log({ elapsedMs: 300 }),
    ]);
    expect(result.measuredShare).toBeCloseTo(1 / 3, 3);
  });

  it('normalizes blank severities and ignores rows with no latency', () => {
    const result = analyzeNotificationLatency([
      log({ latencyMs: 50, severity: '  ' }),
      log({ status: 'pending' }),
    ]);
    expect(result.count).toBe(1);
    expect(result.severityCohorts[0]!.key).toBe('unknown');
  });

  it('uses the documented threshold when an invalid threshold is supplied', () => {
    expect(analyzeNotificationLatency([log({ latencyMs: 50 })], { thresholdMs: 0 }).thresholdMs)
      .toBe(1_000);
  });
});
