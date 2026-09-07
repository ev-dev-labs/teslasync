import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DriveDynamicsSnapshot, MotorSnapshot } from '@/api/types';

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

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatPower: (watts: number | null) => (watts == null ? '—' : `${(watts / 1000).toFixed(1)} kW`),
    formatTemperature: (c: number | null) => (c == null ? '—' : `${c.toFixed(0)}°C`),
  }),
}));

const motorState = vi.hoisted(() => ({
  data: undefined as MotorSnapshot | null | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

const dynamicsState = vi.hoisted(() => ({
  data: undefined as DriveDynamicsSnapshot | null | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
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
  dynamicsState.data = undefined;
  dynamicsState.isLoading = false;
  dynamicsState.isError = false;
  dynamicsState.error = null;
});

describe('GrokDynamicsBriefing', () => {
  it('keeps the shell and empty state when nothing is measured', () => {
    renderBriefing();
    expect(screen.getByTestId('grok-dynamics-briefing')).toBeInTheDocument();
    expect(screen.getByText("Grok's powertrain read")).toBeInTheDocument();
    expect(
      screen.getByText('Drive the car so Grok can read axle torque, regen, and chassis g.'),
    ).toBeInTheDocument();
  });

  it('shows a loading status before the first snapshot', () => {
    motorState.isLoading = true;
    dynamicsState.isLoading = true;
    renderBriefing();
    expect(screen.getByRole('status', { name: 'Loading Grok powertrain read…' })).toBeInTheDocument();
  });

  it('surfaces a transport error instead of pretending there is no telemetry', () => {
    motorState.isError = true;
    motorState.error = new Error('motor down');
    dynamicsState.isError = true;
    renderBriefing();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
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

    expect(screen.getByText('Motors are charging the pack — that is free range.')).toBeInTheDocument();
    expect(screen.getByText('12.0 kW')).toBeInTheDocument();
    expect(screen.getByText(/one-pedal Tesla/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Tesla physics cockpit' })).toHaveAttribute(
      'href',
      '/physics-cockpit',
    );
  });
});
