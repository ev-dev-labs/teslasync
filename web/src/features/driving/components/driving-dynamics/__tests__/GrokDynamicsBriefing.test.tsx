import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DriveDynamicsSnapshot, MotorSnapshot } from '@/api/types';
import type { UseUnitsResult } from '@/hooks/useUnits';

const paletteState = vi.hoisted(() => ({ colors: ['var(--semantic-info)', 'var(--semantic-purple)'] }));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => paletteState.colors,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, values?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOpts === 'string'
        ? fallbackOrOpts
        : fallbackOrOpts && typeof fallbackOrOpts === 'object'
          && typeof (fallbackOrOpts as { defaultValue?: string }).defaultValue === 'string'
          ? (fallbackOrOpts as { defaultValue: string }).defaultValue
          : key;
      const vars = {
        ...(typeof fallbackOrOpts === 'object' && fallbackOrOpts ? fallbackOrOpts as Record<string, unknown> : {}),
        ...(values ?? {}),
      };
      return Object.entries(vars).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

vi.mock('@/hooks/useUnits', async () => {
  const lib = await vi.importActual<typeof import('@/lib/unitConversion')>('@/lib/unitConversion');
  const unitPrefs: UseUnitsResult['unitPrefs'] = {
    distance: 'km',
    speed: 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
  };
  return {
    useUnits: (): UseUnitsResult => ({
      unitPrefs,
      formatDistance: (value, options) => lib.formatDistance(value, unitPrefs, options),
      formatSpeed: (value, options) => lib.formatSpeed(value, unitPrefs, options),
      formatTemperature: (value, options) => lib.formatTemperature(value, unitPrefs, { precision: 0, ...options }),
      formatPressure: (value, options) => lib.formatPressure(value, unitPrefs, options),
      formatEnergy: (value, options) => lib.formatEnergy(value, unitPrefs, options),
      formatDuration: (value, options) => lib.formatDuration(value, unitPrefs, options),
      formatPower: (value, options) => lib.formatPower(value, unitPrefs, { precision: 1, ...options }),
    }),
  };
});

const motorState = vi.hoisted(() => ({
  data: undefined as MotorSnapshot | null | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  refetch: vi.fn(),
}));

const dynamicsState = vi.hoisted(() => ({
  data: undefined as DriveDynamicsSnapshot | null | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useMotorLatest: () => motorState,
  useDriveDynamicsLatest: () => dynamicsState,
}));

import GrokDynamicsBriefing from '../GrokDynamicsBriefing';

function motor(over: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-03-01T12:00:00Z',
    created_at: '2026-03-01T12:00:00Z',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: 'D',
    vbat_front: null,
    vbat_rear: null,
    ...over,
  };
}

function renderBriefing() {
  return render(
    <MemoryRouter>
      <GrokDynamicsBriefing vehicleId={7} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  motorState.data = undefined;
  motorState.isLoading = false;
  motorState.isError = false;
  motorState.error = null;
  motorState.fetchStatus = 'idle';
  dynamicsState.data = undefined;
  dynamicsState.isLoading = false;
  dynamicsState.isError = false;
  dynamicsState.error = null;
  dynamicsState.fetchStatus = 'idle';
  vi.clearAllMocks();
});

describe('GrokDynamicsBriefing', () => {
  it('keeps the cockpit action a keyboard-reachable native link with mobile minima and compact desktop sizing', async () => {
    motorState.data = motor({ torque_nm_front: 25, torque_nm_rear: 75 });
    renderBriefing();
    const link = screen.getByRole('link', { name: 'Open Tesla physics cockpit' });
    expect(link).toHaveAttribute('href', '/physics-cockpit');
    expect(link).toHaveClass('inline-flex', 'min-h-11', 'min-w-11', 'md:min-h-6', 'md:min-w-0');
    const focusableCount = document.querySelectorAll('button, a[href], input, select, [tabindex="0"]').length;
    for (let step = 0; step <= focusableCount && document.activeElement !== link; step++) {
      await userEvent.tab();
    }
    expect(link).toHaveFocus();
    expect(screen.getByTestId('grok-dynamics-briefing'))
      .toHaveClass('max-md:[&_button]:min-h-11', 'max-md:[&_button]:min-w-11');
  });

  it('recolors the rear-share fill while preserving signed torque and the absolute denominator', () => {
    motorState.data = motor({ torque_nm_front: -25, torque_nm_rear: 75 });
    const view = renderBriefing();
    const share = screen.getByRole('progressbar', { name: 'Rear axle share' });
    expect(share).toHaveAttribute('aria-valuenow', '75');
    expect(share.querySelector('[data-metric-fill]')).toHaveStyle({ background: paletteState.colors[0] });
    paletteState.colors = ['var(--semantic-purple)', 'var(--semantic-info)'];
    view.rerender(<MemoryRouter><GrokDynamicsBriefing vehicleId={7} /></MemoryRouter>);
    expect(screen.getByRole('progressbar', { name: 'Rear axle share' })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByRole('progressbar', { name: 'Rear axle share' }).querySelector('[data-metric-fill]'))
      .toHaveStyle({ background: paletteState.colors[0] });
    expect(screen.getByText('Axle torque').closest('[data-operational-metric]')).toHaveTextContent('50.00 Nm');
  });

  it.each([-0.4, 0.4])('retains lateral acceleration direction in the cornering finding (%s g)', lateral => {
    motorState.data = motor({ torque_nm_front: -25, torque_nm_rear: 75 });
    dynamicsState.data = { lateral_acceleration: lateral, longitudinal_acceleration: 0.3 };
    renderBriefing();

    const finding = screen.getByTestId('grok-dynamics-briefing').querySelector('[data-finding="cornering"]');
    expect(finding).toHaveTextContent(`Lateral accelerometer ${lateral.toFixed(2)} g.`);
    expect(screen.getByText('Combined g').closest('[data-operational-metric]')).toHaveTextContent('0.50 g');
    expect(screen.getByText('Axle torque').closest('[data-operational-metric]')).toHaveTextContent('50.00 Nm');
    expect(screen.getByText('Rear axle accounts for 75.00% of reported absolute axle torque. This does not establish traction or grip.')).toBeInTheDocument();
  });

  it.each([null, undefined, NaN, Infinity])('keeps missing or invalid power unknown (%s)', value => {
    motorState.data = motor({ power_kw: value, regen_kw: 0 });
    renderBriefing();
    const metric = screen.getByText('Drive power').closest('[data-operational-metric]');
    expect(metric).toHaveAttribute('data-value-state', 'missing');
    const regen = screen.getByText('Regen harvest').closest('[data-operational-metric]');
    expect(regen).toHaveAttribute('data-value-state', 'value');
  });

  it('preserves signed fractional power, measured zero, and the absolute axle denominator', () => {
    motorState.data = motor({
      torque_nm_front: -0.25, torque_nm_rear: 0.75, power_kw: -0.125, regen_kw: 0,
    });
    dynamicsState.data = { lateral_acceleration: -0.3, longitudinal_acceleration: 0.4 };
    renderBriefing();
    expect(screen.getByText('Rear axle accounts for 75.00% of reported absolute axle torque. This does not establish traction or grip.')).toBeInTheDocument();
    expect(screen.getByText('-0.1 kW')).toBeInTheDocument();
    expect(screen.getByText('0.0 kW')).toBeInTheDocument();
    expect(screen.getByText('Axle torque').closest('[data-operational-metric]')).toHaveTextContent('0.50 Nm');
    expect(screen.getByText('Combined g').closest('[data-operational-metric]')).toHaveTextContent('0.50 g');
  });

  it('keeps the shell and empty state when nothing is measured', () => {
    renderBriefing();
    expect(screen.getByTestId('grok-dynamics-briefing')).toBeInTheDocument();
    expect(screen.getByText('Live powertrain interpretation')).toBeInTheDocument();
    expect(
      screen.getByText('No current axle torque, regen, or acceleration signals reported.'),
    ).toBeInTheDocument();
  });

  it('shows a loading status before the first snapshot', () => {
    motorState.isLoading = true;
    dynamicsState.isLoading = true;
    renderBriefing();
    expect(screen.getByRole('status', { name: 'Loading current powertrain signals…' })).toBeInTheDocument();
  });

  it('surfaces a transport error instead of pretending there is no telemetry', () => {
    motorState.isError = true;
    motorState.error = new Error('motor down');
    dynamicsState.isError = true;
    renderBriefing();
    expect(screen.getAllByRole('button', { name: /retry/i })).toHaveLength(2);
  });

  it('reads regen harvest and links to the physics cockpit', () => {
    motorState.data = motor({
      torque_nm_front: -80,
      torque_nm_rear: -40,
      regen_kw: 12,
      power_kw: 0,
    });
    dynamicsState.data = {
      brake_pedal_active: false,
      pedal_position: 0,
    };

    renderBriefing();

    expect(screen.getByText(/Regeneration is reported in current motor signals/)).toBeInTheDocument();
    expect(screen.getByText('12.0 kW')).toBeInTheDocument();
    expect(screen.getByText(/brake switch reports inactive/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Tesla physics cockpit' })).toHaveAttribute(
      'href',
      '/physics-cockpit',
    );
  });

  it('shows initial pause and retries only its source while preserving independent zero readings', () => {
    motorState.fetchStatus = 'paused';
    dynamicsState.data = { lateral_acceleration: 0, longitudinal_acceleration: 0, pedal_position: 0 };
    renderBriefing();
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    expect(screen.queryByText(/device is offline/i)).toBeNull();
    expect(screen.getByText('Combined g')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(motorState.refetch).toHaveBeenCalledTimes(1);
    expect(dynamicsState.refetch).not.toHaveBeenCalled();
  });

  it('does not infer an empty result while both initial sources are paused and recovers', () => {
    motorState.fetchStatus = 'paused';
    dynamicsState.fetchStatus = 'paused';
    const view = renderBriefing();
    expect(screen.getAllByText('The initial evidence query is paused; no empty result is inferred.')).toHaveLength(2);
    expect(screen.queryByText('No current axle torque, regen, or acceleration signals reported.')).toBeNull();
    motorState.fetchStatus = 'idle';
    dynamicsState.fetchStatus = 'idle';
    motorState.data = motor({ shift_state: null });
    dynamicsState.data = {};
    view.rerender(<MemoryRouter><GrokDynamicsBriefing vehicleId={7} /></MemoryRouter>);
    expect(screen.queryByText(/initial evidence query is paused/)).toBeNull();
    expect(screen.getByText('No current axle torque, regen, or acceleration signals reported.')).toBeInTheDocument();
  });

  it('retains motor readings on refresh failure, retries only motor and clears the warning on recovery', () => {
    motorState.data = motor({ power_kw: 0, regen_kw: 12 });
    motorState.isError = true;
    motorState.error = new Error('refresh failed');
    dynamicsState.data = { pedal_position: 0 };
    const view = renderBriefing();
    expect(screen.getByText('12.0 kW')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(motorState.refetch).toHaveBeenCalledTimes(1);
    expect(dynamicsState.refetch).not.toHaveBeenCalled();
    motorState.isError = false;
    motorState.error = null;
    view.rerender(<MemoryRouter><GrokDynamicsBriefing vehicleId={7} /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByText('12.0 kW')).toBeInTheDocument();
  });
});
