import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  MemoryRouter,
  useLocation,
} from 'react-router-dom';
import type { Vehicle } from '../commands';

const { useVehiclesMock, useSelectedVehicleMock, setVehicleIdMock, refetchMock } =
  vi.hoisted(() => ({
    useVehiclesMock: vi.fn(),
    useSelectedVehicleMock: vi.fn(),
    setVehicleIdMock: vi.fn(),
    refetchMock: vi.fn(),
  }));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: useVehiclesMock,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: useSelectedVehicleMock,
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('../components/command-center', async () => {
  const actual = await vi.importActual<
    typeof import('../components/command-center')
  >('../components/command-center');
  return {
    ...actual,
    VehicleCommandCenter: ({ vehicle }: { vehicle: Vehicle }) => (
      <div data-testid="vehicle-command-center">{vehicle.display_name}</div>
    ),
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  const interpolate = (
    template: string,
    values?: Record<string, unknown>,
  ): string =>
    values
      ? template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
          String(values[key] ?? `{{${key}}}`),
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        if (typeof fallback === 'string') {
          return interpolate(
            fallback,
            options && typeof options === 'object'
              ? options as Record<string, unknown>
              : undefined,
          );
        }
        return key;
      },
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import CommandsPage from './CommandsPage';

function makeVehicle(
  id: number,
  overrides: Partial<Vehicle> = {},
): Vehicle {
  return {
    id,
    vin: `5YJ3E1EA0PF00000${id}`,
    display_name: `Car ${id}`,
    model: 'Model 3',
    state: 'online',
    updated_at: '2026-08-08T20:00:00Z',
    ...overrides,
  };
}

function installHooks({
  vehicles,
  loading = false,
  error = null,
  selected = vehicles?.[0] ?? null,
}: {
  vehicles?: Vehicle[];
  loading?: boolean;
  error?: Error | null;
  selected?: Vehicle | null;
}) {
  useVehiclesMock.mockReturnValue({
    data: vehicles,
    isLoading: loading,
    error,
    refetch: refetchMock,
  });
  useSelectedVehicleMock.mockReturnValue({
    vehicleId: selected?.id ?? null,
    vehicle: selected,
    vehicles: vehicles ?? [],
    setVehicleId: setVehicleIdMock,
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/commands']}>
      <CommandsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommandsPage', () => {
  it('renders useful section shells while the fleet is loading', () => {
    installHooks({ loading: true, vehicles: undefined, selected: null });

    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Vehicle Command Center',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Loading your fleet')).toBeInTheDocument();
    expect(screen.getByText('Command readiness')).toBeInTheDocument();
    expect(screen.getByText('Command workspace')).toBeInTheDocument();
    expect(screen.getByText('Safety & execution')).toBeInTheDocument();
    expect(screen.getByText('Recent command activity')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-command-center')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-management-workspace')).not.toBeInTheDocument();
  });

  it('renders a useful no-vehicle state without hiding safety or activity', () => {
    installHooks({ vehicles: [], selected: null });

    renderPage();

    expect(screen.getByText('No vehicles found')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Connect your Tesla account and sync your fleet/i),
    ).not.toHaveLength(0);
    expect(screen.getByTestId('command-safety')).toBeInTheDocument();
    expect(screen.getByText('Recent command activity')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select vehicle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-management-workspace')).not.toBeInTheDocument();
  });

  it('keeps all section shells visible when the roster query fails', () => {
    installHooks({
      vehicles: undefined,
      selected: null,
      error: new Error('fleet unavailable'),
    });

    renderPage();

    expect(screen.getByTestId('command-center-fallback')).toBeInTheDocument();
    expect(screen.getByText('Command readiness')).toBeInTheDocument();
    expect(screen.getByText('Command workspace')).toBeInTheDocument();
    expect(screen.getByText('Safety & execution')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the selected vehicle and honest last-known fleet reachability', () => {
    const roadster = makeVehicle(1, {
      display_name: 'Roadster',
      state: 'online',
    });
    const cybertruck = makeVehicle(2, {
      display_name: 'Cybertruck',
      state: 'asleep',
    });
    installHooks({
      vehicles: [roadster, cybertruck],
      selected: cybertruck,
    });

    renderPage();

    expect(screen.getByTestId('vehicle-command-center')).toHaveTextContent(
      'Cybertruck',
    );
    expect(screen.queryByTestId('vehicle-management-workspace')).not.toBeInTheDocument();
    expect(screen.getByText('1/2 recently reachable')).toBeInTheDocument();

    const picker = screen.getByLabelText('Select vehicle');
    expect(picker).toHaveValue('2');
    expect(
      within(picker).getByRole('option', { name: 'Roadster' }),
    ).toBeInTheDocument();
    expect(
      within(picker).getByRole('option', { name: 'Cybertruck' }),
    ).toBeInTheDocument();
  });

  it('updates the persistent selected vehicle from the page picker', () => {
    const first = makeVehicle(1);
    const second = makeVehicle(2);
    installHooks({ vehicles: [first, second], selected: first });

    renderPage();
    fireEvent.change(screen.getByLabelText('Select vehicle'), {
      target: { value: '2' },
    });

    expect(setVehicleIdMock).toHaveBeenCalledWith(2);
  });

  it('keeps the vehicle dropdown visible for a single-vehicle fleet', () => {
    const only = makeVehicle(7, { display_name: 'Solo' });
    installHooks({ vehicles: [only], selected: only });

    renderPage();

    expect(screen.getByLabelText('Select vehicle')).toHaveValue('7');
    expect(
      within(screen.getByLabelText('Select vehicle')).getByRole('option', {
        name: 'Solo',
      }),
    ).toBeInTheDocument();
  });

  it('navigates to command history from the header action', () => {
    const vehicle = makeVehicle(1);
    installHooks({ vehicles: [vehicle], selected: vehicle });

    renderPage();
    expect(screen.getByTestId('location')).toHaveTextContent('/commands');

    fireEvent.click(screen.getByRole('button', { name: 'View history' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/command-history',
    );
  });
});
