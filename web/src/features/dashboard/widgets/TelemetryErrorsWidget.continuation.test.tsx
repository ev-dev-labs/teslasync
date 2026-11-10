import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FleetTelemetryError, FleetTelemetryErrorVIN } from '@/api/hooks/useTelemetry';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

interface QueryResult<T> {
  data: T | null | undefined;
  refetch: () => void;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

const mocks = vi.hoisted(() => ({
  vins: vi.fn<() => QueryResult<FleetTelemetryErrorVIN[]>>(),
  errors: vi.fn<() => QueryResult<FleetTelemetryError[]>>(),
  retryVINs: vi.fn(), retryErrors: vi.fn(),
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

function query<T>(
  data: T,
  refetch: () => void,
  error: Error | null = null,
  overrides: Partial<QueryResult<T>> = {},
): QueryResult<T> {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0, ...overrides };
}
function surface(packId: PackId, size: WidgetSize = { cols: 2, rows: 2 }) {
  return <MemoryRouter><PackBoundary requestedPackId={packId}>
    <TelemetryErrorsWidget size={size} />
  </PackBoundary></MemoryRouter>;
}
function mount(packId: PackId, size?: WidgetSize) {
  return render(surface(packId, size));
}
async function expectTimeline(container: HTMLElement, packId: PackId) {
  if (packId === 'classic') {
    expect(container.querySelector('[data-timeline-appearance]')).not.toBeInTheDocument();
  } else {
    await waitFor(() => {
      expect(container.querySelector(`[data-timeline-appearance="${PACK_APPEARANCES[packId]}"]`)).toBeInTheDocument();
    });
  }
}
const vin = 'FULL-VEHICLE-IDENTIFIER-FOR-READABILITY';
const errorCode = 'CompleteSpecialistFailureCodeWithAnImportantFinalDetail';
const observed = '2026-10-05T10:00:00Z';
const summary: FleetTelemetryErrorVIN = {
  id: 1, vin, active: true, first_seen_at: observed, last_seen_at: observed, resolved_at: null,
};
function errorEntry(overrides: Partial<FleetTelemetryError> = {}): FleetTelemetryError {
  return { id: 1, vin, error_code: errorCode, error_message: null, reported_at: observed, tesla_updated_at: null, fetched_at: observed, ...overrides };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.vins.mockReturnValue(query([summary], mocks.retryVINs));
  mocks.errors.mockReturnValue(query([
    errorEntry(),
    errorEntry({ id: 2, reported_at: '2026-10-05T09:00:00Z' }),
  ], mocks.retryErrors));
});

describe.each(PACK_IDS)('telemetry errors preserve independent sources and full feed evidence [%s]', (packId) => {
  it('keeps the VIN summary while retrying only the failed error sample', () => {
    mocks.errors.mockReturnValue(query(undefined, mocks.retryErrors, new Error('sample failed')));
    mount(packId);
    expect(screen.getByText('error VINs')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Telemetry error sample unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryErrors).toHaveBeenCalledTimes(1);
    expect(mocks.retryVINs).not.toHaveBeenCalled();
  });

  it('keeps complete identifiers, aggregation and observed clocks while only the VIN source fails', async () => {
    mocks.vins.mockReturnValue(query(undefined, mocks.retryVINs, new Error('VIN summary failed')));
    const { container } = mount(packId);
    await expectTimeline(container, packId);
    expect(screen.getByText(vin)).toBeInTheDocument();
    expect(screen.getByText(errorCode)).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText('2 · Errors in fetched sample')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getByText('Observed')).toBeInTheDocument();
    expect(screen.getByText(observed)).toHaveAttribute('datetime', observed);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryVINs).toHaveBeenCalledTimes(1);
    expect(mocks.retryErrors).not.toHaveBeenCalled();
  });

  it('does not turn fetched timestamps into recent observed events', () => {
    const fetched = new Date().toISOString();
    mocks.errors.mockReturnValue(query([errorEntry({ reported_at: null, fetched_at: fetched })], mocks.retryErrors));
    mount(packId);
    expect(screen.getByText('Fetched')).toBeInTheDocument();
    expect(screen.queryByText(/^recent$/i)).not.toBeInTheDocument();
    expect(screen.getByText(fetched)).toHaveAttribute('datetime', fetched);
  });

  it('keeps retained sample evidence after a refresh error', () => {
    mocks.errors.mockReturnValue(query([errorEntry()], mocks.retryErrors, new Error('refresh failed')));
    const { container } = mount(packId);
    expect(screen.getByText('Previously loaded telemetry error sample remains visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByText(errorCode)).toBeInTheDocument();
    expect(screen.getByText(observed)).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it('uses the shared compact timeline for a real zero and refreshes both sources', async () => {
    mocks.vins.mockReturnValue(query([{ ...summary, active: false }], mocks.retryVINs));
    mocks.errors.mockReturnValue(query([], mocks.retryErrors));
    const { container } = mount(packId, { cols: 1, rows: 2 });
    await expectTimeline(container, packId);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('0 · Errors in fetched sample')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.retryVINs).toHaveBeenCalledTimes(1);
    expect(mocks.retryErrors).toHaveBeenCalledTimes(1);
  });

  it('does not replace an unknown compact VIN count with zero or healthy', async () => {
    mocks.vins.mockReturnValue(query(null, mocks.retryVINs));
    const { container } = mount(packId, { cols: 1, rows: 2 });
    await expectTimeline(container, packId);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getByText('2 · Errors in fetched sample')).toBeInTheDocument();
  });

  it('keeps the compact VIN count loading even when the error sample has resolved', () => {
    mocks.vins.mockReturnValue(query(undefined, mocks.retryVINs, null, { isLoading: true }));
    const { container } = mount(packId, { cols: 1, rows: 2 });
    expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('No telemetry error data')).not.toBeInTheDocument();
  });

  it('retains the VIN summary while the independent feed is still loading', () => {
    mocks.errors.mockReturnValue(query(undefined, mocks.retryErrors, null, { isLoading: true }));
    const { container } = mount(packId);
    expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading Errors in fetched sample' })).toBeInTheDocument();
  });

  it('distinguishes a successful empty sample from a fatal source failure', () => {
    mocks.vins.mockReturnValue(query([], mocks.retryVINs));
    mocks.errors.mockReturnValue(query([], mocks.retryErrors));
    const { rerender } = mount(packId);
    expect(screen.getByText('No errors recorded')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('0 · Errors in fetched sample')).toBeInTheDocument();

    mocks.vins.mockReturnValue(query(undefined, mocks.retryVINs, new Error('VINs failed')));
    mocks.errors.mockReturnValue(query(undefined, mocks.retryErrors, new Error('sample failed')));
    rerender(surface(packId));
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('No errors recorded')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryVINs).toHaveBeenCalledTimes(1);
    expect(mocks.retryErrors).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid clocks unknown and reserves recent status for reported observations', () => {
    const fetched = new Date().toISOString();
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    mocks.errors.mockReturnValue(query([
      errorEntry({ error_code: 'FETCHED_ONLY', reported_at: 'invalid-report', fetched_at: fetched }),
      errorEntry({ id: 2, error_code: null, reported_at: 'invalid-report', fetched_at: 'invalid-fetch' }),
      errorEntry({ id: 3, error_code: 'OBSERVED_RECENTLY', reported_at: recent }),
    ], mocks.retryErrors));
    const { container } = mount(packId);
    expect(screen.getAllByText('Fetched')).toHaveLength(2);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('—')).not.toHaveAttribute('datetime');
    expect(screen.getByText(fetched)).toHaveAttribute('datetime', fetched);
    expect(screen.getByText(recent)).toHaveAttribute('datetime', recent);
    expect(screen.getAllByText(/^recent$/i)).toHaveLength(1);
    expect(container.textContent).not.toContain('invalid-report');
    expect(container.textContent).not.toContain('invalid-fetch');
    expect(container.textContent!.indexOf('FETCHED_ONLY')).toBeLessThan(container.textContent!.indexOf('OBSERVED_RECENTLY'));
    expect(container.textContent!.indexOf('OBSERVED_RECENTLY')).toBeLessThan(container.textContent!.indexOf('Unknown'));
  });
});

it('preserves the mounted error feed and source controls while switching every pack', () => {
  const { container, rerender } = mount('classic');
  const identifier = screen.getByText(vin);
  for (const packId of PACK_IDS) {
    rerender(surface(packId));
    expect(screen.getByText(vin)).toBe(identifier);
    expect(screen.getByText(errorCode)).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText(observed)).toHaveAttribute('datetime', observed);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(mocks.retryVINs).not.toHaveBeenCalled();
    expect(mocks.retryErrors).not.toHaveBeenCalled();
  }
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.retryVINs).toHaveBeenCalledTimes(1);
  expect(mocks.retryErrors).toHaveBeenCalledTimes(1);
});
