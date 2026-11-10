import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChargingSession } from '@/api/types';

const preferences = vi.hoisted(() => ({ energy: 'kWh' as 'kWh' | 'Wh' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
        : key,
    i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' },
  }),
}));

vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [], refetch: vi.fn() }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { energy: preferences.energy } }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: unknown, decimals = 2) => Number(value).toFixed(decimals),
    fmtInt: (value: unknown) => Number(value).toFixed(0),
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateShort: (value: string | null) => value ? value.slice(0, 10) : '—',
    formatTime: () => '12:00 AM',
  }),
}));
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { cloneElement } = await import('react');
  return {
    ...actual,
    chartAnimation: { isAnimationActive: false },
    // Only fix browser measurement; keep the real plot, table and presentation.
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 200 }),
  };
});

import { request } from '@/api/client';
import ChargeHistoryWidget from './ChargeHistoryWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

const requestMock = vi.mocked(request);
const full: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const packs = PACK_IDS
  .filter((pack): pack is Exclude<PackId, 'classic'> => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const clients: QueryClient[] = [];

type SessionFixture = Pick<ChargingSession,
  'id' | 'vehicle_id' | 'started_at' | 'charger_type' | 'is_home' | 'peak_power_w' | 'avg_power_w'
> & { total_energy_added_wh: number | null };

function session(id: number, energy: number | null, charger_type: string | null = null, is_home = false): SessionFixture {
  return {
    id, vehicle_id: 7, started_at: `2026-11-${String(id).padStart(2, '0')}T00:00:00Z`,
    total_energy_added_wh: energy, charger_type, is_home, peak_power_w: null, avg_power_w: null,
  };
}

const sessions = [
  session(6, 42_000, 'ac', true),
  session(5, null),
  session(4, 0, 'ac'),
  session(3, -2_000, 'supercharger'),
];

function renderWidget(pack: unknown, size = full) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <ChargeHistoryWidget vehicleId={7} size={size} config={{ timeRange: '7d' }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

function historyRows() {
  const table = screen.getByRole('table', { name: 'Charge history — data table' });
  return within(table).getAllByRole('row').slice(1).map(row =>
    within(row).getAllByRole('cell').map(cell => cell.textContent),
  );
}

async function expectPack(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="bars"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
}

beforeEach(() => {
  requestMock.mockReset();
  preferences.energy = 'kWh';
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe('ChargeHistoryWidget production design packs', () => {
  it.each(packs)('%s keeps the real history plot, readings, source identity and scope', async (pack, appearance) => {
    requestMock.mockResolvedValue(sessions);
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    expect(await screen.findByText('40.00')).toBeInTheDocument();
    expect(screen.getByText('42.00')).toBeInTheDocument();
    expect(screen.getByText('Last session')).toBeInTheDocument();
    expect(screen.getByText('Last 4 sessions')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('Session energy is historical, not live power.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Energy added per recent charge session, in kWh' })).toBeInTheDocument();
    expect(historyRows()).toEqual([
      ['2026-11-03', '-2.00 kWh'], ['2026-11-04', '0.00 kWh'],
      ['2026-11-05', '—'], ['2026-11-06', '42.00 kWh'],
    ]);
    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument();
    expect(container.querySelector('.recharts-xAxis')).toBeInTheDocument();
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('kWh');
    expect(screen.getAllByText('Home')).toHaveLength(2);
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('DC fast')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
    expect(container.querySelector('[role="meter"]')).not.toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
    const path = String(requestMock.mock.calls[0][0]);
    expect(path).toMatch(/^\/charging\?/);
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('limit')).toBe('10');
    expect(params.has('start')).toBe(true);
    expect(params.has('end')).toBe(true);
    expect(sessions.map(row => row.id)).toEqual([6, 5, 4, 3]);
  });

  it.each(packs)('%s preserves the compact signed total without adding a plot or fake scale', async (pack, appearance) => {
    requestMock.mockResolvedValue(sessions.slice(1));
    const { container } = renderWidget(pack, compact);
    await expectPack(container, appearance);
    expect(await screen.findByText('-2.00')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /energy added/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('[role="meter"]')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('switches all packs and recovers Classic without refetching or changing cached history', async () => {
    requestMock.mockResolvedValue(sessions);
    const { container, selectPack } = renderWidget('classic');
    expect(await screen.findByText('40.00')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.queryByText('Last session')).not.toBeInTheDocument();
    const rows = historyRows();
    for (const [pack, appearance] of packs) {
      selectPack(pack);
      await expectPack(container, appearance);
      expect(historyRows()).toEqual(rows);
    }
    for (const pack of ['classic', 'retired-pack', null] as const) {
      selectPack(pack);
      expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(screen.queryByText('Last session')).not.toBeInTheDocument();
      expect(screen.getByText('40.00')).toBeInTheDocument();
      expect(historyRows()).toEqual(rows);
    }
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(packs)('%s retains the selected presentation, plot and readings after a real refresh failure', async (pack, appearance) => {
    requestMock.mockResolvedValueOnce(sessions).mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    expect(await screen.findByText('40.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    await waitFor(() => expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale'));
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    expect(screen.getByText('40.00')).toBeInTheDocument();
    expect(screen.getByText('42.00')).toBeInTheDocument();
    expect(historyRows()).toHaveLength(4);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it.each(packs.flatMap(([pack, appearance]) =>
    [null, Number.NaN, Number.POSITIVE_INFINITY].map(energy => [pack, appearance, energy] as const),
  ))('%s (%s) keeps an unknown or invalid %s reading unknown, including its charger', async (pack, appearance, energy) => {
    requestMock.mockResolvedValue([session(6, energy)]);
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    await waitFor(() => expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial'));
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(historyRows()).toEqual([['2026-11-06', '—']]);
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getByText('Last 1 sessions')).toBeInTheDocument();
  });

  it.each(packs.flatMap(([pack, appearance]) =>
    [[pack, appearance, full], [pack, appearance, compact]] as const,
  ))(
    '%s (%s) preserves its %j source shell and honest empty state',
    async (pack, appearance, size) => {
      requestMock.mockResolvedValue([]);
      const { container } = renderWidget(pack, size);
      await expectPack(container, appearance);
      expect(await screen.findByText('No charge sessions yet')).toBeInTheDocument();
      await waitFor(() => expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'unavailable'));
      expect(screen.queryByRole('img', { name: /energy added/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText('0.00')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
    },
  );

  it.each(packs)('%s uses the display energy preference consistently for headline, samples and axes', async (pack, appearance) => {
    preferences.energy = 'Wh';
    requestMock.mockResolvedValue([session(6, 42_000)]);
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    expect(await screen.findByText('Energy added')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Energy added per recent charge session, in Wh' })).toBeInTheDocument();
    expect(historyRows()).toEqual([['2026-11-06', '42000.00 Wh']]);
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('Wh');
    expect(screen.queryByText('kWh')).not.toBeInTheDocument();
  });

  it.each(packs)('%s keeps loading, initial failure and retry in the controller-owned shell', async (pack, appearance) => {
    requestMock.mockRejectedValueOnce(new Error('Synthetic initial failure')).mockResolvedValueOnce(sessions);
    const { container } = renderWidget(pack);
    const shell = container.querySelector('[data-data-state]');
    expect(shell).toHaveAttribute('data-widget-pack', pack);
    expect(shell).toHaveAttribute('data-data-state', 'initial');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No charge sessions yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await waitFor(() => expect(shell).toHaveAttribute('data-data-state', 'initialFailure'));
    expect(shell).toHaveAttribute('data-widget-pack', pack);
    expect(shell).toHaveAttribute('aria-busy', 'false');
    expect(within(screen.getByTestId('widget-body')).getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('widget-body')).getByRole('button', { name: 'Retry' }));
    await expectPack(container, appearance);
    expect(await screen.findByText('40.00')).toBeInTheDocument();
    expect(historyRows()).toHaveLength(4);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
