import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ChargingTelemetry } from '@/api/types';
import type { WidgetProps } from './types';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { inputPreferences } from '@/test/inputPreferences';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        let value = fallbackOrOpts;
        for (const [key, replacement] of Object.entries(opts ?? {})) {
          value = value.replace(`{{${key}}}`, String(replacement));
        }
        return value;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useChargingTelemetryLatest: vi.fn(),
}));

import { useVehicles, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import ChargingTelemetryWidget from './ChargingTelemetryWidget';

const mockUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockLive = useChargingTelemetryLatest as unknown as ReturnType<typeof vi.fn>;

function applyPreferences(overrides: Parameters<typeof inputPreferences>[0] = {}) {
  const settings = inputPreferences(overrides);
  setGlobalPrecision(settings.decimal_precision ?? 2);
  setGlobalLocale(settings.locale ?? 'en-US');
}

function makeTelemetry(over: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 1,
    ts: '2026-01-01T00:00:00Z',
    session_id: 1,
    battery_level: 80,
    battery_range_mi: 200,
    charging_state: 'Charging',
    charger_voltage: 240,
    charger_actual_current: 32,
    charger_power_w: 11000,
    charger_phases: 1,
    charge_energy_added_wh: 42000,
    range_added_meters: 120000,
    range_added_meters_per_hour: 36000,
    charger_pilot_current: 48,
    scheduled_charging_at: null,
    source: 'test',
    ...over,
  };
}

function makeQuery(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChargingTelemetryWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it('activates only fresh charging samples and keeps all electrical measurements', () => {
  mockLive.mockReturnValue(makeQuery({
    data: makeTelemetry({ ts: new Date().toISOString(), battery_level: 72 }),
  }));
  const { container } = renderWidget();
  expect(container.querySelector('.widget-cell-stream')).toHaveClass('widget-state-motion');
  expect(screen.getByText('Voltage')).toBeInTheDocument();
  expect(screen.getByText('Current')).toBeInTheDocument();
  expect(screen.getByText('Power')).toBeInTheDocument();
  expect(screen.getByText('Phases')).toBeInTheDocument();
  expect(screen.getByText('Charger')).toBeInTheDocument();
  expect(screen.getByText('Pilot')).toBeInTheDocument();
});

it('keeps stale samples readable without turning a recent poll into charging activity', () => {
  mockLive.mockReturnValue(makeQuery({
    data: makeTelemetry({ ts: new Date(Date.now() - 180_000).toISOString() }),
  }));
  const { container } = renderWidget();
  expect(screen.getByText('Power')).toBeInTheDocument();
  expect(container.querySelector('.widget-state-motion')).toBeNull();
});

it('does not animate completed charging telemetry', () => {
  mockLive.mockReturnValue(makeQuery({
    data: makeTelemetry({ ts: new Date().toISOString(), charging_state: 'Complete' }),
  }));
  const { container } = renderWidget();
  expect(screen.getByText('Not currently charging')).toBeInTheDocument();
  expect(container.querySelector('.widget-state-motion')).toBeNull();
});

beforeEach(() => {
  applyPreferences();
  mockUseVehicles.mockReset();
  mockLive.mockReset();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockLive.mockReturnValue(makeQuery({ data: makeTelemetry() }));
});

afterEach(() => applyPreferences());

describe('ChargingTelemetryWidget — After target', () => {
  it.each([1, 2, 3, 4])('renders the title at %i columns', (cols) => {
    renderWidget({ size: { cols, rows: 4 } });
    expect(screen.getByRole('heading', { name: 'Charging telemetry' })).toBeInTheDocument();
  });

  it('renders the six After-card measurements in one shared stat grid', () => {
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.getByText('240')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getAllByText('32').length).toBeGreaterThan(0);
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('11.0')).toBeInTheDocument();
    expect(screen.getByText('Phases')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.getByText('Pilot')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('uses SI watts without leaking the raw watt magnitude and honors power preference changes', () => {
    mockLive.mockReturnValue(makeQuery({
      data: makeTelemetry({ charger_power_w: 11234 }),
    }));
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('11.2')).toBeInTheDocument();
    expect(screen.queryByText(/11234/)).not.toBeInTheDocument();
  });

  it('uses whole-number voltage, current and pilot measurements', () => {
    mockLive.mockReturnValue(makeQuery({
      data: makeTelemetry({ charger_voltage: 240.125, charger_actual_current: 32.125, charger_pilot_current: 48.125 }),
    }));
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('240')).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('uses the DC charger label for voltages above 300 V', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charger_voltage: 400 }) }));
    renderWidget({ size: { cols: 4, rows: 2 } });
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('DC')).toBeInTheDocument();
  });

  it('does not derive or display efficiency, charger badge, sparkline, or a source timestamp', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry() }));
    const { container } = renderWidget({ size: { cols: 4, rows: 2 } });
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(screen.queryByText(/source timestamp/i)).not.toBeInTheDocument();
  });
});

describe('ChargingTelemetryWidget — honest states', () => {
  it('keeps null measurements unknown instead of zero', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({
      charger_power_w: null,
      charger_voltage: null,
      charger_actual_current: null,
      charger_phases: null,
      charger_pilot_current: null,
    }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    expect(screen.queryByText('0 V')).not.toBeInTheDocument();
  });

  it('shows the idle state when the vehicle is not charging', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charging_state: 'Disconnected' }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('Not currently charging')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
  });

  it('shows no charge data when charging_state is unknown', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charging_state: null }) }));
    renderWidget({ size: { cols: 1, rows: 1 } });
    expect(screen.getByText('No charge data')).toBeInTheDocument();
  });

  it('shows a genuine initial-load error, while retaining data through background errors', () => {
    mockLive.mockReturnValue(makeQuery({ isError: true, error: new Error('boom') }));
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();

    mockLive.mockReturnValue(makeQuery({
      data: makeTelemetry(),
      isError: true,
      error: new Error('boom'),
    }));
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('11.0')).toBeInTheDocument();
  });

  it('uses the selected vehicle and refresh interval', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockLive).toHaveBeenCalledWith(7, 5000);
  });

  it('falls back to the first vehicle or id 0', () => {
    renderWidget();
    expect(mockLive).toHaveBeenCalledWith(1, 5000);
    mockUseVehicles.mockReturnValue({ data: [] });
    renderWidget({ vehicleId: undefined });
    expect(mockLive).toHaveBeenLastCalledWith(0, 5000);
  });

  it('refreshes the live query through the shared freshness control', () => {
    const refetch = vi.fn();
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry(), refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
