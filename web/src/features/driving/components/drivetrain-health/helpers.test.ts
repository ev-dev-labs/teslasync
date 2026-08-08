/**
 * drivetrain-health/helpers — behaviour + hardening coverage.
 *
 * `helpers.ts` holds the pure status → presentation mappings the whole
 * Drivetrain-Health feature renders from. None of this is a smoke check;
 * every export is pinned to the exact contract its consumers depend on and
 * every branch (including the pathological telemetry ones) is exercised:
 *
 *   healthBadgeVariant  — feeds <Badge variant={…}> in HealthOverview.
 *   getAlertVariant     — feeds <AlertBanner variant={…}> (only shown when the
 *                         drivetrain is NOT healthy, but the pure fn is total).
 *   tempSeverityColor   — <LinearGauge color> / <MetricBar color>; must return
 *                         a real HEALTH_COLOR hex, or the neutral swatch when a
 *                         reading can't be ranked.
 *   tempNeonColor       — <MetricCard color>; the neon twin of the above,
 *                         kept in lockstep via the same private classifier.
 *   displayTemp         — the '—' vs formatted-value text for every KV / gauge
 *                         sublabel; must never hand a non-finite value to the
 *                         formatter.
 *
 * The two colour helpers share one severity classifier, so a dedicated block
 * proves they never disagree on a band across a wide input sweep — and that
 * non-finite / bad-ceiling inputs resolve to the neutral (never "critical" or
 * a misleading "healthy") state.
 */
import { describe, it, expect, vi } from 'vitest';

import { HEALTH_COLOR } from './constants';
import {
  healthBadgeVariant,
  getAlertVariant,
  tempSeverityColor,
  tempNeonColor,
  displayTemp,
} from './helpers';

const NEUTRAL = '#6b7280';

// Sensor ceilings actually configured on the Drivetrain-Health page.
const MOTOR_MAX = 150;
const INVERTER_MAX = 120;
const BATTERY_MAX = 60;

describe('healthBadgeVariant', () => {
  it('maps each health status to its Badge variant', () => {
    expect(healthBadgeVariant('good')).toBe('success');
    expect(healthBadgeVariant('warning')).toBe('warning');
    expect(healthBadgeVariant('critical')).toBe('danger');
  });

  it('assigns a distinct variant per status (no two collapse)', () => {
    const variants = [
      healthBadgeVariant('good'),
      healthBadgeVariant('warning'),
      healthBadgeVariant('critical'),
    ];
    expect(new Set(variants).size).toBe(3);
    // Only the true-healthy state reads "success".
    expect(variants.filter((v) => v === 'success')).toEqual(['success']);
  });
});

describe('getAlertVariant', () => {
  it('routes warning to the warning banner and everything else to danger', () => {
    expect(getAlertVariant('warning')).toBe('warning');
    expect(getAlertVariant('critical')).toBe('danger');
    // HealthOverview only mounts the banner when NOT good, but the pure fn
    // must still be total — a "good" input resolves to danger, never crashes.
    expect(getAlertVariant('good')).toBe('danger');
  });

  it('only ever returns one of the two AlertBanner variants', () => {
    for (const status of ['good', 'warning', 'critical'] as const) {
      expect(['warning', 'danger']).toContain(getAlertVariant(status));
    }
  });
});

describe('tempSeverityColor', () => {
  it('returns the neutral swatch for a missing (null) reading', () => {
    expect(tempSeverityColor(null, MOTOR_MAX)).toBe(NEUTRAL);
  });

  it('ranks a finite reading into good / warning / critical HEALTH_COLOR hex', () => {
    // Well inside range → good (green).
    expect(tempSeverityColor(60, MOTOR_MAX)).toBe(HEALTH_COLOR.good); // 0.40
    // >= 0.65 and < 0.85 → warning (amber).
    expect(tempSeverityColor(105, MOTOR_MAX)).toBe(HEALTH_COLOR.warning); // 0.70
    // >= 0.85 → critical (red).
    expect(tempSeverityColor(140, MOTOR_MAX)).toBe(HEALTH_COLOR.critical); // 0.933
  });

  it('is inclusive on both band boundaries (>= 0.85 and >= 0.65)', () => {
    // Exactly at the ceilings, per sensor, the boundary belongs to the hotter band.
    expect(tempSeverityColor(0.85 * MOTOR_MAX, MOTOR_MAX)).toBe(HEALTH_COLOR.critical);
    expect(tempSeverityColor(0.65 * MOTOR_MAX, MOTOR_MAX)).toBe(HEALTH_COLOR.warning);
    // A hair below each boundary drops to the cooler band.
    expect(tempSeverityColor(0.85 * BATTERY_MAX - 0.01, BATTERY_MAX)).toBe(HEALTH_COLOR.warning);
    expect(tempSeverityColor(0.65 * INVERTER_MAX - 0.01, INVERTER_MAX)).toBe(HEALTH_COLOR.good);
  });

  it('treats a cold (below-zero) reading as good, not unknown', () => {
    expect(tempSeverityColor(-10, BATTERY_MAX)).toBe(HEALTH_COLOR.good);
  });

  it('falls back to neutral for a non-finite reading instead of mislabelling it healthy', () => {
    // The bug this guards: NaN/±Infinity slip past `=== null` and used to
    // fall through to the green "good" hex, painting garbage telemetry as OK.
    expect(tempSeverityColor(Number.NaN, MOTOR_MAX)).toBe(NEUTRAL);
    expect(tempSeverityColor(Number.POSITIVE_INFINITY, MOTOR_MAX)).toBe(NEUTRAL);
    expect(tempSeverityColor(Number.NEGATIVE_INFINITY, MOTOR_MAX)).toBe(NEUTRAL);
  });

  it('falls back to neutral for a non-positive or non-finite ceiling', () => {
    // A zero/negative/NaN ceiling makes celsius/max meaningless.
    expect(tempSeverityColor(100, 0)).toBe(NEUTRAL);
    expect(tempSeverityColor(100, -50)).toBe(NEUTRAL);
    expect(tempSeverityColor(100, Number.NaN)).toBe(NEUTRAL);
    expect(tempSeverityColor(100, Number.POSITIVE_INFINITY)).toBe(NEUTRAL);
  });
});

describe('tempNeonColor', () => {
  it('keeps the historical green for a missing (null) reading', () => {
    expect(tempNeonColor(null, MOTOR_MAX)).toBe('green');
  });

  it('ranks a finite reading into green / amber / red', () => {
    expect(tempNeonColor(60, MOTOR_MAX)).toBe('green'); // 0.40
    expect(tempNeonColor(105, MOTOR_MAX)).toBe('amber'); // 0.70
    expect(tempNeonColor(140, MOTOR_MAX)).toBe('red'); // 0.933
  });

  it('is inclusive on both band boundaries', () => {
    expect(tempNeonColor(0.85 * BATTERY_MAX, BATTERY_MAX)).toBe('red');
    expect(tempNeonColor(0.65 * BATTERY_MAX, BATTERY_MAX)).toBe('amber');
    expect(tempNeonColor(0.85 * BATTERY_MAX - 0.01, BATTERY_MAX)).toBe('amber');
    expect(tempNeonColor(0.65 * BATTERY_MAX - 0.01, BATTERY_MAX)).toBe('green');
  });

  it('resolves non-finite readings and bad ceilings to green (never a false red)', () => {
    expect(tempNeonColor(Number.NaN, MOTOR_MAX)).toBe('green');
    expect(tempNeonColor(Number.POSITIVE_INFINITY, MOTOR_MAX)).toBe('green');
    expect(tempNeonColor(100, 0)).toBe('green');
    expect(tempNeonColor(100, Number.NaN)).toBe('green');
  });
});

describe('tempSeverityColor / tempNeonColor stay in lockstep', () => {
  // Same private classifier drives both, so for any ranked input the hex band
  // and the neon name must correspond. The only asymmetry is the neutral
  // state: severity paints it grey, neon (no neutral swatch) paints it green.
  const bandOfHex: Record<string, 'green' | 'amber' | 'red'> = {
    [HEALTH_COLOR.good]: 'green',
    [HEALTH_COLOR.warning]: 'amber',
    [HEALTH_COLOR.critical]: 'red',
    [NEUTRAL]: 'green',
  };

  it('agrees on the band for every sampled (reading, ceiling) pair', () => {
    const readings = [null, -20, 0, 39, 51, 78, 97.5, 127.5, 150, Number.NaN, Number.POSITIVE_INFINITY];
    const ceilings = [BATTERY_MAX, INVERTER_MAX, MOTOR_MAX, 0, Number.NaN];
    let assertions = 0;
    for (const max of ceilings) {
      for (const c of readings) {
        const hex = tempSeverityColor(c, max);
        const neon = tempNeonColor(c, max);
        expect(bandOfHex[hex]).toBe(neon);
        assertions += 1;
      }
    }
    // Guard the sweep itself actually ran (no silently-empty loop).
    expect(assertions).toBe(readings.length * ceilings.length);
  });
});

describe('displayTemp', () => {
  it('renders the em-dash for a missing (null) reading without calling the formatter', () => {
    const format = vi.fn((c: number) => `${c.toFixed(1)}°C`);
    expect(displayTemp(null, format)).toBe('—');
    expect(format).not.toHaveBeenCalled();
  });

  it('delegates a finite reading to the formatter and returns its output verbatim', () => {
    const format = vi.fn((c: number) => `${c.toFixed(1)}°C`);
    expect(displayTemp(21.4, format)).toBe('21.4°C');
    expect(format).toHaveBeenCalledWith(21.4);
    expect(format).toHaveBeenCalledTimes(1);
  });

  it('passes through an arbitrary formatter output (unit-agnostic)', () => {
    const fahrenheit = vi.fn((c: number) => `${Math.round((c * 9) / 5 + 32)}°F`);
    expect(displayTemp(100, fahrenheit)).toBe('212°F');
    expect(fahrenheit).toHaveBeenCalledWith(100);
  });

  it('renders the em-dash for non-finite readings instead of forwarding "NaN"', () => {
    const format = vi.fn((c: number) => `${c}°C`);
    expect(displayTemp(Number.NaN, format)).toBe('—');
    expect(displayTemp(Number.POSITIVE_INFINITY, format)).toBe('—');
    expect(displayTemp(Number.NEGATIVE_INFINITY, format)).toBe('—');
    expect(format).not.toHaveBeenCalled();
  });

  it('still formats legitimate edge readings like exactly 0°C', () => {
    const format = vi.fn((c: number) => `${c.toFixed(0)}°C`);
    expect(displayTemp(0, format)).toBe('0°C');
    expect(format).toHaveBeenCalledWith(0);
  });
});
