/**
 * drivetrain-health/constants — contract + behaviour coverage.
 *
 * `constants.ts` is the single source of truth the whole Drivetrain-Health
 * feature reads its status → {score, colour, glow} mapping from. Nothing here
 * is a smoke check: every runtime export is pinned to the contract its
 * consumers depend on, and the type-only exports are exercised (compile-time
 * via typed construction — a shape regression fails `tsc --noEmit` — and at
 * runtime via real assertions on the constructed values):
 *
 *   HEALTH_SCORE  — LinearGauge `max={100}` + AnimatedNumber `suffix="%"` both
 *                   assume a 0..100 value ranked by severity (good>warn>crit).
 *   HEALTH_COLOR  — LinearGauge `color` + helpers.tempSeverityColor return these;
 *                   must be valid, distinct, severity-appropriate hex.
 *   HEALTH_GLOW   — fed straight into <GlassPanel glow=…>; every value must be a
 *                   real, renderable GlassPanel accent (never the empty 'none').
 *   TempSensor / ChartDataPoint / MotorChartDataPoint / Recommendation — the
 *                   shapes the page's useMemo-built series must honour, incl.
 *                   their nullable-telemetry branches.
 *
 * The three records and HealthStatus must never drift apart, so a dedicated
 * case asserts they share one key set.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { isValidElement } from 'react';

import { GlassPanel, GLOW_CLASSES } from '@/components/ui';

import {
  HEALTH_SCORE,
  HEALTH_COLOR,
  HEALTH_GLOW,
  type HealthStatus,
  type HealthGlow,
  type TempSensor,
  type ChartDataPoint,
  type MotorChartDataPoint,
  type Recommendation,
} from './constants';

const ALL_STATUSES: HealthStatus[] = ['good', 'warning', 'critical'];
const sortedKeys = (o: object) => Object.keys(o).sort();

describe('HEALTH_SCORE', () => {
  it('exposes a finite score for every health status', () => {
    expect(sortedKeys(HEALTH_SCORE)).toEqual([...ALL_STATUSES].sort());
    for (const s of ALL_STATUSES) {
      expect(Number.isFinite(HEALTH_SCORE[s])).toBe(true);
    }
  });

  it('keeps every score within the 0–100 gauge range', () => {
    // LinearGauge max={100} + AnimatedNumber suffix="%" would render a
    // nonsensical arc / percentage for an out-of-range value.
    for (const s of ALL_STATUSES) {
      expect(HEALTH_SCORE[s]).toBeGreaterThanOrEqual(0);
      expect(HEALTH_SCORE[s]).toBeLessThanOrEqual(100);
    }
  });

  it('ranks scores by descending severity (good > warning > critical)', () => {
    expect(HEALTH_SCORE.good).toBeGreaterThan(HEALTH_SCORE.warning);
    expect(HEALTH_SCORE.warning).toBeGreaterThan(HEALTH_SCORE.critical);
    // Lock the exact published contract the UI is calibrated against.
    expect(HEALTH_SCORE).toEqual({ good: 95, warning: 60, critical: 25 });
  });
});

describe('HEALTH_COLOR', () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];

  it('is a valid 6-digit hex colour for every status', () => {
    expect(sortedKeys(HEALTH_COLOR)).toEqual([...ALL_STATUSES].sort());
    for (const s of ALL_STATUSES) {
      expect(HEALTH_COLOR[s]).toMatch(HEX);
    }
  });

  it('assigns a distinct, severity-appropriate colour per status', () => {
    const values = ALL_STATUSES.map((s) => HEALTH_COLOR[s]);
    // Distinct so the gauge / severity swatches stay visually separable.
    expect(new Set(values).size).toBe(values.length);

    // "good" must read green (green channel dominant), "critical" must read
    // red (red channel dominant) — colour carries the severity semantics.
    const [gr, gg, gb] = rgb(HEALTH_COLOR.good);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);

    const [cr, cg, cb] = rgb(HEALTH_COLOR.critical);
    expect(cr).toBeGreaterThan(cg);
    expect(cr).toBeGreaterThan(cb);

    expect(HEALTH_COLOR).toEqual({
      good: '#10b981',
      warning: '#f59e0b',
      critical: '#ef4444',
    });
  });
});

describe('HEALTH_GLOW', () => {
  it('maps every status to a real GlassPanel accent, never the empty "none"', () => {
    const accents = new Set<HealthGlow>(['cyan', 'green', 'purple']);
    expect(sortedKeys(HEALTH_GLOW)).toEqual([...ALL_STATUSES].sort());
    for (const s of ALL_STATUSES) {
      expect(accents.has(HEALTH_GLOW[s])).toBe(true);
      expect(HEALTH_GLOW[s]).not.toBe('none');
    }
    expect(HEALTH_GLOW.good).toBe('green');
  });

  it('resolves to a glow class GlassPanel actually renders for every status', () => {
    // Prove each value is a live GlassPanel accent, not just a string that
    // happens to type-check: rendered (with hover, which gates the glow) each
    // status must apply its matching accent token.
    //
    // The expected class is derived from GlassPanel's own exported GLOW_CLASSES
    // map rather than hardcoded, so re-skinning the accent (e.g. green →
    // emerald) cannot silently invalidate this contract check.
    for (const status of ALL_STATUSES) {
      const { container, unmount } = render(
        <GlassPanel hover glow={HEALTH_GLOW[status]}>
          <span>{`panel-${status}`}</span>
        </GlassPanel>,
      );
      const panel = container.querySelector('[data-print-card]');
      const expected = GLOW_CLASSES[HEALTH_GLOW[status]];
      expect(panel).not.toBeNull();
      expect(expected, `${status} must map to a non-empty accent`).not.toBe('');
      expect(panel?.className).toContain(expected);
      unmount();
    }
  });
});

describe('status key consistency', () => {
  it('keeps SCORE, COLOR and GLOW on one identical status key set', () => {
    // Guards against a status being added to one record but forgotten in the
    // others, which would surface as an `undefined` score/colour/glow at index.
    expect(sortedKeys(HEALTH_SCORE)).toEqual(sortedKeys(HEALTH_COLOR));
    expect(sortedKeys(HEALTH_COLOR)).toEqual(sortedKeys(HEALTH_GLOW));
    expect(sortedKeys(HEALTH_GLOW)).toEqual([...ALL_STATUSES].sort());
  });
});

describe('type contracts', () => {
  it('models a TempSensor including the null-reading branch', () => {
    // `value: null` is the "no telemetry yet" state the gauges must render as
    // '—' rather than a numeric temperature.
    const sensor: TempSensor = {
      key: 'frontMotor',
      labelKey: 'drivetrain.frontMotor',
      defaultLabel: 'Front Motor',
      value: null,
      maxTemp: 150,
      color: '#06b6d4',
      icon: <span aria-hidden="true" data-testid="sensor-icon" />,
    };
    expect(sensor.value).toBeNull();
    expect(sensor.maxTemp).toBe(150);
    expect(sensor.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(isValidElement(sensor.icon)).toBe(true);
  });

  it('models chart points that tolerate missing temperature/motor telemetry', () => {
    const power: ChartDataPoint = {
      date: '2024-01-01',
      powerMax: 120,
      powerMin: -30,
      outsideTemp: null,
      distance: 42,
    };
    const motor: MotorChartDataPoint = {
      time: '12:00',
      stator: null,
      statorRel: null,
      statorRer: null,
      torque: null,
      speed: null,
      axle: null,
    };
    expect(power.outsideTemp).toBeNull();
    expect(power.powerMin).toBeLessThan(0); // regen is a legitimate negative
    expect(motor.time).toBe('12:00');
    // Every optional motor channel may legitimately be absent.
    const channels = [motor.stator, motor.statorRel, motor.statorRer, motor.torque, motor.speed, motor.axle];
    expect(channels.every((v) => v === null)).toBe(true);
  });

  it('models a Recommendation for each priority level', () => {
    const priorities: Recommendation['priority'][] = ['high', 'medium', 'low'];
    const recs: Recommendation[] = priorities.map((priority, i) => ({
      key: `rec-${i}`,
      text: `Recommendation ${i}`,
      priority,
    }));
    expect(recs).toHaveLength(3);
    expect(recs.map((r) => r.priority)).toEqual(['high', 'medium', 'low']);
    expect(recs.every((r) => r.key.length > 0 && r.text.length > 0)).toBe(true);
  });
});
