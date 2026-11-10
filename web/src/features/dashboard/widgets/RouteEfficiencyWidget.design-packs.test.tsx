import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import type { RouteEfficiencyData, RouteSummary } from '@/types/driving';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import RouteEfficiencyWidget from './RouteEfficiencyWidget';

const preferences = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi' }));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/hooks/useUnits', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useUnits')>('@/hooks/useUnits');
  return {
    ...actual,
    useUnits: () => {
      const units = actual.useUnits();
      return { ...units, unitPrefs: { ...units.unitPrefs, distance: preferences.distance } };
    },
  };
});

const packs = PACK_IDS.filter(id => id !== 'classic')
  .map(id => [id, PACK_APPEARANCES[id]] as const);
const mockRequest = vi.mocked(request);
const clients = new Set<QueryClient>();

function route(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    startLocation: 'Home', endLocation: 'Office', tripCount: 4, avgDistanceKm: 20,
    avgEfficiency: 160, bestEfficiency: 150, worstEfficiency: 180, ...overrides,
  };
}

function payload(routes: RouteSummary[]): RouteEfficiencyData {
  return {
    routes, totalRoutes: routes.length,
    totalTrips: routes.reduce((sum, item) => sum + (Number.isFinite(item.tripCount) ? item.tripCount : 0), 0),
  };
}

function respond(data: RouteEfficiencyData) {
  mockRequest.mockImplementation(path => {
    if (path.startsWith('/analytics/route-efficiency')) return Promise.resolve(data);
    if (path === '/vehicles') return Promise.resolve([]);
    return Promise.reject(new Error(`Unexpected test request: ${path}`));
  });
}

const routeCalls = () => mockRequest.mock.calls.filter(([path]) => path.startsWith('/analytics/route-efficiency'));

function renderWidget(packId: unknown = 'classic', cols = 3) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  clients.add(client);
  const tree = (requestedPackId: unknown, columns: number) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <RouteEfficiencyWidget vehicleId={42} size={{ cols: columns, rows: 2 }} config={{ timeRange: '7d' }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId, cols));
  return { ...view, select: (next: unknown, columns = cols) => view.rerender(tree(next, columns)) };
}

async function presentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const node = container.querySelector<HTMLElement>(
      `[data-widget-family="list"][data-widget-appearance="${appearance}"]`,
    );
    expect(node).not.toBeNull();
    return node!;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  preferences.distance = 'km';
  respond(payload([
    route({ startLocation: 'Hill', endLocation: 'Station', avgEfficiency: 300, bestEfficiency: 270, worstEfficiency: 330, tripCount: 2 }),
    route(),
  ]));
});

afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.clear();
});

describe('RouteEfficiencyWidget production design packs', () => {
  it.each(packs)('%s renders %s with real route rankings and route-scoped best/worst/average', async (pack, appearance) => {
    const view = renderWidget(pack);
    const body = await presentation(view.container, appearance);
    expect(screen.getByRole('heading', { name: 'Route efficiency', level: 3 })).toBeVisible();
    const rows = within(body).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Home → Office · best 150.00 / worst 180.00 Wh/km');
    expect(rows[0]).toHaveTextContent('160.00 Wh/km · 4×');
    expect(rows[0]).toHaveTextContent('Excellent');
    expect(rows[1]).toHaveTextContent('Hill → Station');
    expect(rows[1]).toHaveTextContent('300.00 Wh/km · 2×');
    expect(rows[1]).toHaveTextContent('Good');
    expect(body.querySelector('.widget-big-number')).toHaveTextContent('Home → Office160.00Wh/km');
    expect(within(body).getByText('Drives: 4')).toBeInTheDocument();
    const values = body.querySelectorAll('dd');
    expect(Array.from(values, item => item.textContent)).toEqual([
      '150.00 Wh/km', '180.00 Wh/km', '160.00 Wh/km',
    ]);
    expect(within(body).getByText('Compare repeated journeys rather than a single trip.')).toBeInTheDocument();
    expect(within(body).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(body).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(body.querySelector('svg.lucide-route')).not.toBeNull();
    expect(routeCalls()).toHaveLength(1);
    const url = new URL(String(routeCalls()[0][0]), 'https://fixture.test');
    expect(url.searchParams.get('vehicle_id')).toBe('42');
    expect(Date.parse(url.searchParams.get('end')!) - Date.parse(url.searchParams.get('start')!))
      .toBe(7 * 24 * 60 * 60 * 1000);
  });

  it.each(packs)('%s keeps unknown %s readings unknown without a success badge or invented scale', async (pack, appearance) => {
    respond(payload([route({
      avgEfficiency: Number.NaN, bestEfficiency: Number.POSITIVE_INFINITY,
      worstEfficiency: Number.NaN, tripCount: Number.NaN,
    })]));
    const view = renderWidget(pack, 2);
    const body = await presentation(view.container, appearance);
    expect(within(body).getByRole('listitem')).toHaveTextContent('— · —×');
    expect(body.querySelector('.widget-big-number')).toHaveTextContent('Home → Office—');
    expect(within(body).getByText('Drives: —')).toBeInTheDocument();
    expect(Array.from(body.querySelectorAll('dd'), item => item.textContent)).toEqual(['—', '—', '—']);
    expect(within(body).queryByText('Excellent')).not.toBeInTheDocument();
    expect(within(body).queryByText('Good')).not.toBeInTheDocument();
    expect(within(body).queryByRole('meter')).not.toBeInTheDocument();
    expect(body.textContent).not.toMatch(/NaN|Infinity|0\.00/);
    expect(within(body).getByRole('listitem').querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it.each(packs)('%s retains the compact %s empty shell and all unknown summary rows', async (pack, appearance) => {
    respond(payload([]));
    const view = renderWidget(pack, 1);
    const body = await presentation(view.container, appearance);
    expect(screen.getByRole('heading', { name: 'Route efficiency', level: 3 })).toBeVisible();
    expect(within(body).getByRole('status')).toHaveTextContent('No route data');
    expect(Array.from(body.querySelectorAll('dd'), item => item.textContent)).toEqual(['—', '—', '—']);
    expect(within(body).getByText('Drives: —')).toBeInTheDocument();
    expect(within(body).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(body).queryByRole('meter')).not.toBeInTheDocument();
  });

  it.each(packs)('%s keeps the compact %s three-route limit, summary and comparison details', async (pack, appearance) => {
    respond(payload([route(), ...[2, 3, 4, 5].map(index => route({
      startLocation: `Stop ${index}`, avgEfficiency: 160 + index,
    }))]));
    const view = renderWidget(pack, 1);
    const body = await presentation(view.container, appearance);
    expect(within(body).getAllByRole('listitem')).toHaveLength(3);
    expect(within(body).getByRole('list')).toHaveTextContent('Home → Office');
    expect(within(body).getByRole('list')).not.toHaveTextContent('Stop 4');
    expect(body.querySelectorAll('dd')).toHaveLength(3);
    expect(body.querySelector('.widget-big-number')).toHaveTextContent('160.00Wh/km');
  });

  it.each(packs)('%s converts every %s reading at the display boundary and preserves signed source extrema', async (pack, appearance) => {
    preferences.distance = 'mi';
    respond(payload([route({ bestEfficiency: -10 })]));
    const view = renderWidget(pack);
    const body = await presentation(view.container, appearance);
    expect(within(body).getByRole('listitem')).toHaveTextContent('257.50 Wh/mi · 4×');
    expect(within(body).getByRole('listitem')).toHaveTextContent('best -16.09 / worst 289.68 Wh/mi');
    expect(Array.from(body.querySelectorAll('dd'), item => item.textContent)).toEqual([
      '-16.09 Wh/mi', '289.68 Wh/mi', '257.50 Wh/mi',
    ]);
    expect(body.querySelector('.widget-big-number')).toHaveTextContent('257.50Wh/mi');
    expect(body.textContent).not.toContain('Wh/km');
  });

  it.each(packs)('%s preserves measured zero %s efficiency, extrema and trip counts', async (pack, appearance) => {
    respond(payload([route({
      avgEfficiency: 0, bestEfficiency: 0, worstEfficiency: 0, tripCount: 0,
    })]));
    const view = renderWidget(pack);
    const body = await presentation(view.container, appearance);
    expect(within(body).getByRole('listitem')).toHaveTextContent('0.00 Wh/km · 0×');
    expect(within(body).getByText('Excellent')).toBeInTheDocument();
    expect(body.querySelector('.widget-big-number')).toHaveTextContent('Home → Office0.00Wh/km');
    expect(within(body).getByText('Drives: 0')).toBeInTheDocument();
    expect(Array.from(body.querySelectorAll('dd'), item => item.textContent)).toEqual([
      '0.00 Wh/km', '0.00 Wh/km', '0.00 Wh/km',
    ]);
    expect(body.textContent).not.toContain('—');
    expect(within(body).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(body).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('changes every presentation without another read, recovers Classic, and retains the real refresh action', async () => {
    const view = renderWidget();
    await screen.findByText('160.00 Wh/km · 4×');
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.queryByText('Compare repeated journeys rather than a single trip.')).not.toBeInTheDocument();
    for (const [pack, appearance] of packs) {
      view.select(pack);
      await presentation(view.container, appearance);
      expect(routeCalls()).toHaveLength(1);
    }
    view.select('unrecognized');
    await waitFor(() => expect(view.container.querySelector('[data-widget-family]')).toBeNull());
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    respond(payload([route({ tripCount: 5 })]));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await screen.findByText('160.00 Wh/km · 5×');
    expect(routeCalls()).toHaveLength(2);
    view.select('v4');
    const body = await presentation(view.container, 'owner');
    expect(within(body).getByText('Drives: 5')).toBeInTheDocument();
    expect(routeCalls()).toHaveLength(2);
  });

  it.each(packs)('%s retains %s route details and source trust after a failed refresh and can retry', async (pack, appearance) => {
    const view = renderWidget(pack);
    const body = await presentation(view.container, appearance);
    mockRequest.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(within(body).getByText('Drives: 4')).toBeInTheDocument();
    expect(within(body).getAllByRole('listitem')).toHaveLength(2);
    expect(body.querySelectorAll('dd')).toHaveLength(3);
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    respond(payload([route({ avgEfficiency: 155 })]));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await screen.findByText('155.00 Wh/km · 4×');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(routeCalls()).toHaveLength(3);
  });

  it.each(packs)('%s keeps source-shaped %s loading without fabricated summary readings', (pack) => {
    mockRequest.mockImplementation(path => path === '/vehicles'
      ? Promise.resolve([])
      : new Promise<never>(() => undefined));
    const view = renderWidget(pack);
    expect(screen.getByRole('heading', { name: 'Route efficiency', level: 3 })).toBeVisible();
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.queryByText('No route data')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it.each(packs)('%s shows a real initial %s failure instead of an empty success', async (pack) => {
    mockRequest.mockRejectedValue(new Error('offline'));
    const view = renderWidget(pack);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach server");
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    expect(screen.queryByText('No route data')).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toBeEnabled();
  });
});
