import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PACK_APPEARANCES, type PackId } from '../types';

const mocks = vi.hoisted(() => ({
  pack: vi.fn<() => PackId>(() => 'classic'), tires: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../PackBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('../PackBoundary')>(), usePackPresentation: mocks.pack,
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 42 }] }), useLatestTirePressure: mocks.tires,
}));
vi.mock('../../vehicle-instruments/VehicleStudio', () => ({
  default: ({ vehicle }: { vehicle: { id: number } }) => <div role="img" aria-label={`Vehicle ${vehicle.id}`} />,
}));
import TirePressureVisualWidget from '../../TirePressureVisualWidget';

function query<T>(data: T, error: Error | null = null) {
  return { data, error, isError: error != null, isLoading: false, isFetching: false,
    isStale: false, dataUpdatedAt: Date.now(), refetch: mocks.refresh };
}
const readings = { front_left: 250_000, front_right: 240_000, rear_left: 0, rear_right: null };
function mount() {
  return render(<MemoryRouter><TirePressureVisualWidget vehicleId={42} size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tires.mockReturnValue(query(readings));
});

describe.each(Object.entries(PACK_APPEARANCES))('tire pressure %s', (id, appearance) => {
  it('keeps the correct vehicle and all four independent SI-derived readings', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`[data-tire-appearance="${appearance}"]`)).not.toBeNull());
    const root = container.querySelector(`[data-tire-appearance="${appearance}"]`) as HTMLElement;
    expect(root).not.toBeNull();
    const view = within(root);
    expect(view.getByRole('img', { name: 'Vehicle 42' })).toBeInTheDocument();
    expect(view.getByRole('group', { name: 'FL' })).toHaveTextContent('2.50');
    expect(view.getByRole('group', { name: 'FR' })).toHaveTextContent('2.40');
    expect(view.getByRole('group', { name: 'RL' })).toHaveTextContent('0.00');
    expect(view.getByRole('group', { name: 'RR' })).toHaveTextContent('—');
    expect(view.getByText('Check pressure')).toBeInTheDocument();
    expect(mocks.tires).toHaveBeenCalledWith(42, 10_000);
    expect(root.querySelectorAll('[data-pressure-status="neutral"]')).toHaveLength(1);
  });

  it('never reports all-normal when every wheel is unknown', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    mocks.tires.mockReturnValue(query({ front_left: null, front_right: null, rear_left: null, rear_right: null }));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`[data-tire-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('All normal')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getAllByRole('group').filter(group => ['FL', 'FR', 'RL', 'RR'].includes(group.getAttribute('aria-label') ?? ''))).toHaveLength(4);
  });
});

it('retains the wheel readings on refresh failure and retries the same source', async () => {
  mocks.pack.mockReturnValue('v4');
  mocks.tires.mockReturnValue(query(readings, new Error('refresh failed')));
  mount();
  await screen.findByText('2.50');
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
