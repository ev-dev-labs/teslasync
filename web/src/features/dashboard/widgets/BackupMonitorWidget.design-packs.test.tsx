import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { BackupRun } from '@/types/admin';
import BackupMonitorWidget from './BackupMonitorWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

type BackupQuery = DataStateSource<BackupRun[] | null> & {
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
};

const { mockUseBackupRuns } = vi.hoisted(() => ({
  mockUseBackupRuns: vi.fn<() => BackupQuery>(),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useBackupRuns: mockUseBackupRuns,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (match, name: string) =>
        options && name in options ? String(options[name]) : match,
      ),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

function query(overrides: Partial<BackupQuery> = {}): BackupQuery {
  return {
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function run(overrides: Partial<BackupRun> = {}): BackupRun {
  return {
    id: 'run-latest',
    configId: 'config-1',
    status: 'completed',
    backupType: 'incremental',
    fileSize: 1536,
    durationMs: 4321,
    createdAt: '2024-05-06T12:00:00Z',
    completedAt: '2024-05-06T12:05:00Z',
    ...overrides,
  };
}

const SIZES: WidgetSize[] = [
  { cols: 1, rows: 2 },
  { cols: 2, rows: 2 },
  { cols: 4, rows: 2 },
];

function renderWidget(size: WidgetSize, packId: PackId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (selectedPack: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={selectedPack}>
          <BackupMonitorWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree('classic'));
  return {
    ...view,
    update: () => view.rerender(tree(packId)),
  };
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-status-appearance]')).toBeNull();
  } else {
    await waitFor(() => {
      expect(container.querySelector('[data-status-appearance]')).toHaveAttribute(
        'data-status-appearance',
        PACK_APPEARANCES[packId],
      );
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockUseBackupRuns.mockReturnValue(query());
});

describe.each(PACK_IDS)('BackupMonitorWidget pack %s', (packId) => {
  it.each(SIZES)('preserves content and formatting when switching packs at $cols columns', async (size) => {
    const statuses: BackupRun['status'][] = ['completed', 'failed', 'queued', 'running', 'completed', 'completed'];
    const runs = statuses.map((status, index) => run({
      id: `run-${index}`,
      status,
      backupType: index === 5 ? 'incremental' : 'full',
      fileSize: index === 5 ? 1536 : 1024 * (index + 1),
      durationMs: index === 5 ? 4321 : 1000 * (index + 1),
      completedAt: `2024-05-0${index + 1}T12:05:00Z`,
    }));
    const unsorted = [runs[1], runs[3], runs[0], runs[5], runs[4], runs[2]];
    const originalOrder = unsorted.map(item => item.id);
    const refetch = vi.fn();
    mockUseBackupRuns.mockReturnValue(query({ data: unsorted, refetch }));
    const view = renderWidget(size, packId);

    expect(screen.getByText('Last backup')).toBeInTheDocument();
    view.update();
    await expectPresentation(view.container, packId);

    expect(screen.getByRole('heading', { name: 'Backup monitor' })).toBeInTheDocument();
    expect(screen.getByText('Last backup').parentElement).toHaveTextContent(/\d/);
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    if (size.cols === 1) {
      expect(screen.getByRole('img', { name: 'Success' })).toBeInTheDocument();
      expect(screen.queryByText('Backup size')).not.toBeInTheDocument();
    } else {
      expect(screen.getByText('Backup size')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('incremental')).toBeInTheDocument();
      expect(screen.getAllByText('1.50 KB').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Success').length).toBeGreaterThan(0);
    }

    if (size.cols >= 4) {
      expect(screen.getByText('Recent runs')).toBeInTheDocument();
      const list = view.container.querySelector('dl');
      expect(list).not.toBeNull();
      const terms = list!.querySelectorAll('dt');
      expect(terms).toHaveLength(5);
      expect(list!.querySelectorAll('dd')).toHaveLength(5);
      expect(terms[0]).toHaveTextContent('1.50 KB');
      expect(terms[0]).toHaveTextContent('4.32s');
      expect(terms[4]).toHaveTextContent('2.00 KB');
      for (const status of ['Failed', 'Queued', 'Running']) {
        expect(within(list!).getByText(status)).toBeInTheDocument();
      }
      expect(screen.queryAllByRole('img')).toHaveLength(0);
      act(() => {
        setGlobalLocale('de-DE');
        setGlobalPrecision(1);
      });
      expect(screen.getAllByText('1,5 KB').length).toBeGreaterThan(0);
      expect(screen.getByText(/4,3s/)).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Recent runs')).not.toBeInTheDocument();
    }
    expect(unsorted.map(item => item.id)).toEqual(originalOrder);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each(SIZES)('preserves source trust, recovery and domain states at $cols columns', async (size) => {
    const refetch = vi.fn();
    mockUseBackupRuns.mockReturnValue(query({
      data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0, refetch,
    }));
    const view = renderWidget(size, packId);
    view.update();
    expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'Backup monitor' })).toBeInTheDocument();
    expect(screen.queryByText('Last backup')).not.toBeInTheDocument();
    expect(screen.queryByText('No backup data')).not.toBeInTheDocument();

    mockUseBackupRuns.mockReturnValue(query({
      data: undefined, error: new Error('offline'), isError: true, dataUpdatedAt: 0, refetch,
    }));
    view.update();
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No backup data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();

    for (const data of [null, []]) {
      mockUseBackupRuns.mockReturnValue(query({ data, refetch }));
      view.update();
      expect(screen.getByText('No backup data')).toBeInTheDocument();
      expect(screen.queryByText('Last backup')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }

    const zero = run({ fileSize: 0, durationMs: 0 });
    mockUseBackupRuns.mockReturnValue(query({ data: [zero], refetch }));
    view.update();
    await expectPresentation(view.container, packId);
    if (size.cols === 1) {
      expect(screen.getByRole('img', { name: 'Success' })).toBeInTheDocument();
    } else {
      expect(screen.getAllByText('0 B').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Success').length).toBeGreaterThan(0);
    }
    if (size.cols >= 4) expect(screen.getByText(/0 B · 0\.00ms/)).toBeInTheDocument();

    for (const state of [
      { isFetching: true },
      { isError: true, error: new Error('refresh failed') },
      { fetchStatus: 'paused' as const },
    ]) {
      mockUseBackupRuns.mockReturnValue(query({ data: [zero], refetch, ...state }));
      view.update();
      await expectPresentation(view.container, packId);
      expect(screen.getByText('Last backup')).toBeInTheDocument();
      expect(screen.queryByText('No backup data')).not.toBeInTheDocument();
      const shell = view.container.querySelector('[data-data-state]');
      expect(shell).toHaveAttribute('data-data-state', 'isFetching' in state ? 'ok' : 'stale');
      expect(shell).toHaveAttribute('aria-busy', String('isFetching' in state));
      if (!('isFetching' in state)) {
        expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      }
      if (size.cols !== 1) expect(screen.getAllByText('0 B').length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(2);

    for (const [status, label] of [
      ['running', 'Running'],
      ['queued', 'Queued'],
      ['failed', 'Failed'],
      ['completed', 'Success'],
    ] as const) {
      mockUseBackupRuns.mockReturnValue(query({ data: [run({ status, completedAt: null })], refetch }));
      view.update();
      await expectPresentation(view.container, packId);
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(screen.getByText('Last backup').parentElement).toHaveTextContent(/\d/);
      if (size.cols === 1) {
        expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
      } else {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      }
    }

    const unknown = {
      ...run(), status: undefined, fileSize: null, backupType: undefined,
      completedAt: 'invalid', createdAt: 'invalid', durationMs: Number.NaN,
    } as unknown as BackupRun;
    for (const fileSize of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      mockUseBackupRuns.mockReturnValue(query({ data: [{ ...unknown, fileSize } as BackupRun], refetch }));
      view.update();
      await expectPresentation(view.container, packId);
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(size.cols === 1 ? 1 : 3);
      expect(screen.queryByText('0 B')).not.toBeInTheDocument();
      expect(screen.queryByText('Failed')).not.toBeInTheDocument();
      expect(view.container).not.toHaveTextContent(/NaN|Infinity|Invalid Date|undefined/);
      if (size.cols === 1) expect(screen.getByRole('img', { name: '—' })).toBeInTheDocument();
    }
  });
});
