import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { SecurityEvent } from '@/api/types';
import DoorWindowStatusWidget from './DoorWindowStatusWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

type QueryFixture<T> = DataStateSource<T> & { refetch: () => void };
const mocks = vi.hoisted(() => ({
  vehicles: vi.fn<() => QueryFixture<{ id: number }[]>>(),
  security: vi.fn<(id: number, interval?: number) => QueryFixture<SecurityEvent | null>>(),
  refreshVehicles: vi.fn(),
  refreshSecurity: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: mocks.vehicles,
  useSecurityLatest: mocks.security,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | number | Date) => new Date(value instanceof Date ? value.getTime() : value).toISOString(),
    formatTime: (value: string | number | Date) => new Date(value instanceof Date ? value.getTime() : value).toISOString(),
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const packs = Object.entries(PACK_APPEARANCES);
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const NOW = Date.parse('2026-11-07T02:25:00Z');
const NOTE = 'Every door and window retains its own reported state.';

function snapshot(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 42, ts: new Date(NOW - 10_000).toISOString(), event_type: 'state',
    doors_open: null, windows_open: null, locked: true, sentry_mode: false,
    user_present: false, detail: null, source: 'test', created_at: new Date(NOW).toISOString(),
    door_state: 'DriverFront:Open,PassengerRear:Open',
    fd_window: 'Closed', fp_window: 'PartiallyOpen', rd_window: 'Unknown', rp_window: 'Opened',
    ...overrides,
  };
}

function closedSnapshot(): SecurityEvent {
  return snapshot({
    door_state: false, fd_window: false, fp_window: false, rd_window: false, rp_window: false,
  });
}

function query<T>(data: T | undefined, refetch: () => void, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data, refetch, dataUpdatedAt: data === undefined ? 0 : NOW,
    isLoading: false, isPending: false, isSuccess: true, isFetching: false,
    isError: false, isStale: false, fetchStatus: 'idle', error: null, ...overrides,
  };
}

function tree(pack?: unknown, size = FULL, vehicleId: number | null = 42) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={pack}>
        <DoorWindowStatusWidget vehicleId={vehicleId ?? undefined} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function presentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const selected = container.querySelector<HTMLElement>(
      `[data-widget-family="access-matrix"][data-widget-appearance="${appearance}"]`,
    );
    if (!selected) throw new Error('The requested access matrix has not loaded');
    return selected;
  });
}

function accessTable() {
  return within(screen.getByRole('table', { name: 'Door & window status' }));
}

function expectReportedRows() {
  const table = accessTable();
  for (const [position, door, window] of [
    ['Front left', 'Open', 'Closed'],
    ['Front right', 'Closed', 'Partial'],
    ['Rear left', 'Closed', 'Unknown'],
    ['Rear right', 'Open', 'Open'],
  ] as const) {
    const row = within(table.getByRole('row', { name: `${position} ${door} ${window}` }));
    expect(row.getByRole('rowheader', { name: position })).toBeVisible();
    expect(row.getAllByRole('cell').map(cell => cell.textContent)).toEqual([door, window]);
  }
  expect(table.getAllByRole('row')).toHaveLength(5);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mocks.vehicles.mockReturnValue(query([{ id: 7 }], mocks.refreshVehicles));
  mocks.security.mockReturnValue(query(snapshot(), mocks.refreshSecurity));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(packs)('Door and window status %s (%s)', (pack, appearance) => {
  it('keeps eight independent readings, semantic headers, source context and refresh in one controller', async () => {
    const view = render(tree(pack));
    const selected = await presentation(view.container, appearance);
    expectReportedRows();
    for (const name of ['Position', 'Door', 'Window']) {
      expect(accessTable().getByRole('columnheader', { name })).toBeVisible();
    }
    expect(screen.getByText('LAST REPORTED')).toBeVisible();
    expect(screen.getByText('Open or partial')).toBeVisible();
    expect(screen.getByText(NOTE)).toBeVisible();
    expect(selected.querySelector('.lucide-door-open')).not.toBeNull();
    expect(selected).toHaveAttribute('data-instrument-family', 'access-matrix');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mocks.vehicles).toHaveBeenCalledOnce();
    expect(mocks.security).toHaveBeenCalledOnce();
    expect(mocks.security).toHaveBeenCalledWith(42, 5_000);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(mocks.refreshSecurity).toHaveBeenCalledOnce();
    expect(mocks.refreshVehicles).not.toHaveBeenCalled();
  });

  it('preserves the compact badges and treats real boolean false as measured closed', async () => {
    mocks.security.mockReturnValue(query(closedSnapshot(), mocks.refreshSecurity));
    const view = render(tree(pack, COMPACT));
    await presentation(view.container, appearance);
    expect(screen.getByText('Doors ✓')).toBeVisible();
    expect(screen.getByText('Windows ✓')).toBeVisible();
    expect(screen.queryByText('All closed')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Door & window status')).not.toBeInTheDocument();

    mocks.security.mockReturnValue(query(snapshot(), mocks.refreshSecurity));
    view.rerender(tree(pack, COMPACT));
    expect(screen.getByText('2 door(s) open')).toBeVisible();
    expect(screen.getByText('2 window(s) open')).toBeVisible();
    expect(screen.queryByText('All closed')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows ✓')).not.toBeInTheDocument();

    mocks.security.mockReturnValue(query(closedSnapshot(), mocks.refreshSecurity));
    view.rerender(tree(pack));
    expect(screen.getByText('All closed')).toBeVisible();
    expect(accessTable().getAllByText('Closed')).toHaveLength(8);
  });

  it('keeps unknown and absent observations neutral with every full-view row still present', async () => {
    mocks.security.mockReturnValue(query(snapshot({
      door_state: 'UnrecognizedOpenState', fd_window: 'WindowStateUnknown',
      fp_window: null, rd_window: undefined, rp_window: 'Not closed',
    }), mocks.refreshSecurity));
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(accessTable().getAllByText('Unknown')).toHaveLength(8);
    expect(screen.getByText('State incomplete')).toBeVisible();
    expect(screen.queryByText('All closed')).not.toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-status="ok"]')).toBeNull();

    view.rerender(tree(pack, COMPACT));
    expect(screen.getByText('Doors unknown')).toBeVisible();
    expect(screen.getByText('Windows unknown')).toBeVisible();
    expect(screen.queryByText('Doors ✓')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows ✓')).not.toBeInTheDocument();

    mocks.security.mockReturnValue(query<SecurityEvent | null>(null, mocks.refreshSecurity));
    view.rerender(tree(pack));
    expect(screen.getByText('No door/window data')).toBeVisible();
    expect(accessTable().getAllByRole('row')).toHaveLength(5);
    expect(accessTable().getAllByText('Unknown')).toHaveLength(8);
    expect(screen.queryByText('LAST REPORTED')).not.toBeInTheDocument();
    expect(screen.queryByText('All closed')).not.toBeInTheDocument();
  });
});

it('preserves Classic default/recovery and refresh focus while changing all presentations', async () => {
  const view = render(tree());
  expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(8);
  expect(screen.getByText('Front left door')).toBeVisible();
  expect(screen.getByText('Rear right window')).toBeVisible();
  expect(screen.getByText('Partial')).toBeVisible();
  expect(screen.getByText('—')).toBeVisible();
  const refresh = screen.getByRole('button', { name: /^Refresh data/i });
  refresh.focus();

  for (const [pack, appearance] of packs) {
    view.rerender(tree(pack));
    await presentation(view.container, appearance);
    expectReportedRows();
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toBe(refresh);
    expect(refresh).toHaveFocus();
  }
  for (const pack of ['classic', 'retired-pack']) {
    view.rerender(tree(pack));
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('Front right window')).toBeVisible();
  }
  view.rerender(tree('classic', COMPACT));
  expect(screen.getByText('2 door(s) open')).toBeVisible();
  expect(screen.getByText('2 window(s) open')).toBeVisible();
  expect(screen.queryByText('Door & window status')).not.toBeInTheDocument();
  fireEvent.click(refresh);
  expect(mocks.refreshSecurity).toHaveBeenCalledOnce();
});

describe.each(packs)('Door and window lifecycle %s (%s)', (pack, appearance) => {
  it.each(['error', 'paused'] as const)('retains all readings and source-age recovery after a refresh is %s', async condition => {
    mocks.security.mockReturnValue(query(snapshot(), mocks.refreshSecurity, {
      dataUpdatedAt: NOW - 60_000, isError: condition === 'error',
      error: condition === 'error' ? new Error('Synthetic refresh failure') : null,
      fetchStatus: condition === 'paused' ? 'paused' : 'idle',
    }));
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectReportedRows();
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(view.container.querySelector('[data-motion-suppressed="true"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    if (condition === 'error') {
      expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    }
    expect(screen.getByText('LAST REPORTED')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(mocks.refreshSecurity).toHaveBeenCalledOnce();
  });

  it('preserves initial loading, fatal-error retry and recovery rather than fabricating closed states', async () => {
    mocks.security.mockReturnValue(query<SecurityEvent | null>(undefined, mocks.refreshSecurity, {
      isLoading: true, isPending: true, isFetching: true, isSuccess: false,
    }));
    const view = render(tree(pack));
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(view.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('All closed')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    mocks.security.mockReturnValue(query<SecurityEvent | null>(undefined, mocks.refreshSecurity, {
      isError: true, error: new Error('Synthetic initial failure'), isSuccess: false,
    }));
    view.rerender(tree(pack));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(mocks.refreshSecurity).toHaveBeenCalledOnce();

    mocks.security.mockReturnValue(query(snapshot(), mocks.refreshSecurity));
    view.rerender(tree(pack));
    await presentation(view.container, appearance);
    expectReportedRows();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the refresh action disabled while fetching without dropping retained readings', async () => {
    mocks.security.mockReturnValue(query(snapshot(), mocks.refreshSecurity, { isFetching: true }));
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectReportedRows();
    const refresh = screen.getByRole('button', { name: /^Refresh data/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mocks.refreshSecurity).not.toHaveBeenCalled();
  });

  it('retries vehicle discovery when unresolved and retains the fleet fallback after discovery', async () => {
    mocks.vehicles.mockReturnValue(query<{ id: number }[]>(undefined, mocks.refreshVehicles, {
      isError: true, error: new Error('Synthetic fleet failure'),
    }));
    mocks.security.mockReturnValue(query<SecurityEvent | null>(undefined, mocks.refreshSecurity));
    const view = render(tree(pack, FULL, null));
    expect(mocks.security).toHaveBeenLastCalledWith(0, 5_000);
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(mocks.refreshVehicles).toHaveBeenCalledOnce();
    expect(mocks.refreshSecurity).not.toHaveBeenCalled();

    mocks.vehicles.mockReturnValue(query([{ id: 7 }, { id: 9 }], mocks.refreshVehicles));
    mocks.security.mockReturnValue(query(snapshot({ vehicle_id: 7 }), mocks.refreshSecurity));
    view.rerender(tree(pack, FULL, null));
    await presentation(view.container, appearance);
    expectReportedRows();
    expect(mocks.security).toHaveBeenLastCalledWith(7, 5_000);
  });
});
