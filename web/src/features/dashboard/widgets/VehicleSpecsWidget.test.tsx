import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VehicleSpecsWidget from './VehicleSpecsWidget';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

const state = vi.hoisted(() => ({
  vehicles: [] as Array<{ id: number }>,
  specs: null as Record<string, unknown> | null,
  config: null as Record<string, unknown> | null,
  specsError: null as Error | null,
  configError: null as Error | null,
  specsRefetch: vi.fn(),
  configRefetch: vi.fn(),
  updatedAt: 1_700_000_000_000,
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: state.vehicles,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: state.updatedAt,
    refetch: vi.fn(),
  }),
  useVehicleSpecs: () => ({
    data: state.specs == null ? null : { data: state.specs, fetched_at: '2026-01-01T00:00:00Z' },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: state.specsError != null,
    error: state.specsError,
    dataUpdatedAt: state.updatedAt,
    refetch: state.specsRefetch,
  }),
  useVehicleConfigLatest: () => ({
    data: state.config,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: state.configError != null,
    error: state.configError,
    dataUpdatedAt: state.updatedAt,
    refetch: state.configRefetch,
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatEnergy: (value: number | null | undefined, options?: { precision?: number }) =>
      value == null ? '—' : `${(value / 1000).toFixed(options?.precision ?? 1)} kWh`,
  }),
}));

function props(cols = 2) {
  return { vehicleId: 7, size: { cols, rows: 2 } };
}

describe('VehicleSpecsWidget — After card', () => {
  beforeEach(() => {
    state.vehicles = [{ id: 7 }];
    state.specs = null;
    state.config = null;
    state.specsError = null;
    state.configError = null;
    state.specsRefetch.mockReset();
    state.configRefetch.mockReset();
  });

  it('renders the seven source-backed After rows in order without fabricated fields', () => {
    state.specs = {
      car_type: 'Model 3',
      trim_badging: 'Long Range AWD',
      model_year: 2023,
      exterior_color: 'Midnight Silver',
      wheel_type: '18" Aero',
      battery_capacity_wh: 82_000,
      battery_type: 'NCA',
      motor_type: 'Dual',
      interior: 'Black',
    };

    render(<VehicleSpecsWidget {...props()} />);

    for (const label of ['Model', 'Year', 'Paint color', 'Wheels', 'Battery', 'Motors', 'Interior']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Model 3 Long Range AWD')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('82 kWh · NCA')).toBeInTheDocument();
    expect(screen.queryByText('Aux battery')).toBeNull();
    expect(screen.queryByText('Car version')).toBeNull();
  });

  it('uses config fallback values and keeps unknown fields as em dashes', () => {
    state.specs = { car_type: 'Model Y' };
    state.config = { car_type: 'Fallback', trim: 'Performance', exterior_color: 'Red', wheel_type: 'Aero' };

    render(<VehicleSpecsWidget {...props()} />);

    expect(screen.getByText('Model Y Performance')).toBeInTheDocument();
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Aero')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/undefined|NaN|null/)).toBeNull();
  });

  it('shows an empty state for no data and no fabricated placeholder card', () => {
    render(<VehicleSpecsWidget {...props()} />);
    expect(screen.getByText('No specs available').closest('[role="status"]')).not.toBeNull();
  });

  it('surfaces a source failure without replacing available data as an error-only view', () => {
    state.specs = { car_type: 'Model S' };
    state.configError = new Error('config unavailable');
    render(<VehicleSpecsWidget {...props()} />);
    expect(screen.getByText('Model S')).toBeInTheDocument();
  });

  it('renders compact model and trim hero only at one column', () => {
    state.specs = { car_type: 'Model X', trim_badging: 'Plaid' };
    render(<VehicleSpecsWidget {...props(1)} />);
    expect(screen.getByText('Model X Plaid')).toBeInTheDocument();
    expect(screen.queryByText('Paint color')).toBeNull();
    expect(screen.queryByText('Battery')).toBeNull();
  });

  it('refreshes both source reads from the freshness control', async () => {
    state.specs = { car_type: 'Model 3' };
    render(<VehicleSpecsWidget {...props()} />);
    const refresh = await screen.findByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);
    await waitFor(() => {
      expect(state.specsRefetch).toHaveBeenCalled();
      expect(state.configRefetch).toHaveBeenCalled();
    });
  });
});
