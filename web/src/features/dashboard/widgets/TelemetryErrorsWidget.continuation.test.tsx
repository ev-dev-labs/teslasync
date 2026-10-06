import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  vins: vi.fn(), errors: vi.fn(), retryVINs: vi.fn(), retryErrors: vi.fn(),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useFleetTelemetryErrorVINs: mocks.vins,
  useFleetTelemetryErrors: mocks.errors,
}));
vi.mock('@/components/data-display', async () => ({
  ...await vi.importActual<typeof import('@/components/data-display')>('@/components/data-display'),
  TimeStamp: ({ value }: { value: string | null; children?: ReactNode }) => <time dateTime={value ?? undefined}>{value ?? '—'}</time>,
}));

import TelemetryErrorsWidget from './TelemetryErrorsWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
function mount() {
  return render(<MemoryRouter><TelemetryErrorsWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
}
const vin = 'FULL-VEHICLE-IDENTIFIER-FOR-READABILITY';
const errorCode = 'CompleteSpecialistFailureCodeWithAnImportantFinalDetail';
const observed = '2026-10-05T10:00:00Z';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.vins.mockReturnValue(query([{ vin, active: true }], mocks.retryVINs));
  mocks.errors.mockReturnValue(query([
    { vin, error_code: errorCode, reported_at: observed },
    { vin, error_code: errorCode, reported_at: '2026-10-05T09:00:00Z' },
  ], mocks.retryErrors));
});

describe('telemetry errors preserve independent sources and full feed evidence', () => {
  it('keeps the VIN summary while retrying only the failed error sample', () => {
    mocks.errors.mockReturnValue(query(undefined, mocks.retryErrors, new Error('sample failed')));
    mount();
    expect(screen.getByText('Error VINs')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Telemetry error sample unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryErrors).toHaveBeenCalledTimes(1);
    expect(mocks.retryVINs).not.toHaveBeenCalled();
  });

  it('keeps complete identifiers, aggregation and observed clocks while only the VIN source fails', () => {
    mocks.vins.mockReturnValue(query(undefined, mocks.retryVINs, new Error('VIN summary failed')));
    mount();
    expect(screen.getByText(vin)).toBeInTheDocument();
    expect(screen.getByText(errorCode)).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText('Observed')).toBeInTheDocument();
    expect(screen.getByText(observed)).toHaveAttribute('datetime', observed);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryVINs).toHaveBeenCalledTimes(1);
    expect(mocks.retryErrors).not.toHaveBeenCalled();
  });

  it('does not turn fetched timestamps into recent observed events', () => {
    const fetched = new Date().toISOString();
    mocks.errors.mockReturnValue(query([{ vin, error_code: errorCode, fetched_at: fetched }], mocks.retryErrors));
    mount();
    expect(screen.getByText('Fetched')).toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    expect(screen.getByText(fetched)).toHaveAttribute('datetime', fetched);
  });

  it('keeps retained sample evidence after a refresh error', () => {
    mocks.errors.mockReturnValue(query([{ vin, error_code: errorCode, reported_at: observed }], mocks.retryErrors, new Error('refresh failed')));
    mount();
    expect(screen.getByText('Previously loaded telemetry error sample remains visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByText(errorCode)).toBeInTheDocument();
    expect(screen.getByText(observed)).toBeInTheDocument();
  });
});
