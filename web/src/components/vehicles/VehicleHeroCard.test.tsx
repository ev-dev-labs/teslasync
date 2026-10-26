import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleHeroCard, type VehicleHeroCardProps } from './VehicleHeroCard';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';

const units = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi', temperature: '°C' as '°C' | '°F', power: 'kW' as 'W' | 'kW' }));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: units }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      return fallback.replace(/{{(\w+)}}/g, (_match, name: string) =>
        opts && name in opts ? String(opts[name]) : `{{${name}}}`,
      );
    },
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatRelative: () => 'just now',
    formatDateTime: () => '2026-10-22 20:05 UTC',
  }),
}));
vi.mock('@/components/charts/LinearGauge', () => ({
  LinearGauge: ({ value, max, min, unit, label, preserveReadingAndScale, tone }: {
    value: number | null; max: number; min?: number; unit?: string; label: string;
    preserveReadingAndScale?: boolean; tone?: string;
  }) => (
    <div data-testid="gauge" data-label={label} data-value={String(value)}
      data-max={max} data-min={min} data-unit={unit}
      data-preserve-reading={String(preserveReadingAndScale)} data-tone={tone ?? ''} />
  ),
}));

const makeVehicle = (over: Partial<VehicleHeroCardProps['vehicle']> = {}): VehicleHeroCardProps['vehicle'] => ({
  id: 7,
  display_name: 'Aurora',
  model: 'Model Y Long Range',
  vin: '5YJ3E1EA7KF000123',
  state: 'online',
  ...over,
});
const makeState = (over: Partial<NonNullable<VehicleHeroCardProps['vehicleState']>> = {}): NonNullable<VehicleHeroCardProps['vehicleState']> => ({
  battery_level: 72,
  rated_range: 660_000,
  inside_temp: 21,
  outside_temp: 18,
  odometer: 12_345_678,
  is_locked: true,
  sentry_mode: true,
  software_version: '2024.44.25',
  power: 42_000,
  state: 'driving',
  ...over,
});

beforeEach(() => {
  units.distance = 'km';
  units.temperature = '°C';
  units.power = 'kW';
});

function renderCard(props: Partial<VehicleHeroCardProps> = {}) {
  return render(
    <MemoryRouter>
      <VehicleHeroCard
        vehicle={makeVehicle()}
        vehicleState={makeState()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('VehicleHeroCard redesigned contract', () => {
  it.each([null, Number.NaN])('announces unavailable range and temperatures (%s) without numeric meters', (value) => {
    renderCard({ vehicleState: makeState({
      rated_range: value, inside_temp: value, outside_temp: value,
    }) });
    for (const label of ['Range', 'Inside', 'Outside']) {
      expect(screen.getByRole('group', { name: label, exact: true }))
        .toHaveAccessibleDescription('Unknown');
      expect(screen.queryByRole('meter', { name: label, exact: true })).not.toBeInTheDocument();
    }
  });

  it('keeps genuine zero range and temperatures readable without fabricated scales', () => {
    renderCard({ vehicleState: makeState({ rated_range: 0, inside_temp: 0, outside_temp: 0 }) });
    for (const label of ['Range', 'Inside', 'Outside']) {
      const reading = screen.getByRole('group', { name: label, exact: true });
      expect(reading).toHaveTextContent(label === 'Range' ? '0km' : '0°C');
      expect(reading).not.toHaveAccessibleDescription('Unknown');
    }
  });

  it('matches the compact After layout: identity, battery, range, chips, and details footer', () => {
    renderCard({ verifiedFields: ['state', 'battery_level', 'rated_range'] });
    expect(screen.getByRole('heading', { name: 'Aurora' })).toBeInTheDocument();
    expect(screen.getByText(/Model Y Long Range ·/)).toBeInTheDocument();
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByTestId('gauge')).toHaveAttribute('data-label', 'Battery');
    expect(screen.getByTestId('gauge')).toHaveAttribute('data-value', '72');
    expect(screen.getByText('660')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByText(/Locked/)).toBeInTheDocument();
    expect(screen.getByText(/Sentry On/)).toBeInTheDocument();
    expect(screen.getByText(/Inside 21°C/)).toBeInTheDocument();
    expect(screen.getByText(/Outside 18°C/)).toBeInTheDocument();
    expect(screen.getByText('3 verified fields')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Details/ })).toHaveAttribute('href', '/vehicles/7');
  });

  it('uses SI conversion and shared user unit preferences without fabrication', () => {
    units.distance = 'mi';
    units.temperature = '°F';
    renderCard({ vehicleState: makeState({ rated_range: 400_000, inside_temp: 21, outside_temp: 14 }) });
    expect(screen.getByText(String(Math.round(convertDistanceFromSI(400_000, 'mi'))))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${Math.round(convertTempFromSI(21, '°F'))}°F`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${Math.round(convertTempFromSI(14, '°F'))}°F`))).toBeInTheDocument();
  });

  it('keeps zero readings and false flags real and missing readings unknown', () => {
    units.distance = 'km';
    units.temperature = '°C';
    renderCard({ vehicleState: makeState({
      battery_level: 0, rated_range: 0, inside_temp: null, outside_temp: NaN,
      is_locked: false, sentry_mode: false,
    }) });
    expect(screen.getByTestId('gauge')).toHaveAttribute('data-value', '0');
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/Unlocked/)).toBeInTheDocument();
    expect(screen.getByText(/Sentry Off/)).toBeInTheDocument();
    expect(screen.queryByText(/0°C/)).not.toBeInTheDocument();
  });

  it('renders an explicit unavailable state and retains identity/actions', () => {
    renderCard({ vehicleState: null });
    expect(screen.getByRole('status')).toHaveTextContent('Live telemetry unavailable');
    expect(screen.queryByTestId('gauge')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aurora' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Details/ })).toBeInTheDocument();
  });

  it('does not turn historical provenance or unknown observation into live freshness', () => {
    renderCard({
      dataState: { provenance: 'historical', status: 'stale', hasData: true } as never,
      observation: { observedAt: Date.UTC(2026, 9, 22, 20, 5), freshness: 'fresh' },
    });
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/Last real observation/)).toBeInTheDocument();
  });

  it('renders photo, forwards ref and attributes, and keeps identity text intact', () => {
    const ref = createRef<HTMLDivElement>();
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <VehicleHeroCard
          ref={ref}
          vehicle={makeVehicle({ display_name: 'Vehicle identity '.repeat(12), vin: 'A'.repeat(80) })}
          vehicleState={makeState()}
          photoUrl="https://cdn.example/actual-paint.jpg"
          dir="rtl"
          data-testid="hero"
          onClick={onClick}
        />
      </MemoryRouter>,
    );
    expect(ref.current).toBe(screen.getByTestId('hero'));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example/actual-paint.jpg');
    fireEvent.click(screen.getByTestId('hero'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('navigates through the one Details link with keyboard activation', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default.setup());
    render(
      <MemoryRouter initialEntries={['/fleet']}>
        <Routes>
          <Route path="/fleet" element={<VehicleHeroCard vehicle={makeVehicle()} vehicleState={makeState()} />} />
          <Route path="/vehicles/7" element={<div>Details destination</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.tab();
    expect(screen.getByRole('link', { name: /Details/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Details destination')).toBeInTheDocument();
  });
});
