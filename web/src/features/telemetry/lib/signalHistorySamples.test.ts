import { describe, expect, it } from 'vitest';
import type { SignalHistoryPoint } from '@/api/types';
import { toNumericPoints as trendPoints } from './signalTrend';
import { toNumericPoints as entropyPoints } from './signalEntropy';
import { toNumericPoints as changePoints } from './signalChangePoints';
import { toNumericDeadbandSeries } from './signalDeadband';
import { toTimedValues } from './signalMutualInformation';
import { toNumericSeries } from './signalCorrelation';
import {
  toSignalHistoryMeasurements,
  type SignalHistorySample,
} from './signalHistorySamples';

const BASE = Date.UTC(2026, 0, 1);

function row(
  kind: string,
  value: SignalHistoryPoint['value'],
  offsetMs = 0,
): SignalHistoryPoint {
  const ts = new Date(BASE + offsetMs).toISOString();
  return {
    ts,
    kind,
    value,
    ingest_origin: 'fleet_telemetry_mqtt',
    source_emitted_at: ts,
    received_at: new Date(BASE + offsetMs + 1_000).toISOString(),
    normalization_version: 1,
  };
}

describe('canonical signal history measurements', () => {
  it.each([
    { kind: 'ValueKindInt32', negative: -123, positive: 456 },
    { kind: 'ValueKindInt64', negative: -123, positive: 456 },
    { kind: 'ValueKindFloat', negative: -123.5, positive: 456.25 },
    { kind: 'ValueKindDouble', negative: -123.5, positive: 456.25 },
  ])(
    'keeps finite nonzero and measured zero for $kind without changing raw units',
    ({ kind, negative, positive }) => {
      expect(toSignalHistoryMeasurements([
        row(kind, negative),
        row(kind, 0, 60_000),
        row(kind, positive, 120_000),
      ])).toEqual([
        { ms: BASE, value: negative },
        { ms: BASE + 60_000, value: 0 },
        { ms: BASE + 120_000, value: positive },
      ]);
    },
  );

  it('promotes actual booleans only for the existing boolean-capable model policy', () => {
    const rows = [row('ValueKindBool', false), row('ValueKindBool', true, 60_000)];
    expect(toSignalHistoryMeasurements(rows)).toEqual([]);
    expect(toSignalHistoryMeasurements(rows, true)).toEqual([
      { ms: BASE, value: 0 },
      { ms: BASE + 60_000, value: 1 },
    ]);
  });

  it.each([
    ['ValueKindString', '0'],
    ['ValueKindString', 0],
    ['ValueKindEnum', 0],
    ['ValueKindTime', 0],
    ['ValueKindTime', '2026-01-01T00:00:00.000Z'],
    ['ValueKindCompound', 0],
    ['ValueKindUnknown', 0],
    ['ValueKindInvalid', 0],
    ['FutureValueKind', 0],
    ['ValueKindFloat', '0'],
    ['ValueKindDouble', false],
    ['ValueKindInt32', null],
    ['ValueKindInt64', Number.NaN],
    ['ValueKindFloat', Number.POSITIVE_INFINITY],
    ['ValueKindDouble', Number.NEGATIVE_INFINITY],
    ['ValueKindBool', 0],
    ['ValueKindBool', 'false'],
    ['ValueKindBool', null],
  ] satisfies Array<[string, SignalHistoryPoint['value']]>)(
    'rejects wrong-kind or invalid measurement %s/%s without numeric coercion',
    (kind, value) => {
      expect(toSignalHistoryMeasurements([row(kind, value)], true)).toEqual([]);
    },
  );

  it.each(['', 'not-a-date', '2026-99-99T00:00:00Z'])(
    'rejects invalid observation time %s even if source provenance is valid',
    (ts) => {
      expect(toSignalHistoryMeasurements([{ ...row('ValueKindFloat', 0), ts }])).toEqual([]);
    },
  );

  it('sorts stably and keeps the last valid measurement at duplicate times', () => {
    const rows = [
      row('ValueKindDouble', 4, 60_000),
      row('ValueKindFloat', 9),
      row('ValueKindInt32', 0),
      row('ValueKindEnum', 7),
      row('ValueKindDouble', Number.NaN),
      row('ValueKindBool', false, 60_000),
      row('ValueKindBool', 1, 60_000),
    ];
    expect(toSignalHistoryMeasurements(rows)).toEqual([
      { ms: BASE, value: 0 },
      { ms: BASE + 60_000, value: 4 },
    ]);
    expect(toSignalHistoryMeasurements(rows, true)).toEqual([
      { ms: BASE, value: 0 },
      { ms: BASE + 60_000, value: 0 },
    ]);
  });

  it('does not mutate, sort, deduplicate or overwrite original provenance-bearing rows', () => {
    const rows = [
      row('ValueKindDouble', 2, 60_000),
      { ...row('ValueKindFloat', 0), ingest_origin: null, normalization_version: null },
      { ...row('ValueKindBool', false), ingest_origin: 'fleet_telemetry_http' },
    ] satisfies SignalHistoryPoint[];
    const preimage = rows.map((point) => ({ ...point }));
    toSignalHistoryMeasurements(rows, true);
    expect(rows).toEqual(preimage);
    expect(rows[0]?.ts).toBe(new Date(BASE + 60_000).toISOString());
    expect(rows).toHaveLength(3);
  });
});

const modelReaders = [
  { name: 'trend', read: trendPoints, booleans: false },
  { name: 'entropy', read: entropyPoints, booleans: false },
  { name: 'change points', read: changePoints, booleans: false },
  { name: 'deadband', read: toNumericDeadbandSeries, booleans: false },
  { name: 'mutual information', read: toTimedValues, booleans: true },
  { name: 'correlation', read: toNumericSeries, booleans: true },
];

describe.each(modelReaders)('$name canonical input policy', ({ read, booleans }) => {
  it('uses canonical rows, raw values, valid timestamps and last-valid-row deduplication', () => {
    const rows: SignalHistorySample[] = [
      row('ValueKindFloat', 2, 60_000),
      row('ValueKindDouble', 10),
      row('ValueKindInt64', 0),
      row('ValueKindEnum', 5),
      { ...row('ValueKindFloat', 8), ts: 'invalid' },
      row('ValueKindDouble', Number.NaN),
      row('ValueKindFloat', '20', 120_000),
      row('ValueKindString', '30', 120_000),
      row('ValueKindBool', 0, 120_000),
    ];
    expect(read(rows)).toEqual([
      { ms: BASE, value: 0 },
      { ms: BASE + 60_000, value: 2 },
    ]);
  });

  it('preserves false as a measurement only where the scientific model supports booleans', () => {
    const rows = [row('ValueKindBool', false), row('ValueKindBool', true, 60_000)];
    expect(read(rows)).toEqual(booleans ? [
      { ms: BASE, value: 0 },
      { ms: BASE + 60_000, value: 1 },
    ] : []);
  });
});
