import { describe, expect, it } from 'vitest';
import type { Alert } from '@/api/types';
import {
  getAlertDrillthrough,
  getAlertDrillthroughHref,
  SIGNAL_EXPLORER_FALLBACK,
  SIGNAL_TO_PAGE,
} from './alertDrillthrough';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    vehicle_id: 12,
    type: 'low_battery',
    severity: 'critical',
    title: 'Battery low',
    message: 'Battery is at 5%',
    is_read: false,
    created_at: '2026-04-30T13:00:00.000Z',
    rule_id: 99,
    rule_signal: 'BatteryLevel',
    rule_severity: 'critical',
    ...overrides,
  };
}

describe('getAlertDrillthrough', () => {
  it('routes BatteryLevel alerts to /battery with vehicle_id, t, signal', () => {
    const target = getAlertDrillthrough(makeAlert());
    expect(target.path).toBe('/battery');
    expect(target.query).toEqual({
      vehicle_id: '12',
      t: '2026-04-30T13:00:00.000Z',
      signal: 'BatteryLevel',
    });
  });

  it('routes ChargeState alerts to /charging', () => {
    const target = getAlertDrillthrough(makeAlert({ rule_signal: 'ChargeState' }));
    expect(target.path).toBe('/charging');
    expect(target.query.signal).toBe('ChargeState');
  });

  it('routes tire-pressure alerts to /tire-pressure', () => {
    const target = getAlertDrillthrough(makeAlert({ rule_signal: 'TpmsPressureFl' }));
    expect(target.path).toBe('/tire-pressure');
  });

  it('routes climate alerts to /climate-control', () => {
    const target = getAlertDrillthrough(makeAlert({ rule_signal: 'InsideTemp' }));
    expect(target.path).toBe('/climate-control');
  });

  it('routes security alerts to /security-access', () => {
    const target = getAlertDrillthrough(makeAlert({ rule_signal: 'SentryMode' }));
    expect(target.path).toBe('/security-access');
  });

  it('falls back to /signal-explorer when the signal is unknown', () => {
    const target = getAlertDrillthrough(makeAlert({ rule_signal: 'NotARealSignal' }));
    expect(target.path).toBe(SIGNAL_EXPLORER_FALLBACK);
    expect(target.query.signal).toBe('NotARealSignal');
  });

  it('falls back to /signal-explorer when there is no signal', () => {
    const target = getAlertDrillthrough(makeAlert({ rule_signal: null }));
    expect(target.path).toBe(SIGNAL_EXPLORER_FALLBACK);
    expect(target.query.signal).toBeUndefined();
  });

  it('omits vehicle_id when alert has none (treats 0 as no vehicle)', () => {
    const target = getAlertDrillthrough(makeAlert({ vehicle_id: 0 }));
    expect(target.query.vehicle_id).toBeUndefined();
    expect(target.query.t).toBe('2026-04-30T13:00:00.000Z');
  });

  it('omits the timestamp param when created_at is empty', () => {
    const target = getAlertDrillthrough(makeAlert({ created_at: '' }));
    expect(target.query.t).toBeUndefined();
  });
});

describe('getAlertDrillthroughHref', () => {
  it('builds a query-string URL', () => {
    const href = getAlertDrillthroughHref(makeAlert());
    expect(href).toBe('/battery?vehicle_id=12&t=2026-04-30T13%3A00%3A00.000Z&signal=BatteryLevel');
  });

  it('returns just the path when there are no query params', () => {
    const href = getAlertDrillthroughHref(makeAlert({
      vehicle_id: 0,
      created_at: '',
      rule_signal: null,
    }));
    expect(href).toBe(SIGNAL_EXPLORER_FALLBACK);
  });
});

describe('SIGNAL_TO_PAGE', () => {
  it('maps every entry to a non-empty route starting with /', () => {
    Object.entries(SIGNAL_TO_PAGE).forEach(([signal, path]) => {
      expect(path, `signal "${signal}" should map to a non-empty route`).toMatch(/^\//);
    });
  });
});
