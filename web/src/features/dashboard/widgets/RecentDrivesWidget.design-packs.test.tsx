import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Drive } from '@/api/types';
import { Text } from '@/components/ui';
import RecentDrivesWidget from './RecentDrivesWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetProps } from './types';

type DriveFixture = Pick<Drive,
  'id' | 'vehicle_id' | 'start_ts' | 'start_address' | 'end_address' | 'energy_used_wh'
> & { distance_m: number | null; duration_s: number | null };

interface HistoryFixture {
  data: DriveFixture[] | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error: Error | null;
  dataUpdatedAt: number;
  refetch: () => Promise<void>;
}

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  refetch: vi.fn<() => Promise<void>>(),
  distance: 'km' as 'km' | 'mi',
}));

vi.mock('@/api/hooks/useDriving', () => ({ useDashboardDriveHistory: mocks.history }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 7 }] }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: { distance: mocks.distance } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      return base.replace(/{{(\w+)}}/g, (match: string, name: string) =>
        options && name in options ? String(options[name]) : match);
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({
    formatRelativeDays: () => 'Today',
    formatWeekdayName: () => 'Fri',
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: () => '12:00',
    formatDateTime: (value: unknown) => String(value),
    formatRelative: () => 'Today',
    formatRelativeTime: () => 'just now',
    opts: { locale: 'en-US', tz: 'UTC' },
    locale: 'en-US',
    tz: 'UTC',
  }),
}));

const fullSize = { cols: 2, rows: 2 };
const compactSize = { cols: 1, rows: 1 };
const destination = 'A complete destination address whose final words remain readable';

function drive(overrides: Partial<DriveFixture> = {}): DriveFixture {
  return {
    id: 17, vehicle_id: 42, start_ts: '2026-11-06T12:00:00Z',
    start_address: 'Home', end_address: 'Office',
    distance_m: 5000, duration_s: 1800, energy_used_wh: 1155,
    ...overrides,
  };
}

function query(overrides: Partial<HistoryFixture> = {}): HistoryFixture {
  return {
    data: [
      drive(),
      drive({ id: 18, start_address: 'Office', end_address: destination }),
      drive({ id: 19, end_address: 'Library' }),
      drive({ id: 20, end_address: 'Market' }),
      drive({ id: 21, end_address: 'Fifth destination' }),
    ],
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null, dataUpdatedAt: Date.now(), refetch: mocks.refetch,
    ...overrides,
  };
}

function LocationProbe() {
  return <Text data-testid="location">{useLocation().pathname}</Text>;
}

function widgetTree(packId?: string, props: Partial<WidgetProps> = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <RecentDrivesWidget vehicleId={42} size={fullSize} {...props} />
      </PackBoundary>
      <LocationProbe />
    </MemoryRouter>
  );
}

async function findPresentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const presentation = container.querySelector<HTMLElement>(
      `[data-widget-family="map"][data-widget-appearance="${appearance}"]`,
    );
    expect(presentation).not.toBeNull();
    if (!presentation) throw new Error('The selected recent-drives presentation has not loaded');
    return presentation;
  });
}

function detailList(presentation: HTMLElement) {
  const list = presentation.querySelector<HTMLElement>('.widget-detail-list');
  if (!list) throw new Error('The original recent-drive rows are missing');
  return list;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.distance = 'km';
  mocks.refetch.mockResolvedValue(undefined);
  mocks.history.mockReturnValue(query());
});

describe.each(Object.entries(PACK_APPEARANCES))('Recent drives %s / %s', (packId, appearance) => {
  it('retains the real route rows, row cap, full-set summary and actions at both sizes', async () => {
    const props = { config: { timeRange: '7d' } };
    const view = render(widgetTree(packId, props));
    const presentation = await findPresentation(view.container, appearance);
    const list = detailList(presentation);

    expect(screen.getByRole('heading', { name: 'Recent drives' })).toBeInTheDocument();
    expect(within(list).getAllByRole('term')).toHaveLength(4);
    expect(within(list).getByText('Home → Office')).toBeInTheDocument();
    expect(within(list).getByText(`Office → ${destination}`)).toBeInTheDocument();
    expect(within(list).getAllByText('5.0 km')).toHaveLength(4);
    expect(within(list).getAllByText('231 Wh/km')).toHaveLength(4);
    expect(within(list).getAllByText('Today 12:00 · 30 min')).toHaveLength(4);
    expect(screen.queryByText(/Fifth destination/)).not.toBeInTheDocument();
    expect(screen.getByText('5 recent drives · 25 km')).toBeInTheDocument();
    const headline = presentation.querySelector<HTMLElement>('.widget-big-number');
    expect(headline).not.toBeNull();
    expect(headline).toHaveTextContent('Home → Office');
    expect(headline).toHaveTextContent('5.0 km');
    expect(headline).toHaveTextContent('Today 12:00 · 30 min');
    expect(presentation.querySelector('.lucide-route')).not.toBeNull();
    const journey = within(presentation).getByRole('img', {
      name: 'Home → Office. Schematic connection, not recorded route geometry.',
    });
    expect(within(presentation).getByText('Schematic connection, not recorded route geometry.')).toBeInTheDocument();
    expect(journey.querySelectorAll('[data-flow-edge]')).toHaveLength(1);
    expect(journey.querySelector('.flow-active')).toBeNull();
    expect(within(presentation).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(presentation).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenLastCalledWith(42, { kind: 'recent', limit: 5, range: '7d' });
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');

    view.rerender(widgetTree(packId, { ...props, size: compactSize }));
    const compact = await findPresentation(view.container, appearance);
    expect(within(detailList(compact)).getAllByRole('term')).toHaveLength(4);
    expect(within(detailList(compact)).getByText(`Office → ${destination}`)).toBeInTheDocument();
    expect(screen.getByText('5 recent drives · 25 km')).toBeInTheDocument();
    expect(mocks.history).toHaveBeenLastCalledWith(42, { kind: 'recent', limit: 5, range: '7d' });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', { name: 'All drives' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/drives');
  });

  it('distinguishes unknown and invalid measurements from measured zero and preserves the empty shell', async () => {
    mocks.history.mockReturnValue(query({
      data: [
        drive({ distance_m: null, duration_s: null, energy_used_wh: null, start_address: null, end_address: null }),
        drive({ id: 18, distance_m: 0, duration_s: 0, energy_used_wh: 0 }),
        drive({ id: 19, distance_m: Number.NaN, duration_s: Number.POSITIVE_INFINITY, energy_used_wh: Number.NEGATIVE_INFINITY }),
      ],
    }));
    const view = render(widgetTree(packId));
    const presentation = await findPresentation(view.container, appearance);
    const list = detailList(presentation);
    expect(within(list).getByText('Drive')).toBeInTheDocument();
    expect(within(list).getAllByText('Today 12:00 · —')).toHaveLength(2);
    expect(within(list).getAllByText('—')).toHaveLength(2);
    expect(within(list).getByText('0.0 km')).toBeInTheDocument();
    expect(within(list).getByText('Today 12:00 · 0 min')).toBeInTheDocument();
    expect(presentation.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(within(presentation).getByRole('img', {
      name: '— → —. Schematic connection, not recorded route geometry.',
    }).querySelector('[data-flow-edge]')).toBeNull();
    expect(screen.getByText('3 recent drives · 0 km')).toBeInTheDocument();
    expect(screen.queryByText(/Wh\/|NaN|undefined|Infinity/)).not.toBeInTheDocument();

    mocks.history.mockReturnValue(query({ data: [] }));
    view.rerender(widgetTree(packId));
    await findPresentation(view.container, appearance);
    expect(screen.getByText('No recent drives')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent drives' })).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toBeNull();
    expect(screen.queryByText(/recent drives ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All drives' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');
  });

  it('converts real SI distance and efficiency to miles in the headline and rows', async () => {
    mocks.distance = 'mi';
    mocks.history.mockReturnValue(query({ data: [drive({ distance_m: 1609.344, energy_used_wh: 231 })] }));
    const { container } = render(widgetTree(packId));
    const presentation = await findPresentation(container, appearance);
    expect(presentation.querySelector('.widget-big-number')).toHaveTextContent('1.0 mi');
    expect(within(detailList(presentation)).getByText('1.0 mi')).toBeInTheDocument();
    expect(within(detailList(presentation)).getByText('231 Wh/mi')).toBeInTheDocument();
    expect(screen.getByText('1 recent drives · 1 mi')).toBeInTheDocument();
    expect(screen.queryByText(/\bkm\b/)).not.toBeInTheDocument();
  });

  it('keeps retained historical rows, headline and source warning after a failed refresh', async () => {
    mocks.history.mockReturnValue(query({ isError: true, isStale: true, error: new Error('refresh failed') }));
    const { container } = render(widgetTree(packId));
    const presentation = await findPresentation(container, appearance);
    expect(within(detailList(presentation)).getByText('Home → Office')).toBeInTheDocument();
    expect(presentation.querySelector('.widget-big-number')).toHaveTextContent('5.0 km');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('reports a fatal error with retry rather than an invented empty drive history', async () => {
    mocks.history.mockReturnValue(query({ data: undefined, isError: true, error: new Error('unavailable'), dataUpdatedAt: 0 }));
    const view = render(widgetTree(packId));
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No recent drives')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.0 km|recent drives ·/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();

    mocks.history.mockReturnValue(query());
    view.rerender(widgetTree(packId));
    const presentation = await findPresentation(view.container, appearance);
    expect(within(detailList(presentation)).getByText('Home → Office')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it('preserves the loading shell without fabricating a headline, empty state or summary', () => {
    mocks.history.mockReturnValue(query({ data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
    const { container } = render(widgetTree(packId));
    expect(screen.getByRole('heading', { name: 'Recent drives' })).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.widget-big-number')).toBeNull();
    expect(screen.queryByText('No recent drives')).not.toBeInTheDocument();
    expect(screen.queryByText(/recent drives ·/)).not.toBeInTheDocument();
  });
});

it('keeps Classic unchanged and returns to it for explicit and unknown selections without extra controllers', async () => {
  const view = render(widgetTree());
  const assertClassic = () => {
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(view.container.querySelector('.widget-big-number')).toBeNull();
    expect(screen.getByText('Home → Office')).toBeInTheDocument();
    expect(screen.getAllByRole('term')).toHaveLength(4);
    expect(screen.getByText('5 recent drives · 25 km')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Home → Office/ })).not.toBeInTheDocument();
  };
  assertClassic();
  view.rerender(widgetTree('v7'));
  await findPresentation(view.container, 'pixel');
  view.rerender(widgetTree('classic'));
  assertClassic();
  view.rerender(widgetTree('not-a-production-pack'));
  assertClassic();
  expect(mocks.history.mock.calls.every(([id, options]) =>
    id === 42 && options.kind === 'recent' && options.limit === 5)).toBe(true);
});
