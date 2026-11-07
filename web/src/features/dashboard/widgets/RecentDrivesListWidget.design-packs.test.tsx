import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Drive } from '@/api/types';
import { Text } from '@/components/ui';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';
import RecentDrivesListWidget from './RecentDrivesListWidget';

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
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 42 }] }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: { distance: mocks.distance } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({
    formatRelativeDays: (value: string) => value.startsWith('2026-11-06') ? 'Today' : 'Yesterday',
    formatWeekdayName: () => 'Fri',
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: unknown) => typeof value === 'string' ? value.slice(11, 16) : '08:00',
    formatDateTime: (value: unknown) => String(value),
    formatRelative: () => 'Today',
    formatRelativeTime: () => 'Today',
    opts: { locale: 'en-US', tz: 'UTC' },
    locale: 'en-US',
    tz: 'UTC',
  }),
}));

const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const fullSize = { cols: 3, rows: 2 };
const compactSize = { cols: 1, rows: 1 };
const fullDestination = 'A complete destination address whose final words remain readable';

function drive(overrides: Partial<DriveFixture> = {}): DriveFixture {
  return {
    id: 17, vehicle_id: 42, start_ts: '2026-11-06T08:00:00Z',
    distance_m: 17_000, duration_s: 1800, energy_used_wh: 4097,
    start_address: 'Home', end_address: 'Office',
    ...overrides,
  };
}

function query(overrides: Partial<HistoryFixture> = {}): HistoryFixture {
  return {
    data: [
      drive(),
      drive({
        id: 29, start_ts: '2026-11-05T18:00:00Z', duration_s: 7200,
        start_address: 'Office', end_address: fullDestination,
      }),
    ],
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null, dataUpdatedAt: Date.now(), refetch: mocks.refetch,
    ...overrides,
  };
}

function LocationProbe() {
  return <Text data-testid="location">{useLocation().pathname}</Text>;
}

function widgetTree(packId: string, props: Partial<WidgetProps> = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <RecentDrivesListWidget vehicleId={42} size={fullSize} {...props} />
      </PackBoundary>
      <LocationProbe />
    </MemoryRouter>
  );
}

async function findPresentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const presentation = container.querySelector<HTMLElement>(
      `[data-widget-family="list"][data-widget-appearance="${appearance}"]`,
    );
    expect(presentation).not.toBeNull();
    if (!presentation) throw new Error('The selected list presentation has not loaded');
    return presentation;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.distance = 'km';
  mocks.refetch.mockResolvedValue(undefined);
  mocks.history.mockReturnValue(query());
});

describe('RecentDrivesListWidget production design packs', () => {
  it.each(packs)('%s preserves real rows, scope and compact/full layouts in %s', async (packId, appearance) => {
    const view = render(widgetTree(packId, { config: { timeRange: '7d' } }));
    const presentation = await findPresentation(view.container, appearance);
    const list = within(presentation).getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Home → Office')).toBeInTheDocument();
    expect(within(list).getByText(`Office → ${fullDestination}`)).toBeInTheDocument();
    expect(within(list).getByText('Today 08:00 · 30m')).toBeInTheDocument();
    expect(within(list).getByText('Yesterday 18:00 · 2h 0m')).toBeInTheDocument();
    expect(within(list).getAllByText('241 Wh/km')).toHaveLength(2);
    expect(within(list).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['/drives/17', '/drives/29']);
    expect(presentation.querySelector('.widget-big-number')).toHaveTextContent('17 km');
    expect(presentation.querySelector('.lucide-route')).not.toBeNull();
    expect(within(presentation).getByText('Recent drives: 2')).toBeInTheDocument();
    expect(within(presentation).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(presentation).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenLastCalledWith(42, { kind: 'recent-list', limit: 10, range: '7d' });

    view.rerender(widgetTree(packId, { size: compactSize, config: { timeRange: '7d' } }));
    expect(mocks.history).toHaveBeenLastCalledWith(42, { kind: 'recent-list', limit: 5, range: '7d' });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(`Office → ${fullDestination}`)).toBeInTheDocument();
    expect(screen.getByText('Yesterday 18:00 · 2h 0m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Drive: 17 km, Today/ })).toHaveAttribute('href', '/drives/17');
  });

  it.each(packs)('%s distinguishes unknown readings, measured zero and an empty source in %s', async (packId, appearance) => {
    mocks.history.mockReturnValue(query({
      data: [
        drive({ distance_m: null, duration_s: null, energy_used_wh: null, start_address: null, end_address: null }),
        drive({ id: 29, distance_m: 0, duration_s: 30, energy_used_wh: 0 }),
      ],
    }));
    const view = render(widgetTree(packId));
    const presentation = await findPresentation(view.container, appearance);
    const rows = within(presentation).getAllByRole('listitem');
    expect(within(rows[0]).getByText('—')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Drive')).toBeInTheDocument();
    expect(within(rows[0]).queryByText(/Wh\/km|0 km|<1m/)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('0 km')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/<1m/)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/Wh\/km/)).not.toBeInTheDocument();
    expect(presentation.querySelector('.widget-big-number')).toHaveTextContent('—');

    mocks.history.mockReturnValue(query({ data: null }));
    view.rerender(widgetTree(packId));
    const empty = await findPresentation(view.container, appearance);
    expect(within(empty).getByText('No recent drives recorded')).toBeInTheDocument();
    expect(within(empty).queryByRole('list')).not.toBeInTheDocument();
    expect(within(empty).queryByText(/0 km|Recent drives: 0/)).not.toBeInTheDocument();
    expect(empty.querySelector('.widget-big-number')).toBeNull();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');
  });

  it.each(['classic', 'retired-pack'])('preserves the original Classic body for %s', (packId) => {
    const { container } = render(widgetTree(packId));
    expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByText('17 km')).toHaveLength(2);
    expect(screen.queryByText('Recent drives: 2')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');
  });

  it('converts the headline and all row efficiencies only at the display boundary', async () => {
    mocks.distance = 'mi';
    const { container } = render(widgetTree('v4'));
    const presentation = await findPresentation(container, 'owner');
    const list = within(presentation).getByRole('list');
    expect(within(list).getAllByText('11 mi')).toHaveLength(2);
    expect(within(list).getAllByText('388 Wh/mi')).toHaveLength(2);
    expect(presentation.querySelector('.widget-big-number')).toHaveTextContent('11 mi');
    expect(within(presentation).queryByText(/Wh\/km|17 km/)).not.toBeInTheDocument();
  });

  it('keeps refresh and both drive-list and detail navigation working across pack changes', async () => {
    const view = render(widgetTree('classic'));
    view.rerender(widgetTree('v5'));
    await findPresentation(view.container, 'iconic');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('link', { name: /^Drive: 17 km, Today/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/drives/17');
    view.rerender(widgetTree('v7'));
    await findPresentation(view.container, 'pixel');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('link', { name: 'View all' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/drives');
    view.rerender(widgetTree('classic'));
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('preserves the shell through loading/fatal failure and retains rows with refresh-failure evidence', async () => {
    mocks.history.mockReturnValue(query({ data: undefined, dataUpdatedAt: 0, isLoading: true }));
    const view = render(widgetTree('v7'));
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('No recent drives recorded')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toBeInTheDocument();

    mocks.history.mockReturnValue(query({
      data: undefined, dataUpdatedAt: 0, error: new Error('synthetic outage'), isError: true,
    }));
    view.rerender(widgetTree('v7'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No recent drives recorded')).not.toBeInTheDocument();

    mocks.history.mockReturnValue(query({
      error: new Error('synthetic background outage'), isError: true, isStale: true,
      dataUpdatedAt: Date.now() - 60_000,
    }));
    view.rerender(widgetTree('v7'));
    await findPresentation(view.container, 'pixel');
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
