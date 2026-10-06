import { describe, expect, it } from 'vitest';
import type { IngestXRayResponse, DLQListResponse, DLQEntrySummary } from '@/types/admin-diagnostics';
import type { RedisSignalsResponse } from '@/api/hooks/useRedisSignals';
import { ingestMetrics } from './ingestMetrics';
import { dlqMetrics } from './dlqMetrics';
import { redisMetrics } from './redisMetrics';
import { briefSourceStatus } from './briefSourceStatus';

const t = (_key: string, fallback: string) => fallback;
const xray: IngestXRayResponse = {
  vehicle_id: 1, window: '1h', bucket: '1m', generated_at: '2026-10-06T12:00:00Z',
  total_samples: 11, unique_fields: 2, fields: [],
  buckets: [{ bucket_start: '2026-10-06T11:58:00Z', count: 2 },
    { bucket_start: '2026-10-06T11:59:00Z', count: 9 }],
};
const entry: DLQEntrySummary = {
  id: 1, arrived_at: '2026-10-06T12:00:00Z', dlq_topic: 'dlq',
  parsed_reason: 'unknown_enum', parsed_vehicle_id: null, parsed_vin: null,
  parsed_source_topic: 'telemetry/source', parsed_redeliveries: 1,
  parsed_timestamp: null, parse_error: null, replayable: true,
  raw_payload_size: 2048, inner_payload_size: 100,
};
const dlq: DLQListResponse = { count: 2, replay_enabled: false,
  entries: [entry, { ...entry, id: 2, replayable: false, parsed_reason: 'kind_mismatch', raw_payload_size: 900 }] };
const redis: RedisSignalsResponse = {
  vehicle_id: 1, signal_count: 3,
  signals: { BatteryLevel: { value: 72, type: 'number' },
    Name: { value: 'source', type: 'string' }, Charging: { value: false, type: 'boolean' } },
  meta: { live_signal_store_mode: 'hybrid', redis_key: 'vehicle:1:signals',
    redis_field_count: 5, l1_signal_count: 4, vehicle_vin: '',
    l1_last_seen_at: '2026-10-06T11:58:00Z', l2_last_seen_at: '2026-10-06T11:59:00Z' },
};

describe('canonical ingest/DLQ/Redis metric source preservation', () => {
  it('reports actual query/source state, never inferred operational health', () => {
    const base = { hasData: false, loading: false, retained: false, failed: false };
    expect(briefSourceStatus(t, { ...base, enabled: false }).statusLabel).toBe('No vehicle selected');
    expect(briefSourceStatus(t, { ...base, loading: true }).statusLabel).toBe('Loading measurements');
    expect(briefSourceStatus(t, { ...base, failed: true }).statusLabel).toBe('Read failed');
    expect(briefSourceStatus(t, base).statusLabel).toBe('No measurements supplied');
    expect(briefSourceStatus(t, { ...base, hasData: true }).statusLabel).toBe('Source loaded');
    expect(briefSourceStatus(t, { ...base, hasData: true, retained: true, failed: true }))
      .toEqual({ statusLabel: 'Retained measurements', statusTone: 'warning' });
  });

  it('keeps aggregate, distinct, peak and fractional mean numeric, plus chosen window and bucket captions', () => {
    const model = ingestMetrics(xray, '6h', '30s', t);
    expect(model.metrics.map(metric => metric.rawValue)).toEqual([11, 2, 9, 5.5, '6 hours', '30 seconds']);
    expect(model.metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'number', 'text', 'text']);
    expect(model.metrics.map(metric => metric.context)).toEqual([
      'within selected window', 'unique signal names', 'busiest interval', 'mean per interval',
      'observation horizon', 'aggregation interval',
    ]);
    expect(model.period).toEqual({ kind: 'unknown', label: '6 hours' });
  });

  it('distinguishes missing ingest measurements from confirmed zero and malformed bucket counts', () => {
    expect(ingestMetrics(undefined, '1h', '1m', t).metrics.slice(0, 4).map(metric => metric.rawValue))
      .toEqual([undefined, undefined, undefined, undefined]);
    expect(ingestMetrics({ ...xray, total_samples: 0, unique_fields: 0, buckets: [] }, '1h', '1m', t)
      .metrics.slice(0, 4).map(metric => metric.rawValue)).toEqual([0, 0, 0, 0]);
    expect(ingestMetrics({ ...xray, buckets: [{ bucket_start: '', count: Number.NaN }] }, '1h', '1m', t)
      .metrics.slice(2, 4).map(metric => metric.rawValue)).toEqual([undefined, undefined]);
  });

  it('keeps all DLQ totals, independent reasons, raw bytes and actual replay mode', () => {
    const model = dlqMetrics(dlq, t);
    expect(model.metrics.map(metric => metric.rawValue)).toEqual([2, 1, 1, 2, 2948, 'Disabled']);
    expect(model.metrics[4].metricId).toBe('bytes');
    expect(model.metrics.map(metric => metric.context)).toEqual([
      'in dead-letter queue', 'parsed with source topic', 'no replay target',
      'unique failure causes', 'raw bytes queued', 'DLQ_REPLAY_ENABLED env',
    ]);
    expect(dlqMetrics({ ...dlq, replay_enabled: true }, t).metrics[5].rawValue).toBe('Enabled');
    expect(model.period.kind).toBe('snapshot');
    expect(dlqMetrics({ ...dlq, count: 0 }, t).metrics[2].rawValue).toBe(0);
  });

  it('does not invent disabled mode or empty queue from missing/failed DLQ reads', () => {
    expect(dlqMetrics(undefined, t).metrics.map(metric => metric.rawValue))
      .toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(dlqMetrics({ count: 0, entries: [], replay_enabled: false }, t).metrics.map(metric => metric.rawValue))
      .toEqual([0, 0, 0, 0, 0, 'Disabled']);
    expect(dlqMetrics({ ...dlq, entries: [{ ...entry, raw_payload_size: Number.NaN }] }, t).metrics[4].rawValue)
      .toBeUndefined();
    const missingMode = { ...dlq };
    Reflect.deleteProperty(missingMode, 'replay_enabled');
    expect(dlqMetrics(missingMode, t).metrics[5].rawValue).toBeUndefined();
  });

  it('keeps Redis counts unfiltered and source freshness separate for L1 and L2', () => {
    const model = redisMetrics(redis, t, value => value);
    expect(model.metrics.map(metric => metric.rawValue)).toEqual([3, 1, 1, 1, 4, 5]);
    expect(model.metrics.every(metric => metric.metricId === 'count')).toBe(true);
    expect(model.metrics[4].context).toBe('In-process store · L1 last seen: 2026-10-06T11:58:00Z');
    expect(model.metrics[5].context).toBe('Redis HSET · L2 last seen: 2026-10-06T11:59:00Z');
    expect(model.period).toMatchObject({ kind: 'snapshot', observedAt: null });
    expect(redisMetrics({ ...redis, meta: undefined }, t, value => value).metrics.slice(4).map(metric => metric.rawValue))
      .toEqual([undefined, undefined]);
  });

  it('distinguishes missing cache reads, missing signal map, and confirmed empty cache', () => {
    expect(redisMetrics(undefined, t, value => value).metrics.map(metric => metric.rawValue))
      .toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(redisMetrics({ vehicle_id: 1, signal_count: 0, signals: {} }, t, value => value).metrics.map(metric => metric.rawValue))
      .toEqual([0, 0, 0, 0, undefined, undefined]);
    const missingMap = { ...redis };
    Reflect.deleteProperty(missingMap, 'signals');
    expect(redisMetrics(missingMap, t, value => value).metrics.slice(1, 4).map(metric => metric.rawValue))
      .toEqual([undefined, undefined, undefined]);
  });
});
