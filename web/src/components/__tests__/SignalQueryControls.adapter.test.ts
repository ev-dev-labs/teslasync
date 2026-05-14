import { describe, it, expect } from 'vitest';
import {
  adaptSignalHistoryPoint,
  adaptSignalHistoryResp,
  type SignalLogEntry,
} from '../SignalQueryControls';
import type { SignalHistoryPoint, SignalHistoryResp } from '@/api/types';

const point = (kind: string, value: SignalHistoryPoint['value']): SignalHistoryPoint => ({
  ts: '2026-05-13T01:04:51.177284Z',
  kind,
  value,
});

describe('adaptSignalHistoryPoint', () => {
  it('maps a Double row to value_num', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindDouble', 43343694.999), 'Odometer');
    expect(row).toEqual<SignalLogEntry>({
      created_at: '2026-05-13T01:04:51.177284Z',
      signal: 'Odometer',
      value_num: 43343694.999,
      value_str: null,
      value_bool: null,
    });
  });

  it('maps an Int64 row to value_num', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindInt64', 42), 'Soc');
    expect(row.value_num).toBe(42);
    expect(row.value_str).toBeNull();
    expect(row.value_bool).toBeNull();
  });

  it('maps a Bool row to value_bool', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindBool', true), 'Locked');
    expect(row.value_bool).toBe(true);
    expect(row.value_num).toBeNull();
    expect(row.value_str).toBeNull();
  });

  it('maps a Bool false row to value_bool=false (not null)', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindBool', false), 'Locked');
    expect(row.value_bool).toBe(false);
  });

  it('maps a String row to value_str', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindString', 'Driving'), 'Gear');
    expect(row.value_str).toBe('Driving');
    expect(row.value_num).toBeNull();
    expect(row.value_bool).toBeNull();
  });

  it('maps an Enum row (Tesla streams the enum label as a string) to value_str', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindEnum', 'CHARGING'), 'ChargeState');
    expect(row.value_str).toBe('CHARGING');
  });

  it('maps a Time row (string ISO instant) to value_str', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindTime', '2026-05-13T05:06:43Z'), 'TripStart');
    expect(row.value_str).toBe('2026-05-13T05:06:43Z');
  });

  it('passes the row.ts through verbatim into created_at (Invalid-Date regression)', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindFloat', 1.0), 'X');
    expect(new Date(row.created_at!).toString()).not.toBe('Invalid Date');
  });

  it('maps non-finite numbers to null (NaN/Infinity guard)', () => {
    const nan = adaptSignalHistoryPoint(point('ValueKindDouble', Number.NaN), 'X');
    expect(nan.value_num).toBeNull();
    const inf = adaptSignalHistoryPoint(point('ValueKindDouble', Number.POSITIVE_INFINITY), 'X');
    expect(inf.value_num).toBeNull();
  });

  it('maps a null value to all-nulls (no spurious zero/empty)', () => {
    const row = adaptSignalHistoryPoint(point('ValueKindDouble', null), 'X');
    expect(row.value_num).toBeNull();
    expect(row.value_bool).toBeNull();
    expect(row.value_str).toBeNull();
  });
});

describe('adaptSignalHistoryResp', () => {
  it('returns [] for null/undefined response', () => {
    expect(adaptSignalHistoryResp(null)).toEqual([]);
    expect(adaptSignalHistoryResp(undefined)).toEqual([]);
  });

  it('returns [] when data is missing', () => {
    expect(adaptSignalHistoryResp({} as SignalHistoryResp)).toEqual([]);
  });

  it('uses resp.signal for every row (BE-typed shape returns signal at envelope, not row)', () => {
    const resp: SignalHistoryResp = {
      vehicle_id: 1,
      signal: 'Odometer',
      expected_kind: 'ValueKindFloat',
      from: 'a',
      to: 'b',
      count: 2,
      data: [point('ValueKindDouble', 1), point('ValueKindDouble', 2)],
    };
    const rows = adaptSignalHistoryResp(resp);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.signal === 'Odometer')).toBe(true);
    expect(rows.map((r) => r.value_num)).toEqual([1, 2]);
  });

  it('full BE response — Phase-42 typed shape — produces table-renderable rows', () => {
    // This is the shape returned by /api/v1/signals/{vid}/Odometer/history
    // (verified via prod port-forward on 2026-05-13).
    const resp: SignalHistoryResp = {
      vehicle_id: 1,
      signal: 'Odometer',
      expected_kind: 'ValueKindFloat',
      from: '2026-05-12T05:06:43.714715484Z',
      to: '2026-05-13T05:06:43.714715484Z',
      count: 2,
      data: [
        { ts: '2026-05-13T01:04:51.177284Z', kind: 'ValueKindDouble', value: 43343694.999 },
        { ts: '2026-05-13T01:05:40.191573Z', kind: 'ValueKindDouble', value: 43343861.59125 },
      ],
    };
    const rows = adaptSignalHistoryResp(resp);
    expect(rows).toHaveLength(2);
    expect(rows[0].created_at).toBe('2026-05-13T01:04:51.177284Z');
    expect(rows[0].value_num).toBe(43343694.999);
  });
});
