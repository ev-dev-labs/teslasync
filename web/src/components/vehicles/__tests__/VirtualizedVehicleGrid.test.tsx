import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [
      { index: 0, key: 'row-0', start: 0 },
      { index: 1, key: 'row-1', start: 290 },
    ],
    getTotalSize: () => 580,
    measureElement: vi.fn(),
    measure: vi.fn(),
  }),
}));

import {
  VirtualizedVehicleGrid,
  fleetGridColumnsForWidth,
} from '../VirtualizedVehicleGrid';
import type { Vehicle } from '@/types/vehicle';

describe('fleetGridColumnsForWidth', () => {
  it.each([
    [0, 1],
    [767, 1],
    [768, 2],
    [1535, 2],
    [1536, 3],
    [1919, 3],
    [1920, 4],
  ])('maps %ipx to %i responsive columns', (width, expected) => {
    expect(fleetGridColumnsForWidth(width)).toBe(expected);
  });
});

function vehicle(id: number): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN${id}`,
    display_name: `Vehicle ${id}`,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('VirtualizedVehicleGrid', () => {
  it('renders only measured rows and reports the prioritized vehicles', async () => {
    const onVisibleVehiclesChange = vi.fn();
    const vehicles = Array.from({ length: 30 }, (_, index) => vehicle(index + 1));

    render(
      <VirtualizedVehicleGrid
        vehicles={vehicles}
        label="Vehicle fleet"
        renderVehicle={(item) => <span>{item.display_name}</span>}
        onVisibleVehiclesChange={onVisibleVehiclesChange}
      />,
    );

    const list = screen.getByRole('list', { name: 'Vehicle fleet' });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Vehicle 1')).toBeInTheDocument();
    expect(screen.getByText('Vehicle 4')).toBeInTheDocument();
    expect(screen.queryByText('Vehicle 5')).not.toBeInTheDocument();
    expect(screen.getByText('Vehicle 4').parentElement).toHaveAttribute(
      'aria-setsize',
      '30',
    );

    await waitFor(() => {
      expect(onVisibleVehiclesChange).toHaveBeenCalled();
    });
    expect(
      onVisibleVehiclesChange.mock.calls.at(-1)?.[0].map(
        (item: Vehicle) => item.id,
      ),
    ).toEqual([1, 2, 3, 4]);
  });
});
