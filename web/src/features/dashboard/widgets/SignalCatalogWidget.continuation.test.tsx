import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(), observations: vi.fn(), retryCatalog: vi.fn(), retryObservations: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalCatalog: mocks.catalog,
  useSignalObservations: mocks.observations,
}));

import SignalCatalogWidget from './SignalCatalogWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
function mount() {
  return render(<MemoryRouter><SignalCatalogWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
}
const description = 'The complete specialist description stays readable without hover, including this long final detail.';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.mockReturnValue(query([
    { name: 'PackVoltageWithACompleteLongSignalIdentity', description, source_module: 'battery', unit: 'V' },
    { name: 'Speed', description: 'Measured speed', source_module: 'driving', unit: 'm/s' },
  ], mocks.retryCatalog));
  mocks.observations.mockReturnValue(query([], mocks.retryObservations));
});

describe('signal catalog independent observations and complete metadata', () => {
  it('preserves catalog identity and description while retrying only failed observations', () => {
    mocks.observations.mockReturnValue(query(undefined, mocks.retryObservations, new Error('sample failed')));
    mount();
    expect(screen.getByText('PackVoltageWithACompleteLongSignalIdentity')).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByText('Signal observations unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryObservations).toHaveBeenCalledTimes(1);
    expect(mocks.retryCatalog).not.toHaveBeenCalled();
  });

  it('keeps search semantics for descriptions and source modules', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'specialist' } });
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'driving' } });
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.queryByText(description)).not.toBeInTheDocument();
  });

  it('retains observation counts across a background failure', () => {
    mocks.observations.mockReturnValue(query([
      { signal_name: 'PackVoltageWithACompleteLongSignalIdentity' },
      { signal_name: 'PackVoltageWithACompleteLongSignalIdentity' },
    ], mocks.retryObservations, new Error('refresh failed')));
    mount();
    expect(screen.getByText('Previously loaded signal observations remain visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: 'span[title]' })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
  });
});
