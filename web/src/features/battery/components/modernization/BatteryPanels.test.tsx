import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { ChargingTelemetry } from '@/api/types';
import type { BatteryHealthAnalytics } from '@/types/energy';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import {
  BatteryPanelGrid, BatterySpecialistSummary, CostComparisonCard,
  HealthSummary, HealthThermalPanel, HealthQuickLinksPanel,
} from './index';

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function telemetry(overrides: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 7, ts: '2026-10-04T12:00:00Z', session_id: null,
    battery_level: null, battery_range_mi: null, charging_state: null,
    charger_voltage: null, charger_actual_current: null, charger_power_w: null,
    charger_phases: null, charge_energy_added_wh: null, range_added_meters: null,
    range_added_meters_per_hour: null, charger_pilot_current: null,
    scheduled_charging_at: null, source: 'test-only',
    ...overrides,
  };
}

describe('live battery canonical packing adapter', () => {
  it('uses exactly one host observer, canonical spans, stable source order and no inline geometry', () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    });
    const { container } = render(
      <BatteryPanelGrid label="Independent evidence" ids={['model', 'live', 'details']}>
        <div>Model source</div><div>Live source</div><div>Full details</div>
      </BatteryPanelGrid>,
    );
    expect(callbacks).toHaveLength(1);
    const host = container.querySelector('[data-card-grid]')!;
    const panels = Array.from(container.querySelectorAll('[data-battery-panel]'));
    const resize = (width: number) => act(() => callbacks[0]([
      { target: host, contentRect: { width } } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    for (const [width, expected] of [
      [320, ['1', '1', '1']], [768, ['6', '6', '6']],
      [1280, ['6', '6', '12']], [2560, ['6', '6', '12']],
    ] as const) {
      resize(width);
      expect(panels.map(panel => panel.getAttribute('data-card-resolved-span'))).toEqual(expected);
      expect(Array.from(host.querySelectorAll('[data-battery-panel]'))).toEqual(panels);
      expect(panels.map(panel => panel.getAttribute('data-battery-panel'))).toEqual(['model', 'live', 'details']);
      expect(host.querySelectorAll('[style]')).toHaveLength(0);
    }
    expect(callbacks).toHaveLength(1);
    expect(screen.getByText('Full details')).toBeVisible();
  });
});

describe('battery specialist display fidelity', () => {
  it('keeps denominator, lower bound, precision, unknowns and independent periods without inventing comparisons', () => {
    const metrics = Object.freeze([
      { key: 'costPerDist', label: 'Cost per mi', value: '$0.0167' },
      { key: 'sessions', label: 'Sessions', value: '≥ 100' },
      { key: 'cycles', label: 'Equivalent full cycles', value: '12.3456' },
      { key: 'missing-health', label: 'State of Health', value: '—' },
    ]);
    const { container, rerender } = render(
      <BatterySpecialistSummary title="Source summary" testId="specialist-test" metrics={metrics}
        period={{ kind: 'unknown', label: 'Independent source periods', reason: 'Coverage is not a lifetime measurement.' }} />,
    );
    expect(Array.from(container.querySelectorAll('[data-stat-value]')).map(node => node.textContent))
      .toEqual(['$0.0167', '≥ 100', '12.3456', '—']);
    expect(container.querySelector('[data-stat-delta]')).toBeNull();
    expect(screen.getByText('Coverage is not a lifetime measurement.')).toBeVisible();
    setGlobalPrecision(0);
    rerender(<BatterySpecialistSummary title="Source summary" testId="specialist-test" metrics={metrics}
      period={{ kind: 'unknown', label: 'Independent source periods' }} />);
    expect(Array.from(container.querySelectorAll('[data-stat-value]')).map(node => node.textContent))
      .toEqual(['$0.0167', '≥ 100', '12.3456', '—']);
    expect(metrics[0].value).toBe('$0.0167');
  });

  it('retains all seven health metrics and the live false BMS flag without a model or a false healthy score', () => {
    const { container } = render(<HealthSummary chargingLive={telemetry({ bms_fullcharge_complete: false })}
      healthMeasured={false} healthValue="—" capacityMeasured={false} originalCapacityMeasured={false}
      formatEnergy={value => String(value)} formatNumber={value => String(value)} />);
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(7);
    expect(Array.from(container.querySelectorAll('[data-stat-value]')).map(node => node.textContent))
      .toEqual(['—', '—', '—', '—', '—', '—', 'No']);
    expect(screen.getByText('Full Charge Complete')).toBeVisible();
    expect(container.querySelector('[data-period-kind="unknown"]')).not.toBeNull();
  });

  it('preserves the original fractional health, capacity, annual rate, cycles and integer-month displays', () => {
    const health: BatteryHealthAnalytics = {
      vehicle_id: 7, current_soh: 95.1234, estimated_capacity_wh: 71342.5,
      original_capacity_wh: 75000, degradation_rate_pct_per_year: 1.2345,
      battery_age_months: 27, total_cycles: 123.4567,
      avg_depth_of_discharge_pct: 30, fast_charge_pct: 10, full_charge_pct: 5,
      charge_habits_score: 90, stress_level: 'Low', temp_exposure_score: null, temp_exposure_reason: null,
      history: [], projections: [], risk_factors: [], recommendations: [], capacity_source: 'test-only',
      prediction: { has_enough_data: false, slope_per_year: 0, years_to_80_pct: 0,
        predicted_date: null, projection_points: [] },
      charging_habits: { fast_charge_count: 1, slow_charge_count: 9, deep_discharge_count: 0,
        charge_to_full_count: 0, high_soc_count: 0, avg_energy_per_session: 10000, total_count: 10 },
      charging_analysis: { charge_level_distribution: [], avg_start_soc_pct: null, avg_end_soc_pct: null,
        ac_session_count: 9, dc_session_count: 1, supercharger_count: 0, dc_fast_count: 1,
        deep_discharge_count: 0, ac_energy_wh: 90000, dc_energy_wh: 10000, total_sessions: 10 },
    };
    const before = JSON.stringify(health);
    const { container } = render(<HealthSummary health={health} chargingLive={telemetry({ bms_fullcharge_complete: true })}
      healthMeasured healthValue="95.1234%" capacityMeasured originalCapacityMeasured
      formatEnergy={value => `${(value / 1000).toFixed(4)} kWh`} formatNumber={value => value.toFixed(4)} />);
    expect(Array.from(container.querySelectorAll('[data-stat-value]')).map(node => node.textContent)).toEqual([
      '95.1234%', '71.3425 kWh', '75.0000 kWh', '1.2345%/yr', '123.4567', '27 months', 'Yes',
    ]);
    expect(JSON.stringify(health)).toBe(before);
  });

  it.each([
    { evCost: 10, gasCost: 20, direction: 'Saving', percentage: '50.00%' },
    { evCost: 30, gasCost: 20, direction: 'Higher by', percentage: '50.00%' },
    { evCost: 0, gasCost: 20, direction: 'Saving', percentage: '100.00%' },
  ])('preserves source gas-versus-EV arithmetic ($evCost vs $gasCost)', ({ evCost, gasCost, direction, percentage }) => {
    render(<CostComparisonCard label="Selected period" evCost={evCost} gasCost={gasCost} icon={<span />} />);
    expect(screen.getByText(direction, { exact: false })).toBeVisible();
    expect(screen.getByText(percentage, { exact: false })).toBeVisible();
  });

  it.each([[null, 20], [10, null], [10, 0]])('withholds unsupported savings (%s vs %s)', (evCost, gasCost) => {
    render(<CostComparisonCard label="Selected period" evCost={evCost} gasCost={gasCost} icon={<span />} />);
    expect(screen.getByText('Complete charging-cost coverage is required before savings are modeled.')).toBeVisible();
    expect(screen.queryByText(/less|more/)).toBeNull();
  });
});

describe('independent battery thermal source and navigation', () => {
  it('keeps measured zero, false heater, module identities and specialist temperature differences during refresh failure', () => {
    const retry = vi.fn();
    const state = deriveDataState({
      data: telemetry({ module_temp_max: 10, module_temp_min: 0, num_module_temp_max: 4,
        num_module_temp_min: 2, battery_heater_on: false }),
      isError: true, error: new Error('test-only-refresh-failure'), dataUpdatedAt: Date.now(), refetch: retry,
    }, { provenance: 'live' });
    render(<HealthThermalPanel state={state} loading={false} retry={retry}
      formatNumber={value => value.toFixed(2)} toTemperatureDisplay={value => value * 1.8 + 32} tempUnit="°F" />);
    expect(screen.getByText('50.00 °F')).toBeVisible();
    expect(screen.getByText('32.00 °F')).toBeVisible();
    expect(screen.getByText('18.00 °F')).toBeVisible();
    expect(screen.getByText('Off')).toBeVisible();
    expect(screen.getByText('Module #4')).toBeVisible();
    expect(screen.getByText('Module #2')).toBeVisible();
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retains thermal shell and retry on initial failure without manufacturing readings', () => {
    const retry = vi.fn();
    const state = deriveDataState<ChargingTelemetry | null>({
      data: undefined, isError: true, error: new Error('Thermal test source failed'), refetch: retry,
    });
    render(<MemoryRouter><HealthThermalPanel state={state} loading={false} retry={retry}
      formatNumber={value => String(value)} toTemperatureDisplay={value => value} tempUnit="°C" /></MemoryRouter>);
    expect(screen.getByText('Thermal Monitoring')).toBeVisible();
    expect(screen.getByText("Can't reach server")).toBeVisible();
    expect(screen.getByText('Module Temp (Max)')).toBeVisible();
    expect(screen.getByText('Temperature Spread')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0 °C')).toBeNull();
  });

  it('keeps all original quick-link destinations reachable independently of source availability', () => {
    render(<MemoryRouter><HealthQuickLinksPanel /></MemoryRouter>);
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/battery-cells', '/battery-degradation', '/energy-flow', '/projected-range',
      '/vampire-drain', '/sleep-efficiency',
    ]);
  });
});
