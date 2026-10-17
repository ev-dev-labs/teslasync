import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import MaintenanceTrackerWidget from './MaintenanceTrackerWidget';

const hooks = vi.hoisted(() => ({ items: vi.fn(), records: vi.fn(), forecast: vi.fn() }));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useMaintenance: () => hooks.items(),
  useServiceRecords: () => hooks.records(),
  useMaintenanceForecast: () => hooks.forecast(),
}));

const items = [
  { id: 'long', name: 'Long interval', category: 'fluids', intervalMonths: 24, intervalKm: 40000, estimatedCostUsd: 120 },
  { id: 'short', name: 'Full shortest-interval service name', category: 'tires', intervalMonths: 6, intervalKm: 10000, estimatedCostUsd: 25 },
];
const records = Array.from({ length: 4 }, (_, index) => ({
  itemId: 'short',
  date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  odometerKm: 10000 + index,
  notes: `Complete service note ${index}`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.items.mockReturnValue(queryResult(items));
  hooks.records.mockReturnValue(queryResult(records));
  hooks.forecast.mockReturnValue(queryResult({
    vehicle_id: 7, overdue_count: 0, due_soon_count: 0, km_per_day: 0,
    items: [{ name: items[1].name, category: 'tires', status: 'good' }],
  }));
});

describe('maintenance independent source preservation', () => {
  it('keeps forecast zero counts and signed distance pace separate from configured intervals and service records', () => {
    hooks.forecast.mockReturnValue(queryResult({
      vehicle_id: 7, overdue_count: 0, due_soon_count: 0, km_per_day: -2.5,
      items: [],
    }));
    renderWidget(<MaintenanceTrackerWidget size={{ cols: 2, rows: 4 }} />);
    const brief = screen.getByTestId('dashboard-maintenance-forecast-brief');
    expect(brief).toHaveTextContent('Maintenance forecast summary');
    expect(brief).toHaveTextContent('Forecast vehicle 7');
    expect(brief).toHaveTextContent('-2.50 km/day');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(3);
    const configuredInterval = screen.getByRole('heading', { name: 'Shortest configured interval' }).parentElement?.parentElement;
    if (!configuredInterval) throw new Error('Configured interval section is missing');
    expect(within(configuredInterval).getByText(items[1].name)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Recent service' })).toBeVisible();
  });

  it('keeps the source-sorted three newest records and notes when configured intervals fail', () => {
    const retryItems = vi.fn();
    const retryRecords = vi.fn();
    hooks.items.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Intervals offline'), refetch: retryItems }));
    hooks.records.mockReturnValue(queryResult(records, { refetch: retryRecords }));
    renderWidget(<MaintenanceTrackerWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText('Configured maintenance could not be loaded.')).toBeVisible();
    const list = screen.getByRole('list', { name: 'Recent service' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Complete service note 3');
    expect(rows[2]).toHaveTextContent('Complete service note 1');
    expect(screen.queryByText(/Complete service note 0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryItems).toHaveBeenCalledOnce();
    expect(retryRecords).not.toHaveBeenCalled();
    expect(records.map(record => record.notes)).toEqual(['Complete service note 0', 'Complete service note 1', 'Complete service note 2', 'Complete service note 3']);
  });

  it('keeps configured intervals, forecast counts and caveats when records fail', () => {
    const retry = vi.fn();
    hooks.records.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Records offline'), refetch: retry }));
    renderWidget(<MaintenanceTrackerWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText(items[1].name)).toBeVisible();
    expect(screen.getByText('Service records could not be loaded.')).toBeVisible();
    expect(screen.getByText('Intervals are recommendations, not time remaining.')).toBeVisible();
    expect(screen.getByText('Forecast depends on recorded service history and mileage.')).toBeVisible();
    expect(screen.getByText('Daily distance')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps configured interval semantics rather than presenting six months as a countdown', () => {
    renderWidget(<MaintenanceTrackerWidget size={{ cols: 1, rows: 2 }} />);
    expect(screen.getByText('Configured interval')).toBeVisible();
    expect(screen.getByText(items[1].name)).toBeVisible();
    expect(screen.getByText('Intervals are recommendations, not time remaining.')).toBeVisible();
    expect(screen.queryByText(/days remaining|months remaining/i)).not.toBeInTheDocument();
    expect(items.map(item => item.id)).toEqual(['long', 'short']);
  });
});
