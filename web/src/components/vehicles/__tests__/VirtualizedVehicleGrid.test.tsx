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
    expect(list).toHaveClass('pe-1', 'overflow-y-auto');
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
      onVisibleVehiclesChange.mock.calls[
        onVisibleVehiclesChange.mock.calls.length - 1
      ]?.[0].map(
        (item: Vehicle) => item.id,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it('keeps caller content, native links, sizing and logical row placement', () => {
    const item: Vehicle = {
      ...vehicle(0),
      display_name: 'Long vehicle name '.repeat(20),
      battery_level: 0,
    };
    const renderVehicle = vi.fn((entry: Vehicle) => (
      <a href={`/vehicles/${entry.id}`}>{entry.display_name}</a>
    ));

    render(
      <VirtualizedVehicleGrid
        vehicles={[item]}
        label="Registered fleet"
        className="custom-fleet"
        renderVehicle={renderVehicle}
      />,
    );

    const list = screen.getByRole('list', { name: 'Registered fleet' });
    expect(list).toHaveClass('custom-fleet', 'h-vehicle-grid', 'min-h-vehicle-grid');
    expect(list.firstElementChild).toHaveStyle({ height: '580px' });
    const link = screen.getByRole('link', { name: item.display_name.trim() });
    expect(link).toHaveAttribute('href', '/vehicles/0');
    expect(link.parentElement).toHaveAttribute('aria-posinset', '1');
    expect(link.parentElement?.parentElement).toHaveClass('start-0');
    expect(renderVehicle).toHaveBeenCalledWith(item);
    link.focus();
    expect(link).toHaveFocus();
    expect(item.battery_level).toBe(0);
  });

  it('reports an empty source without fabricating vehicles or content', async () => {
    const onVisibleVehiclesChange = vi.fn();
    const renderVehicle = vi.fn((entry: Vehicle) => <span>{entry.display_name}</span>);

    render(
      <VirtualizedVehicleGrid
        vehicles={[]}
        label="Empty fleet"
        renderVehicle={renderVehicle}
        onVisibleVehiclesChange={onVisibleVehiclesChange}
      />,
    );

    expect(screen.getByRole('list', { name: 'Empty fleet' })).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(renderVehicle).not.toHaveBeenCalled();
    await waitFor(() => expect(onVisibleVehiclesChange).toHaveBeenCalledWith([]));
  });

  it.each([
    ['h-96 min-h-0', ['h-96', 'min-h-0']],
    ['h-[640px] min-h-[320px]', ['h-[640px]', 'min-h-[320px]']],
  ])('preserves caller sizing overrides: %s', (className, expected) => {
    render(
      <VirtualizedVehicleGrid
        vehicles={[]}
        label="Sized fleet"
        className={className}
        renderVehicle={(entry) => <span>{entry.display_name}</span>}
      />,
    );

    const list = screen.getByRole('list', { name: 'Sized fleet' });
    expect(list).toHaveClass(...expected);
    expect(list).not.toHaveClass('h-vehicle-grid');
    expect(list).not.toHaveClass('min-h-vehicle-grid');
    expect(list).toHaveClass('overflow-y-auto', 'overscroll-contain', 'pe-1');
  });
});
