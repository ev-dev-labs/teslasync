import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PACK_APPEARANCES, type PackId } from '../types';

const mocks = vi.hoisted(() => ({
  pack: vi.fn<() => PackId>(() => 'classic'), climate: vi.fn(),
}));
vi.mock('../PackBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('../PackBoundary')>(), usePackPresentation: mocks.pack,
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 42 }] }), useClimateLatest: mocks.climate,
}));
import ClimateStatusWidget from '../../ClimateStatusWidget';

function query<T>(data: T, error: Error | null = null) {
  return { data, error, isError: error != null, isLoading: false, isFetching: false,
    isStale: false, dataUpdatedAt: Date.now(), refetch: vi.fn() };
}
const readings = { inside_temp_c: 0, outside_temp_c: -10, driver_setpoint_c: 22, hvac_power: true };
function mount() {
  return render(<MemoryRouter><ClimateStatusWidget vehicleId={42} size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.climate.mockReturnValue(query({ ...readings, ts: new Date().toISOString() }));
});

describe.each(Object.entries(PACK_APPEARANCES))('climate %s', (id, appearance) => {
  it('distinguishes actual temperature, outside temperature and the reported target', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    const { container } = mount();
    await screen.findByText('set 22°C');
    const root = container.querySelector(`[data-climate-appearance="${appearance}"]`);
    expect(root).not.toBeNull();
    expect(root).toHaveTextContent('0°C');
    expect(root).toHaveTextContent('Outside -10°C');
    expect(root).toHaveTextContent('HVAC on');
    expect(root?.querySelector('[data-climate-airflow="active"]')).not.toBeNull();
    expect(mocks.climate).toHaveBeenCalledWith(42, 5_000);
  });

  it('keeps unavailable fields independent and stops implying activity during refresh failure', async () => {
    mocks.pack.mockReturnValue(id as PackId);
    mocks.climate.mockReturnValue(query({
      inside_temp_c: null, outside_temp_c: -10, driver_setpoint_c: null, hvac_power: null,
      ts: new Date().toISOString(),
    }, new Error('refresh failed')));
    const { container } = mount();
    expect(await screen.findByText('set —')).toBeInTheDocument();
    expect(screen.getByText('HVAC unknown')).toBeInTheDocument();
    expect(screen.getByText('Outside -10°C')).toBeInTheDocument();
    expect(container.querySelector('[data-climate-airflow="static"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
