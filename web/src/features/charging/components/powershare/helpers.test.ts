import { describe, it, expect } from 'vitest';

import {
  statusVariant,
  statusNeon,
  statusDotClass,
  stopReasonVariant,
  humanizeEnum,
  buildSeries,
  seriesPeak,
} from './helpers';
import type { TrendPoint } from './constants';
import type { BadgeVariant } from '@/types/fsm';
import type { NeonColor } from '@/lib/tokens';
import type { SignalObservation } from '@/types/signals';

// ---------------------------------------------------------------------------
// powershare/helpers — pure derivation layer for the Powershare cockpit.
//
// These helpers translate the five raw Tesla Powershare signals into the
// display primitives the page + panels consume: a Badge variant, a KPI neon
// accent, a StatusPill dot class, a humanised enum label, and the trend
// series/peak that feed the charts and MetricBars. A wrong branch here is not
// cosmetic — it paints an *inactive* session green, a *None* stop-reason
// amber, or feeds NaN into a chart axis.
//
// The Tesla proto (api/proto/tesla/vehicle_data.proto) plus the datum decoder
// (internal/tesla/protomodel/datum_decoder_gen.go, which TrimPrefix-es the
// enum) define the REAL runtime value domain, exercised below alongside the
// full proto-prefixed forms so the substring matching is pinned both ways:
//   status     → Inactive | Handshaking | Enabled | EnabledReconnectingSoon
//                | Stopped | Unknown
//   stopReason → Unknown | None | SOCTooLow | Retry | Fault | User
//                | Reconnecting | Authentication
// ---------------------------------------------------------------------------

/** Every PowershareState value the backend can surface (prefix-trimmed). */
const REAL_STATUSES = [
  'Inactive',
  'Handshaking',
  'Enabled',
  'EnabledReconnectingSoon',
  'Stopped',
  'Unknown',
] as const;

function obs(
  value_numeric: number | null,
  ts: string,
  overrides: Partial<SignalObservation> = {},
): SignalObservation {
  return {
    vehicle_id: 1,
    ts,
    signal_name: 'PowershareInstantaneousPowerKW',
    value_numeric,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
    ...overrides,
  };
}

describe('statusVariant', () => {
  it('returns neutral for nullish / empty input', () => {
    expect(statusVariant(null)).toBe('neutral');
    expect(statusVariant('')).toBe('neutral');
  });

  it('maps Tesla active states (Enabled/EnabledReconnectingSoon) to success', () => {
    // `Enabled` is Tesla's canonical "actively sharing" state — it must read
    // as a green success, not the amber default it fell through to before.
    expect(statusVariant('Enabled')).toBe('success');
    expect(statusVariant('EnabledReconnectingSoon')).toBe('success');
    expect(statusVariant('PowershareStatusActive')).toBe('success');
  });

  it('classifies Inactive as neutral, NOT success (substring-order regression)', () => {
    // Regression guard: "inactive" *contains* "active". An active-first
    // includes() check painted an off session green. Both the bare and the
    // fully proto-prefixed forms must resolve to neutral.
    expect(statusVariant('Inactive')).toBe('neutral');
    expect(statusVariant('PowershareStateInactive')).toBe('neutral');
    expect(statusVariant('OFF')).toBe('neutral');
  });

  it('flags error / fail states as danger, ahead of any active-like match', () => {
    expect(statusVariant('PowershareStatusError')).toBe('danger');
    expect(statusVariant('Failure')).toBe('danger');
    // danger has precedence: a value carrying both "active" and "error"
    // resolves to danger because error/fail is evaluated first.
    expect(statusVariant('ActiveError')).toBe('danger');
  });

  it('falls back to warning for transitional / unknown states', () => {
    expect(statusVariant('Handshaking')).toBe('warning');
    expect(statusVariant('Stopped')).toBe('warning');
    expect(statusVariant('Unknown')).toBe('warning');
  });

  it('is case-insensitive', () => {
    expect(statusVariant('ENABLED')).toBe('success');
    expect(statusVariant('inactive')).toBe('neutral');
    expect(statusVariant('eRRoR')).toBe('danger');
  });
});

describe('statusNeon', () => {
  it('projects each variant onto its KPI accent colour', () => {
    expect(statusNeon('Enabled')).toBe('green'); // success
    expect(statusNeon('PowershareStatusError')).toBe('red'); // danger
    expect(statusNeon('Stopped')).toBe('amber'); // warning
    expect(statusNeon('Inactive')).toBe('blue'); // neutral
  });

  it('returns blue for nullish input (neutral default)', () => {
    expect(statusNeon(null)).toBe('blue');
    expect(statusNeon('')).toBe('blue');
  });

  it('stays consistent with statusVariant across the real status domain', () => {
    const NEON_BY_VARIANT: Record<BadgeVariant, NeonColor> = {
      success: 'green',
      danger: 'red',
      warning: 'amber',
      neutral: 'blue',
      info: 'blue',
    };
    for (const status of REAL_STATUSES) {
      expect(statusNeon(status)).toBe(NEON_BY_VARIANT[statusVariant(status)]);
    }
  });
});

describe('statusDotClass', () => {
  it('maps each variant onto its Tailwind dot class', () => {
    expect(statusDotClass('Enabled')).toBe('bg-emerald-400'); // success
    expect(statusDotClass('PowershareStatusError')).toBe('bg-rose-400'); // danger
    expect(statusDotClass('Stopped')).toBe('bg-amber-400'); // warning
    expect(statusDotClass('Inactive')).toBe('bg-slate-400'); // neutral
    expect(statusDotClass(null)).toBe('bg-slate-400');
  });

  it('always returns a bg-* utility class for every real status', () => {
    for (const status of REAL_STATUSES) {
      expect(statusDotClass(status)).toContain('bg-');
    }
  });

  it('stays consistent with statusVariant across the real status domain', () => {
    const DOT_BY_VARIANT: Record<BadgeVariant, string> = {
      success: 'bg-emerald-400',
      danger: 'bg-rose-400',
      warning: 'bg-amber-400',
      neutral: 'bg-slate-400',
      info: 'bg-slate-400',
    };
    for (const status of REAL_STATUSES) {
      expect(statusDotClass(status)).toBe(DOT_BY_VARIANT[statusVariant(status)]);
    }
  });
});

describe('stopReasonVariant', () => {
  it('returns neutral for nullish input', () => {
    expect(stopReasonVariant(null)).toBe('neutral');
    expect(stopReasonVariant('')).toBe('neutral');
  });

  it('treats None as neutral, with or without its proto prefix', () => {
    // The decoder trims to bare "None"; older fixtures/paths carry the prefix.
    // Both must be neutral — a "None" stop-reason is not a warning condition.
    expect(stopReasonVariant('None')).toBe('neutral');
    expect(stopReasonVariant('PowershareStopReasonStatusNone')).toBe('neutral');
    expect(stopReasonVariant('PowershareStopReasonNone')).toBe('neutral');
  });

  it('flags fault / error / low-SOC reasons as danger', () => {
    expect(stopReasonVariant('Fault')).toBe('danger');
    expect(stopReasonVariant('SOCTooLow')).toBe('danger'); // matches "low"
    expect(stopReasonVariant('SomethingError')).toBe('danger');
  });

  it('flags user-initiated stops as warning', () => {
    expect(stopReasonVariant('User')).toBe('warning');
    expect(stopReasonVariant('PowershareStopReasonUserRequest')).toBe('warning');
  });

  it('checks user before fault (precedence)', () => {
    // "user" is evaluated ahead of the danger group, so a hypothetical
    // combined reason resolves to warning rather than danger.
    expect(stopReasonVariant('UserFault')).toBe('warning');
  });

  it('falls back to warning for transient reasons (Retry/Reconnecting/Auth)', () => {
    expect(stopReasonVariant('Retry')).toBe('warning');
    expect(stopReasonVariant('Reconnecting')).toBe('warning');
    expect(stopReasonVariant('Authentication')).toBe('warning');
    expect(stopReasonVariant('Unknown')).toBe('warning');
  });

  it('is case-insensitive', () => {
    expect(stopReasonVariant('none')).toBe('neutral');
    expect(stopReasonVariant('FAULT')).toBe('danger');
    expect(stopReasonVariant('user')).toBe('warning');
  });
});

describe('humanizeEnum', () => {
  it('returns null for nullish / empty input so callers can render a placeholder', () => {
    expect(humanizeEnum(null)).toBeNull();
    expect(humanizeEnum('')).toBeNull();
    expect(humanizeEnum(null, 'PowershareStatus')).toBeNull();
  });

  it('strips the supplied signal prefix then splits camelCase', () => {
    expect(humanizeEnum('PowershareStatusActive', 'PowershareStatus')).toBe('Active');
    expect(humanizeEnum('PowershareStopReasonUserRequest', 'PowershareStopReason')).toBe(
      'User Request',
    );
  });

  it('falls back to the generic Powershare strip when no prefix is supplied', () => {
    expect(humanizeEnum('PowershareStopReasonUserRequest')).toBe('Stop Reason User Request');
  });

  it('falls back to the generic strip when the supplied prefix does not match', () => {
    expect(humanizeEnum('SomethingElse', 'NoMatch')).toBe('Something Else');
  });

  it('splits acronym boundaries (SOCTooLow → SOC Too Low)', () => {
    // Exercises both regex passes: lower→Upper and UPPER→UpperLower.
    expect(humanizeEnum('SOCTooLow')).toBe('SOC Too Low');
  });

  it('humanises the bare (prefix-trimmed) decoder output unchanged', () => {
    expect(humanizeEnum('Enabled', 'PowershareStatus')).toBe('Enabled');
    expect(humanizeEnum('None', 'PowershareType')).toBe('None');
  });

  it('returns the raw token when stripping the prefix leaves nothing', () => {
    // Slicing the whole string away would yield "", so the raw value is kept.
    expect(humanizeEnum('PowershareStatus', 'PowershareStatus')).toBe('PowershareStatus');
    expect(humanizeEnum('Powershare')).toBe('Powershare');
  });
});

describe('buildSeries', () => {
  it('returns an empty array for undefined or empty input', () => {
    expect(buildSeries(undefined)).toEqual([]);
    expect(buildSeries([])).toEqual([]);
  });

  it('reverses the newest-first API order into an oldest→newest trend', () => {
    const data: SignalObservation[] = [
      obs(30, '2024-05-01T10:02:00Z'),
      obs(20, '2024-05-01T10:01:00Z'),
      obs(10, '2024-05-01T10:00:00Z'),
    ];
    const series = buildSeries(data);
    expect(series.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(series.map((p) => p.ts)).toEqual([
      '2024-05-01T10:00:00Z',
      '2024-05-01T10:01:00Z',
      '2024-05-01T10:02:00Z',
    ]);
  });

  it('drops rows whose numeric value is null (text/bool/compound kinds)', () => {
    const data: SignalObservation[] = [
      obs(30, '2024-05-01T10:02:00Z'),
      obs(null, '2024-05-01T10:01:00Z'),
      obs(10, '2024-05-01T10:00:00Z'),
    ];
    expect(buildSeries(data).map((p) => p.value)).toEqual([10, 30]);
  });

  it('drops non-finite values so NaN/Infinity never reach the chart axis', () => {
    const data: SignalObservation[] = [
      obs(Number.POSITIVE_INFINITY, '2024-05-01T10:03:00Z'),
      obs(NaN, '2024-05-01T10:02:00Z'),
      obs(Number.NEGATIVE_INFINITY, '2024-05-01T10:01:00Z'),
      obs(42, '2024-05-01T10:00:00Z'),
    ];
    const series = buildSeries(data);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(42);
  });

  it('keeps a legitimate zero reading (0 is not treated as missing)', () => {
    const series = buildSeries([obs(0, '2024-05-01T10:00:00Z')]);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(0);
  });

  it('attaches a formatted, non-placeholder label for a valid timestamp', () => {
    const [point] = buildSeries([obs(5, '2024-05-01T10:00:00Z')]);
    expect(typeof point.label).toBe('string');
    expect(point.label.length).toBeGreaterThan(0);
    expect(point.label).not.toBe('—');
  });

  it('still includes a finite value whose timestamp is unparseable (label → —)', () => {
    const [point] = buildSeries([obs(7, 'not-a-timestamp')]);
    expect(point.value).toBe(7);
    expect(point.label).toBe('—');
  });

  it('is null-safe against holes in the observation array', () => {
    const data = [
      undefined as unknown as SignalObservation,
      obs(12, '2024-05-01T10:00:00Z'),
    ];
    const series = buildSeries(data);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(12);
  });
});

describe('seriesPeak', () => {
  const points: TrendPoint[] = [
    { ts: 'a', label: 'a', value: 10 },
    { ts: 'b', label: 'b', value: 30 },
    { ts: 'c', label: 'c', value: 20 },
  ];

  it('returns the largest value in the series', () => {
    expect(seriesPeak(points)).toBe(30);
  });

  it('returns 0 for an empty series', () => {
    expect(seriesPeak([])).toBe(0);
  });

  it('is null-safe for a missing series (floors at 0 instead of throwing)', () => {
    expect(seriesPeak(undefined as unknown as TrendPoint[])).toBe(0);
    expect(seriesPeak(null as unknown as TrendPoint[])).toBe(0);
  });

  it('floors at 0 when every value is negative', () => {
    expect(
      seriesPeak([
        { ts: 'a', label: 'a', value: -5 },
        { ts: 'b', label: 'b', value: -1 },
      ]),
    ).toBe(0);
  });

  it('returns the single value for a one-point series', () => {
    expect(seriesPeak([{ ts: 'a', label: 'a', value: 7.5 }])).toBe(7.5);
  });
});
