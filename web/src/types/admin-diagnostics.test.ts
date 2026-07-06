/**
 * admin-diagnostics — contract tests for the admin / diagnostic wire types.
 *
 * The module used to be *type-only* (every export erased at runtime). It now
 * also exposes the runtime backbone for its five literal unions: an `as const`
 * tuple per union (single source of truth), a `isX` narrowing guard per union,
 * and the `isDLQReplaySuccess` predicate. Following the repo convention for
 * type modules (see features/charging/components/charging-curve/types.test.ts)
 * this suite locks the contract on two levels:
 *
 *   • Runtime (`expect`)      — the guards accept every documented member,
 *     reject foreign values (including members of *sibling* unions and every
 *     non-string primitive), and the success predicate matches the
 *     DLQInspectorPage branch. Fixtures are typed against the real DTO
 *     interfaces, so a wire-shape drift breaks this file at compile time.
 *   • Compile-time (`expectTypeOf`) — each union equals its documented literal
 *     set AND is derived from its const tuple, and every response DTO carries
 *     the derived union. These are runtime no-ops enforced by `tsc --noEmit`.
 *
 * No network, no DOM — pure structural + guard assertions, so no MSW/Query
 * harness is needed.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import {
  DLQ_REPLAY_RESULTS,
  FEATURE_FLAG_OPERATIONS,
  INGEST_XRAY_WINDOWS,
  INGEST_XRAY_BUCKETS,
  DRIVE_DIAGNOSTIC_WINDOWS,
  isDLQReplayResult,
  isDLQReplaySuccess,
  isFeatureFlagOperation,
  isIngestXRayWindow,
  isIngestXRayBucket,
  isDriveDiagnosticWindow,
} from './admin-diagnostics';
import type {
  DLQReplayResult,
  DLQReplayResponse,
  DLQEntrySummary,
  DLQEntryFull,
  FeatureFlagOperation,
  IngestXRayWindow,
  IngestXRayBucket,
  IngestXRayResponse,
  DriveDiagnosticWindow,
  DriveDiagnosticResponse,
} from './admin-diagnostics';

// Every non-string value must be rejected by a string-literal guard. Includes
// an array whose *element* is a valid member and an object that "looks like"
// a payload — the guard must reject the container, never peek inside.
const NON_STRINGS: unknown[] = [
  null,
  undefined,
  0,
  1,
  NaN,
  Infinity,
  true,
  false,
  {},
  [],
  ['ok'],
  { result: 'ok' },
];

// Each guard is paired with its tuple and a set of foreign values. The
// foreigners deliberately include members of *sibling* unions (e.g. '30s' is a
// valid ingest bucket + drive window but NOT an ingest window) so the tests
// prove a guard never leaks its neighbour's vocabulary.
const GUARD_CASES: ReadonlyArray<{
  name: string;
  guard: (value: unknown) => boolean;
  members: readonly string[];
  foreigners: readonly string[];
}> = [
  {
    name: 'isDLQReplayResult',
    guard: isDLQReplayResult,
    members: DLQ_REPLAY_RESULTS,
    foreigners: ['throttled', 'success', 'OK', ' ok ', ''],
  },
  {
    name: 'isFeatureFlagOperation',
    guard: isFeatureFlagOperation,
    members: FEATURE_FLAG_OPERATIONS,
    foreigners: ['archive', 'update', 'SET', 'Delete', ''],
  },
  {
    name: 'isIngestXRayWindow',
    guard: isIngestXRayWindow,
    members: INGEST_XRAY_WINDOWS,
    foreigners: ['99z', '7d', '30s', '2h', '60s'],
  },
  {
    name: 'isIngestXRayBucket',
    guard: isIngestXRayBucket,
    members: INGEST_XRAY_BUCKETS,
    foreigners: ['7d', '6h', '24h', '10s', '60s'],
  },
  {
    name: 'isDriveDiagnosticWindow',
    guard: isDriveDiagnosticWindow,
    members: DRIVE_DIAGNOSTIC_WINDOWS,
    foreigners: ['1h', '6h', '24h', '10s', '90s'],
  },
];

describe('literal tuples pin the exact server-accepted sets', () => {
  it('DLQ replay results mirror the Go constants block, in order', () => {
    expect(DLQ_REPLAY_RESULTS).toEqual([
      'ok',
      'publish_failed',
      'rate_limited',
      'disabled',
      'not_found',
      'unparseable',
    ]);
  });

  it('feature flag operations are exactly set + delete', () => {
    expect(FEATURE_FLAG_OPERATIONS).toEqual(['set', 'delete']);
  });

  it('ingest x-ray windows and buckets match the 400-guarded whitelist', () => {
    expect(INGEST_XRAY_WINDOWS).toEqual(['5m', '15m', '1h', '6h', '24h']);
    expect(INGEST_XRAY_BUCKETS).toEqual(['30s', '1m', '5m', '15m', '1h']);
  });

  it('drive diagnostic windows match the 400-guarded whitelist', () => {
    expect(DRIVE_DIAGNOSTIC_WINDOWS).toEqual(['30s', '60s', '5m', '15m']);
  });

  it('tuple members are unique (no accidental duplicate breaks the union)', () => {
    for (const { name, members } of GUARD_CASES) {
      expect(new Set(members).size, `${name} tuple has a duplicate`).toBe(members.length);
    }
  });
});

for (const { name, guard, members, foreigners } of GUARD_CASES) {
  describe(name, () => {
    it('accepts every documented member', () => {
      expect(members.length).toBeGreaterThan(0);
      for (const member of members) {
        expect(guard(member), `${name} rejected valid member ${member}`).toBe(true);
      }
    });

    it('rejects foreign strings, including sibling-union values', () => {
      for (const foreign of foreigners) {
        expect(guard(foreign), `${name} accepted foreign value ${foreign}`).toBe(false);
      }
    });

    it('rejects every non-string input without peeking inside containers', () => {
      for (const value of NON_STRINGS) {
        expect(guard(value)).toBe(false);
      }
    });
  });
}

describe('isDLQReplaySuccess', () => {
  it('is true only for the single "ok" success code', () => {
    expect(isDLQReplaySuccess('ok')).toBe(true);
  });

  it('is false for every non-ok result code', () => {
    const failures = DLQ_REPLAY_RESULTS.filter((r) => r !== 'ok');
    expect(failures).toHaveLength(5);
    for (const result of failures) {
      expect(isDLQReplaySuccess(result), `${result} must not count as success`).toBe(false);
    }
  });

  it('agrees with the DLQInspectorPage branch semantics', () => {
    // The page closes the drawer iff result === 'ok' and shows the disabled
    // banner for 'disabled'; the helper must classify both the same way.
    expect(isDLQReplaySuccess('disabled')).toBe(false);
    expect(isDLQReplaySuccess('publish_failed')).toBe(false);
    expect(isDLQReplaySuccess('ok')).toBe(true);
  });
});

describe('guards narrow untrusted input for safe consumption', () => {
  it('narrows a raw <select> value to IngestXRayWindow inside the branch', () => {
    const raw: unknown = '15m';
    if (!isIngestXRayWindow(raw)) throw new Error('guard should have accepted 15m');
    // Compile-time: inside the branch `raw` is the narrowed union.
    expectTypeOf(raw).toEqualTypeOf<IngestXRayWindow>();
    // Runtime: the narrowed value is a real member of the accepted set.
    expect(INGEST_XRAY_WINDOWS).toContain(raw);
  });

  it('narrows a raw <select> value to DriveDiagnosticWindow inside the branch', () => {
    const raw: unknown = '60s';
    if (!isDriveDiagnosticWindow(raw)) throw new Error('guard should have accepted 60s');
    expectTypeOf(raw).toEqualTypeOf<DriveDiagnosticWindow>();
    expect(DRIVE_DIAGNOSTIC_WINDOWS).toContain(raw);
  });

  it('lets callers fall back when a stale/typo value arrives', () => {
    // '99z' is exactly the bad value XRayHeader.test.tsx injects.
    const raw: unknown = '99z';
    expect(isIngestXRayWindow(raw)).toBe(false);
    const safe: IngestXRayWindow = isIngestXRayWindow(raw) ? raw : '1h';
    expect(safe).toBe('1h');
  });
});

describe('type identities and DTO contract (enforced by tsc --noEmit)', () => {
  it('every union equals its documented literal set', () => {
    expectTypeOf<DLQReplayResult>().toEqualTypeOf<
      'ok' | 'publish_failed' | 'rate_limited' | 'disabled' | 'not_found' | 'unparseable'
    >();
    expectTypeOf<FeatureFlagOperation>().toEqualTypeOf<'set' | 'delete'>();
    expectTypeOf<IngestXRayWindow>().toEqualTypeOf<'5m' | '15m' | '1h' | '6h' | '24h'>();
    expectTypeOf<IngestXRayBucket>().toEqualTypeOf<'30s' | '1m' | '5m' | '15m' | '1h'>();
    expectTypeOf<DriveDiagnosticWindow>().toEqualTypeOf<'30s' | '60s' | '5m' | '15m'>();
    // Runtime companion: the guard round-trips the first tuple member.
    expect(isDLQReplayResult(DLQ_REPLAY_RESULTS[0])).toBe(true);
  });

  it('each union is derived from its const tuple (single source of truth)', () => {
    expectTypeOf<(typeof DLQ_REPLAY_RESULTS)[number]>().toEqualTypeOf<DLQReplayResult>();
    expectTypeOf<(typeof FEATURE_FLAG_OPERATIONS)[number]>().toEqualTypeOf<FeatureFlagOperation>();
    expectTypeOf<(typeof INGEST_XRAY_WINDOWS)[number]>().toEqualTypeOf<IngestXRayWindow>();
    expectTypeOf<(typeof INGEST_XRAY_BUCKETS)[number]>().toEqualTypeOf<IngestXRayBucket>();
    expectTypeOf<(typeof DRIVE_DIAGNOSTIC_WINDOWS)[number]>().toEqualTypeOf<DriveDiagnosticWindow>();
    expect(isDriveDiagnosticWindow(DRIVE_DIAGNOSTIC_WINDOWS[0])).toBe(true);
  });

  it('DLQEntryFull is a structural superset of DLQEntrySummary', () => {
    const full: DLQEntryFull = {
      id: 1,
      arrived_at: '2026-01-01T00:00:00Z',
      dlq_topic: 'dlq/telemetry',
      parsed_reason: 'codec_error',
      parsed_vehicle_id: null,
      parsed_vin: null,
      parsed_source_topic: null,
      parsed_redeliveries: null,
      parsed_timestamp: null,
      parse_error: null,
      replayable: true,
      raw_payload_size: 128,
      inner_payload_size: 64,
      raw_payload_b64: 'AAEC=',
      inner_payload_b64: 'BAUG=',
    };
    // Compiles iff DLQEntryFull ⊇ DLQEntrySummary — a field rename in either
    // interface breaks this assignment.
    const summary: DLQEntrySummary = full;
    expect(summary.id).toBe(1);
    expect(summary.replayable).toBe(true);
    expect(full.raw_payload_b64).toBe('AAEC=');
    expectTypeOf<DLQEntryFull>().toHaveProperty('inner_payload_b64');
  });

  it('DLQReplayResponse.result is guard- and predicate-usable', () => {
    const resp: DLQReplayResponse = {
      ok: true,
      replayed_id: 7,
      dst_topic: 'telemetry/VIN/v/Field',
      result: 'ok',
    };
    expect(isDLQReplayResult(resp.result)).toBe(true);
    expect(isDLQReplaySuccess(resp.result)).toBe(true);
    expectTypeOf<DLQReplayResponse['result']>().toEqualTypeOf<DLQReplayResult>();
  });

  it('IngestXRayResponse carries guard-validatable window + bucket', () => {
    const resp: IngestXRayResponse = {
      vehicle_id: 1,
      window: '1h',
      bucket: '1m',
      generated_at: '2026-01-01T00:00:00Z',
      total_samples: 0,
      unique_fields: 0,
      fields: [],
      buckets: [],
    };
    expect(isIngestXRayWindow(resp.window)).toBe(true);
    expect(isIngestXRayBucket(resp.bucket)).toBe(true);
    expectTypeOf<IngestXRayResponse['window']>().toEqualTypeOf<IngestXRayWindow>();
    expectTypeOf<IngestXRayResponse['bucket']>().toEqualTypeOf<IngestXRayBucket>();
  });

  it('DriveDiagnosticResponse carries a guard-validatable window', () => {
    const resp: DriveDiagnosticResponse = {
      drive_id: 1,
      vehicle_id: 2,
      start_ts: '2026-01-01T00:00:00Z',
      end_ts: null,
      ended_status: null,
      window: '60s',
      fsm_transitions: [],
      signal_window: [],
    };
    expect(isDriveDiagnosticWindow(resp.window)).toBe(true);
    expectTypeOf<DriveDiagnosticResponse['window']>().toEqualTypeOf<DriveDiagnosticWindow>();
  });
});
