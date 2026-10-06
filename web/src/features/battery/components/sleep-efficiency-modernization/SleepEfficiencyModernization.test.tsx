import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { Button } from '@/components/ui';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber } from '@/lib/numberFormat';
import { MockResizeObserver } from '@/test/setup';
import SleepEfficiencyPage from '../../pages/SleepEfficiencyPage';
import { sleepEfficiencyFixture, sleepSectionIds } from './sleepEfficiency.fixture';

vi.mock('@/api/hooks/useEnergy', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useEnergy')>(),
  useSleepEfficiency: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSelectedVehicle')>(),
  useSelectedVehicle: vi.fn(),
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});

type SleepQuery = ReturnType<typeof useSleepEfficiency>;
const mockSleep = vi.mocked(useSleepEfficiency);
const mockVehicle = vi.mocked(useSelectedVehicle);
const retry = vi.fn();
const observers: MockResizeObserver[] = [];
class MeasuringObserver extends MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super(callback);
    observers.push(this);
  }
}
function query(overrides: Partial<SleepQuery> = {}): SleepQuery {
  return {
    data: sleepEfficiencyFixture(), isPending: false, isLoading: false,
    isFetching: false, isError: false, isSuccess: true, isStale: false,
    error: null, fetchStatus: 'idle', dataUpdatedAt: Date.now(), refetch: retry,
    ...overrides,
  } as SleepQuery;
}
function HeaderRangeControl() {
  const [, setParams] = useSearchParams();
  return (
    <Button onClick={() => setParams({ from: '2026-08-06', to: '2026-08-06' })}>
      Change header window
    </Button>
  );
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function PersistentProviders({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={['/sleep-efficiency?from=2026-08-04&to=2026-08-06']}>
        <QueryClientProvider client={client}>
          <ToastProvider>{children}<HeaderRangeControl /></ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }
  const result = render(<SleepEfficiencyPage />, { wrapper: PersistentProviders });
  return { ...result, refresh: () => result.rerender(<SleepEfficiencyPage />) };
}
function allShells() {
  for (const id of sleepSectionIds) expect(screen.getByTestId(id)).toBeInTheDocument();
}
beforeEach((): void => {
  vi.clearAllMocks();
  localStorage.clear();
  observers.length = 0;
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-07T12:00:00Z'));
  mockVehicle.mockReturnValue({ vehicleId: 1, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
  mockSleep.mockReturnValue(query());
});
afterEach((): void => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live Sleep Efficiency modernization (authored; execution NOTRUN)', () => {
  it('keeps all fourteen shells and seven specialist metric meanings', () => {
    mount();
    allShells();
    const evidence = screen.getByTestId('sleep-efficiency-kpi-evidence');
    expect(evidence.querySelectorAll('[data-stat]')).toHaveLength(7);
    const durationMetric = evidence.querySelector('[aria-label^="Duration-based sleep efficiency:"]');
    expect(durationMetric).toHaveTextContent('—');
    expect(durationMetric).toHaveTextContent('Unavailable pending dwell reconstruction');
    expect(within(evidence).getByText('Count-based; not a time share', { selector: '[data-stat-context]' })).toBeInTheDocument();
    expect(within(evidence).getByText('Placeholder zero withheld', { selector: '[data-stat-context]' })).toBeInTheDocument();
    expect(within(evidence).getByText('Source support score; not confidence', { selector: '[data-stat-context]' })).toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(3);
  });

  it('preserves original operands while consuming persistent real-router header changes', () => {
    const view = mount();
    expect(mockSleep).toHaveBeenLastCalledWith('1', 3, '2026-08-04', '2026-08-06');
    fireEvent.click(screen.getByRole('button', { name: 'Change header window' }));
    expect(mockSleep).toHaveBeenLastCalledWith('1', 1, '2026-08-06', '2026-08-06');
    view.refresh();
    expect(mockSleep).toHaveBeenLastCalledWith('1', 1, '2026-08-06', '2026-08-06');
    expect(screen.queryByRole('combobox', { name: /vehicle|range/i })).not.toBeInTheDocument();
  });

  it('retains rows and every neighbor on refresh failure and retries only the sleep source', () => {
    const view = mount();
    mockSleep.mockReturnValue(query({ isError: true, isSuccess: false, error: new Error('refresh transport detail') }));
    view.refresh();
    allShells();
    expect(screen.queryByTestId('sleep-query-initial-error')).not.toBeInTheDocument();
    const warning = screen.getByTestId('sleep-refresh-error');
    expect(warning).toHaveTextContent('Showing the most recently loaded response');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('sleep-efficiency-event-directory')).getByText('Outside temperature')).toBeInTheDocument();
  });

  it('keeps retained evidence when paused and never confuses first-load pause with measured zero', () => {
    const view = mount();
    mockSleep.mockReturnValue(query({ fetchStatus: 'paused' }));
    view.refresh();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('offline');
    allShells();
    mockSleep.mockReturnValue(query({ data: undefined, fetchStatus: 'paused', isPending: true, isSuccess: false }));
    view.refresh();
    expect(screen.getByTestId('sleep-initial-paused')).toHaveTextContent('No drain or sleep-health conclusion');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    allShells();
  });

  it('renders initial failure using the shared friendly error, with all source shells and retry', () => {
    mockSleep.mockReturnValue(query({
      data: undefined, isError: true, isSuccess: false, error: new Error('raw transport detail'),
    }));
    mount();
    allShells();
    const failure = screen.getByTestId('sleep-query-initial-error');
    expect(failure).toHaveTextContent("Can't reach server");
    expect(failure).not.toHaveTextContent('raw transport detail');
    fireEvent.click(within(failure).getByRole('button', { name: /retry|try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps complete mobile details and formatted SI temperature in the shared table pipeline', () => {
    vi.stubGlobal('ResizeObserver', MeasuringObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 600, x: 0, y: 0, top: 0, left: 0, right: 375, bottom: 600,
      toJSON: () => ({}),
    });
    mount();
    act(() => {
      for (const observer of observers) for (const target of observer.observed) observer.trigger(target);
    });
    const directory = screen.getByTestId('sleep-efficiency-event-directory');
    fireEvent.click(within(directory).getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    for (const label of ['Start', 'End', 'Duration', 'Battery start → end', 'Battery lost', 'Drain rate', 'Sentry', 'Outside temperature']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('20.00°C')).toBeInTheDocument();
    expect(within(dialog).getByText(`${fmtNumber(0.5)}%/hr`)).toBeInTheDocument();
    const footer = dialog.querySelector<HTMLElement>('[data-modal-footer]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer!).getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
