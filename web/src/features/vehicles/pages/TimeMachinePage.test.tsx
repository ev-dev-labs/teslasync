import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeMachineField, TimeMachineRange, TimeMachineState } from '@/api/hooks/useTimeMachine';

const h = vi.hoisted(() => ({
  vehicleId: 7,
  range: null as TimeMachineRange | null,
  reconstruction: undefined as TimeMachineState | undefined,
  error: null as Error | null,
  refetch: vi.fn(),
  readState: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { id: h.vehicleId, display_name: 'Pool car' } }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: h.vehicleId }], isLoading: false }),
}));
vi.mock('@/api/hooks/useTimeMachine', () => ({
  useTimeMachineRange: () => ({
    data: h.range, isLoading: false, isError: false, error: null,
    isFetching: false, dataUpdatedAt: 1, refetch: h.refetch,
  }),
  useTimeMachineState: (vehicleId: number | null, at: string | null) => {
    h.readState(vehicleId, at);
    return {
      data: h.reconstruction, isLoading: false, isError: h.error != null, error: h.error,
      isFetching: false, dataUpdatedAt: 1, refetch: h.refetch,
    };
  },
}));

import TimeMachinePage, { ageVariant, categorize, groupByCategory } from './TimeMachinePage';

const earliest = '2026-10-01T00:00:00.000Z';
const latest = '2026-10-02T00:00:00.000Z';
const fields: TimeMachineField[] = [
  { field: 'TpmsPressure', value: 0, value_kind: 'float', ts: latest, age_seconds: 119 },
  { field: 'BatteryLevel', value: null, value_kind: 'float', ts: earliest, age_seconds: 3600 },
  { field: 'DoorLock', value: false, value_kind: 'bool', ts: latest, age_seconds: 120 },
  { field: 'UnclassifiedSignal', value: 'raw value', value_kind: 'string', ts: latest, age_seconds: 1 },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/time-machine']}><TimeMachinePage /></MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.range = { earliest, latest, field_count: 4 };
  h.reconstruction = { at: latest, count: 4, fields };
  h.error = null;
});

describe('TimeMachinePage preservation', () => {
  it('keeps all six categories, every raw field and unknown distinct from real zero', async () => {
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    for (const category of ['battery', 'climate', 'motion', 'tires', 'security', 'other']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
    expect(screen.getByText('UnclassifiedSignal')).toBeInTheDocument();
    expect(screen.getByText('raw value')).toBeInTheDocument();
    const zero = screen.getByText('TpmsPressure').closest('li');
    const unknown = screen.getByText('BatteryLevel').closest('li');
    if (!zero || !unknown) throw new Error('Reconstructed rows missing');
    expect(within(zero).queryByText('—')).not.toBeInTheDocument();
    expect(within(unknown).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('keeps historical rows and bounds while a reconstruction refresh fails', async () => {
    h.error = new Error('refresh failed');
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    expect(screen.getByText('raw value')).toBeInTheDocument();
    expect(screen.getByText('Reconstructed signal state may be out of date')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('clamps presets to bounds and resets reconstruction scope when the vehicle changes', async () => {
    const view = renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    fireEvent.click(screen.getByRole('button', { name: '−1w' }));
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, earliest));
    h.vehicleId = 8;
    view.rerender(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/time-machine']}><TimeMachinePage /></MemoryRouter>
    </QueryClientProvider>);
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(8, latest));
    expect(h.readState.mock.calls.some(([vehicleId, at]) => vehicleId === 8 && at === null)).toBe(true);
  });

  it('retains category shells and retry controls on initial reconstruction failure', async () => {
    h.reconstruction = undefined;
    h.error = new Error('initial failure');
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Signal reconstruction could not be loaded.')).toHaveLength(6));
    const count = screen.getByText('Signals reconstructed').closest('[data-stat]');
    if (!(count instanceof HTMLElement)) throw new Error('Reconstruction summary missing');
    expect(within(count).getByText('—')).toBeInTheDocument();
    expect(within(count).queryByText('0')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(6);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a real empty reconstruction as zero without removing any category shell', async () => {
    h.reconstruction = { at: latest, count: 0, fields: [] };
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    const count = screen.getByText('Signals reconstructed').closest('[data-stat]');
    if (!(count instanceof HTMLElement)) throw new Error('Reconstruction summary missing');
    expect(within(count).getByText('0')).toBeInTheDocument();
    for (const category of ['battery', 'climate', 'motion', 'tires', 'security', 'other']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
  });

  it('keeps first-match classification, source field order and exact age boundaries', () => {
    expect(categorize('TpmsBatteryVoltage')).toBe('tires');
    const grouped = groupByCategory(fields);
    expect(Object.values(grouped).flat()).toHaveLength(fields.length);
    expect(grouped.battery[0].field).toBe('BatteryLevel');
    expect(ageVariant(119)).toBe('success');
    expect(ageVariant(120)).toBe('warning');
    expect(ageVariant(3599)).toBe('warning');
    expect(ageVariant(3600)).toBe('danger');
  });
});
