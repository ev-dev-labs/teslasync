import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  vehicles: {
    data: [
      { id: 1, display_name: 'Falcon', vin: 'VIN1', state: 'unknown' },
      { id: 2, display_name: 'Roadrunner', vin: 'VIN2', state: 'unknown' },
    ],
    isPending: false,
    error: null as Error | null,
  },
  fleet: {
    data: [] as unknown[],
    summary: null,
    isPending: false,
    isError: false,
  },
  selectedId: 2,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const variables = (typeof fallback === 'object' ? fallback : options) ?? {};
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String((variables as Record<string, unknown>)[name] ?? `{{${name}}}`));
    },
  }),
}));
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: () => state.vehicles,
  useFleetStates: () => state.fleet,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.selectedId }),
}));

import FleetPostureWidget from './FleetPostureWidget';

afterEach(cleanup);

describe('FleetPostureWidget', () => {
  it('shows the shared trust-aware posture inside a widget, without investigation links', () => {
    const { container } = render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 4, rows: 7 }} />
      </MemoryRouter>,
    );

    const posture = within(container).getByTestId('fleet-operations-brief');
    expect(screen.getByText('Fleet posture')).toBeInTheDocument();
    expect(within(posture).getByText('Roadrunner')).toBeInTheDocument();
    expect(within(posture).getByTestId('fleet-posture-taxonomy')).toBeInTheDocument();
    expect(screen.queryByText('Recommended actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary workflows' })).not.toBeInTheDocument();
  });

  it('respects the dashboard vehicle scope over the header selection', () => {
    render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 4, rows: 7 }} vehicleId={1} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Falcon')).toBeInTheDocument();
    expect(screen.queryByText('Roadrunner')).not.toBeInTheDocument();
  });
});
