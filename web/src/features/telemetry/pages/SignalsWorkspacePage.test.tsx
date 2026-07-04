/**
 * SignalsWorkspacePage — behavioural contract tests.
 *
 * The workspace is a thin orchestrator over seven shared telemetry
 * components plus a live-SSE hook. These tests replace those heavy leaves
 * with prop-echoing stubs and mock the data hooks (`useSignals`,
 * `useSignalDiffServer`, `usePinned`, `useTogglePin`, `useLiveSignalStream`)
 * and the vehicle context so every branch of the page's OWN logic can be
 * driven deterministically without a network:
 *
 *   - the "select a vehicle" empty state,
 *   - the KPI headline strip (Selected / Mode / Live rate / Pinned),
 *   - the three mutually-exclusive modes (Historical / Live / Compare) and
 *     the toggle wiring that keeps Live and Compare exclusive,
 *   - compare-mode loading vs. populated diff rows,
 *   - the top error banner.
 *
 * URL-backed state (`useUrlArray`, `useRangeState`, `useSavedViewUrl`) uses
 * the REAL hooks under a MemoryRouter, so the selected-signals count and
 * mode wiring are exercised end-to-end. `react-i18next` is stubbed to echo
 * each key's English fallback so copy assertions stay stable; the global
 * test-setup already stubs `useSettings` and `useTimezone`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Hoisted mutable state each factory reads. Tests mutate these fields in
// beforeEach / per-case to drive the page through its branches.
const h = vi.hoisted(() => ({
  vehicle: {
    vehicleId: 1 as number,
    vehicle: null as unknown,
    vehicles: [] as Array<{ id: number; vin: string; display_name: string }>,
    setVehicleId: vi.fn(),
  },
  signals: { data: undefined as string[] | undefined, error: null as unknown },
  diff: {
    data: undefined as { data: Array<Record<string, unknown>> } | undefined,
    isLoading: false,
    error: null as unknown,
  },
  pinned: { data: [] as Array<{ item_id: string }> },
  live: {
    connected: false,
    chartData: [] as Array<Record<string, unknown>>,
    chartStats: [] as unknown[],
    chartPointCount: 0,
    tailEntries: [] as unknown[],
    tailRate: 0,
    tailPaused: false,
    setTailPaused: vi.fn(),
    clearTail: vi.fn(),
    resetChart: vi.fn(),
  },
  togglePin: { mutateAsync: vi.fn() },
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => h.vehicle,
}));

vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
    '@/api/hooks/useTelemetry',
  );
  return { ...actual, useSignals: () => h.signals, useSignalDiffServer: () => h.diff };
});

vi.mock('@/api/hooks/usePinned', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/usePinned')>(
    '@/api/hooks/usePinned',
  );
  return { ...actual, usePinned: () => h.pinned, useTogglePin: () => h.togglePin };
});

vi.mock('../hooks/useLiveSignalStream', () => ({
  useLiveSignalStream: () => h.live,
}));

// Keep StatCard / BulkActionsToolbar real; stub only the network-backed
// SavedViewMenu so no saved-views query fires during a bare render.
vi.mock('@/components/data-display', async () => {
  const actual = await vi.importActual<typeof import('@/components/data-display')>(
    '@/components/data-display',
  );
  return { ...actual, SavedViewMenu: () => null };
});

// Heavy leaf telemetry components → prop-echoing stubs so the page's
// orchestration (which mode is active, what props flow down) is observable.
vi.mock('../components/SignalCategoryTree', () => ({
  SignalCategoryTree: (props: { selectedSignals?: string[] }) => (
    <div data-testid="category-tree" data-count={String((props.selectedSignals ?? []).length)} />
  ),
}));
vi.mock('../components/SignalChartPanel', () => ({
  SignalChartPanel: (props: { isLive?: boolean; selectedSignals?: string[] }) => (
    <div
      data-testid="chart-panel"
      data-live={String(Boolean(props.isLive))}
      data-signals={(props.selectedSignals ?? []).join(',')}
    />
  ),
}));
vi.mock('../components/SignalStatsPanel', () => ({
  SignalStatsPanel: () => <div data-testid="stats-panel" />,
}));
vi.mock('../components/SignalHistoryTable', () => ({
  SignalHistoryTable: (props: { totalRows?: number }) => (
    <div data-testid="history-table" data-total={String(props.totalRows ?? 0)} />
  ),
}));
vi.mock('../components/LiveSignalTail', () => ({
  LiveSignalTail: (props: { rate?: number }) => (
    <div data-testid="live-tail" data-rate={String(props.rate ?? 0)} />
  ),
}));
vi.mock('../components/SignalDiffTable', () => ({
  SignalDiffTable: (props: { rows?: unknown[] }) => (
    <div data-testid="diff-table" data-rows={String((props.rows ?? []).length)} />
  ),
}));
// Preserve the util exports the page imports alongside the component
// (CATEGORY_PREFIXES / isoOrEmpty / toLocalDatetimeInput).
vi.mock('../components/SignalCompareControls', async () => {
  const actual = await vi.importActual<typeof import('../components/SignalCompareControls')>(
    '../components/SignalCompareControls',
  );
  return { ...actual, SignalCompareControls: () => <div data-testid="compare-controls" /> };
});

import { __resetTitleStoreForTests } from '@/lib/titleStore';
import SignalsWorkspacePage from './SignalsWorkspacePage';

const VEHICLE = { id: 1, vin: '5YJ3E1EA1NF000001', display_name: 'Model 3' };

function renderPage(entry = '/signals') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <SignalsWorkspacePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Read a StatCard's value by its label text. StatCard renders the label and
// the value as sibling blocks inside the same Card, so we hop from the label
// span to the following value row.
function statValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueRow = labelEl.parentElement?.nextElementSibling;
  return valueRow?.textContent?.trim() ?? '';
}

beforeEach(() => {
  h.vehicle.vehicleId = 1;
  h.vehicle.vehicles = [VEHICLE];
  h.signals.data = ['battery_level', 'vehicle_speed'];
  h.signals.error = null;
  h.diff.data = undefined;
  h.diff.isLoading = false;
  h.diff.error = null;
  h.pinned.data = [];
  h.live.connected = false;
  h.live.chartData = [];
  h.live.chartStats = [];
  h.live.chartPointCount = 0;
  h.live.tailEntries = [];
  h.live.tailRate = 0;
  h.live.tailPaused = false;
});

afterEach(() => {
  __resetTitleStoreForTests();
  vi.clearAllMocks();
});

describe('SignalsWorkspacePage — no vehicle', () => {
  it('shows the "select a vehicle" empty state and a zeroed KPI strip', () => {
    h.vehicle.vehicleId = 0;
    h.vehicle.vehicles = [];
    h.signals.data = undefined;

    renderPage('/signals');

    expect(screen.getByText('Select a vehicle to begin')).toBeInTheDocument();
    expect(statValue('Selected')).toBe('0');
    expect(statValue('Mode')).toBe('Historical');
    expect(document.title).toContain('Signals');
  });
});

describe('SignalsWorkspacePage — default historical mode', () => {
  it('reflects the URL-selected signals + pins in the KPI strip and prompts to run', () => {
    h.pinned.data = [{ item_id: 'signal:vehicle_speed' }, { item_id: 'widget:not-a-signal' }];

    renderPage('/signals?signals=battery_level,vehicle_speed');

    // useUrlArray('signals') parsed two names from the URL.
    expect(statValue('Selected')).toBe('2');
    expect(statValue('Mode')).toBe('Historical');
    // Only the `signal:`-prefixed pin counts toward pinned signals.
    expect(statValue('Pinned signals')).toBe('1');
    // Not live → live rate collapses to the em-dash placeholder.
    expect(statValue('Live rate')).toBe('—');

    expect(screen.getByText('Pick signals and run a query')).toBeInTheDocument();
    // Neither the live tail nor the history table shows until the user acts.
    expect(screen.queryByTestId('live-tail')).toBeNull();
    expect(screen.queryByTestId('history-table')).toBeNull();
  });
});

describe('SignalsWorkspacePage — live mode', () => {
  it('enters Live mode on toggle, streaming the tail and surfacing the live rate', () => {
    h.live.tailRate = 5;

    renderPage('/signals?signals=battery_level,vehicle_speed');

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));

    expect(statValue('Mode')).toBe('Live');
    const tail = screen.getByTestId('live-tail');
    expect(tail).toBeInTheDocument();
    expect(tail.getAttribute('data-rate')).toBe('5');
    expect(statValue('Live rate')).toContain('5');
    // The chart panel receives the live flag.
    expect(screen.getByTestId('chart-panel').getAttribute('data-live')).toBe('true');
    // The toggle flips its own label.
    expect(screen.getByRole('button', { name: 'Stop live' })).toBeInTheDocument();
    expect(screen.queryByTestId('history-table')).toBeNull();
  });

  it('keeps Live and Compare mutually exclusive', () => {
    renderPage('/signals?signals=battery_level,vehicle_speed');

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(statValue('Mode')).toBe('Live');
    expect(screen.getByTestId('live-tail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(statValue('Mode')).toBe('Compare');
    // Switching to Compare tears the live tail down.
    expect(screen.queryByTestId('live-tail')).toBeNull();
  });
});

describe('SignalsWorkspacePage — compare mode', () => {
  it('renders populated diff rows and the changed-signals count', () => {
    h.diff.data = {
      data: [
        { name: 'battery_level', value_a: 80, value_b: 82, changed: true },
        { name: 'vehicle_speed', value_a: 0, value_b: 10, changed: true },
      ],
    };

    renderPage('/signals?signals=battery_level,vehicle_speed');

    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    expect(statValue('Mode')).toBe('Compare');
    expect(screen.getByTestId('compare-controls')).toBeInTheDocument();
    expect(screen.getByTestId('diff-table').getAttribute('data-rows')).toBe('2');
    expect(statValue('Changed signals')).toBe('2');
    expect(screen.getByRole('button', { name: 'Exit compare' })).toBeInTheDocument();
  });

  it('shows the loading skeleton (no diff table) while the diff query is in flight', () => {
    h.diff.isLoading = true;
    h.diff.data = undefined;

    renderPage('/signals?signals=battery_level,vehicle_speed');

    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    expect(statValue('Changed signals')).toBe('—');
    expect(screen.queryByTestId('diff-table')).toBeNull();
    expect(screen.getByTestId('compare-controls')).toBeInTheDocument();
  });
});

describe('SignalsWorkspacePage — error handling', () => {
  it('surfaces the top error banner when the signals query fails', () => {
    h.signals.error = new Error('boom');
    h.signals.data = undefined;

    renderPage('/signals?signals=battery_level,vehicle_speed');

    expect(screen.getByText(/Failed to load data/)).toBeInTheDocument();
    // The page still renders its KPI strip alongside the banner.
    expect(statValue('Mode')).toBe('Historical');
  });
});
