import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { AppSettings } from '@/api/types';
import type { ConnectionPool, DBStats, MigrationStatus } from '@/types/admin';
import { formatDateTime } from '@/lib/dateFormat';
import { DBHealthSummary } from './DBHealthSummary';

vi.unmock('@/hooks/useSettings');
vi.unmock('@/lib/timezone');

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));
const settings: AppSettings = {
  locale: 'en-US', tz_display_default: 'user', timezone_user: 'UTC',
  decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
  unit_of_pressure: 'bar', currency_symbol: '$', preferred_range: 'rated', language: 'en',
  base_cost_per_kwh: 0.12, api_suspended: false, theme: 'neon-cyan', mode: 'dark',
  custom_primary: '#00b4d8', custom_accent: '#e63946', gas_price_per_unit: 0,
  gas_unit: 'gallon', gas_efficiency_mpg: 25, quiet_hours_enabled: false,
  quiet_hours_start: '22:00', quiet_hours_end: '07:00', alert_digest_mode: 'instant',
};
const stats: DBStats = { databaseSize: '512.25', tableCount: 0, tables: [] };
const migration: MigrationStatus = { currentVersion: '185', dirty: false, pending: 0, migrations: [] };
const pool: ConnectionPool = { maxOpen: 25, open: 10, inUse: 5, idle: 5, waitCount: 0, waitDurationMs: 0 };
const props = {
  stats: deriveDataState({ data: stats, dataUpdatedAt: 1000 }),
  migration: deriveDataState({ data: migration, dataUpdatedAt: 2000 }),
  pool: deriveDataState({ data: pool, dataUpdatedAt: 3000 }),
  statsLoading: false, migrationLoading: false, poolLoading: false,
  sizeBytes: 512.25, totalRows: 0, largeTables: 0, migrationVersion: '185', migrationDirty: false, poolUsage: 20,
};
const clients: QueryClient[] = [];
function renderSummary(overrides: Partial<Parameters<typeof DBHealthSummary>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, gcTime: Infinity } } });
  clients.push(client);
  client.setQueryData<AppSettings>(['settings'], settings);
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return { ...render(<DBHealthSummary {...props} {...overrides} />, { wrapper }), client };
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DB health canonical summary preservation', () => {
  it('renders exactly six typed tiles and preserves byte precision, zero counts and migration status context', () => {
    const { container } = renderSummary();
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(tiles).toHaveLength(6);
    expect(tiles.map(tile => tile.querySelector('[data-operational-value]')?.textContent))
      .toEqual(['512.25 B', '0', '0', '0', '185', '20.00%']);
    expect(tiles[3]).toHaveTextContent('> 100 MB');
    expect(tiles[4]).toHaveTextContent('Clean');
    expect(tiles[5].querySelector('[data-operational-value]')).toHaveTextContent('%');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(3);
    [1000, 2000, 3000].forEach((timestamp, index) => {
      expect(screen.getByTestId(`db-health-summary-${index}`)).toHaveTextContent(
        formatDateTime(new Date(timestamp), { locale: 'en-US', tz: 'UTC' }),
      );
    });
  });

  it('does not spread one source loading or refresh failure to the other sources', () => {
    renderSummary({
      stats: deriveDataState<DBStats>({ isLoading: true }), statsLoading: true,
      sizeBytes: null, totalRows: null, largeTables: null,
      migration: deriveDataState({ data: migration, error: new Error('migration failed') }),
    });
    expect(screen.getByTestId('db-health-summary-0').querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByTestId('db-health-summary-0')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('Retained source');
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('185');
    expect(screen.getByTestId('db-health-summary-2')).toHaveTextContent('Source loaded');
    expect(screen.getByTestId('db-health-summary-2').querySelector('[data-operational-value]')).toHaveTextContent('20.00%');
  });

  it('retains DB-specific fixed precision below a kilobyte instead of generic raw-byte notation', () => {
    const { container } = renderSummary({ sizeBytes: 512 });
    expect(container.querySelector('[data-operational-metric="db-total-size"] [data-operational-value]')).toHaveTextContent('512.00 B');
  });

  it('preserves zero bytes and zero pool usage but withholds absent statistics and migration health', () => {
    const { container, rerender } = renderSummary({ sizeBytes: 0, poolUsage: 0, migrationVersion: 0 });
    expect(container.querySelector('[data-operational-metric="db-total-size"] [data-operational-value]')).toHaveTextContent('0.00 B');
    expect(container.querySelector('[data-operational-metric="db-pool-usage"] [data-operational-value]')).toHaveTextContent('0.00%');
    expect(container.querySelector('[data-operational-metric="db-migration-version"] [data-operational-value]')).toHaveTextContent('0');
    rerender(<DBHealthSummary {...props}
      stats={deriveDataState<DBStats>({})} sizeBytes={null} totalRows={null} largeTables={null}
      migration={deriveDataState<MigrationStatus>({})} migrationVersion="—" migrationDirty={null}
      pool={deriveDataState<ConnectionPool>({})} poolUsage={null} />);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6);
    expect(screen.queryByText('Clean')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Last successful fetch time unknown/)).toHaveLength(3);
  });
  it('opens a real source review drawer while leaving the other independent briefs mounted', () => {
    renderSummary();
    fireEvent.click(screen.getAllByRole('button', { name: 'Review details' })[1]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('db-health-summary-0')).toBeInTheDocument();
    expect(screen.getByTestId('db-health-summary-2')).toBeInTheDocument();
  });

  it.each([
    ['en-GB', 'UTC'],
    ['en-US', 'Pacific/Honolulu'],
    ['de-DE', 'Europe/Berlin'],
  ])('reacts to real settings cache changes for locale %s and timezone %s without changing source successes', async (locale, tz) => {
    const timestamps = ['2026-10-13T01:05:00.000Z', '2026-10-13T14:20:00.000Z', '2026-10-14T00:35:00.000Z'];
    const sources = {
      stats: deriveDataState({ data: stats, dataUpdatedAt: Date.parse(timestamps[0]) }),
      migration: deriveDataState({ data: migration, dataUpdatedAt: Date.parse(timestamps[1]) }),
      pool: deriveDataState({ data: pool, dataUpdatedAt: Date.parse(timestamps[2]) }),
    };
    const iso = vi.spyOn(Date.prototype, 'toISOString');
    const { container, client } = renderSummary(sources);
    const before = timestamps.map((_, index) => screen.getByTestId(`db-health-summary-${index}`).textContent);
    await act(async () => {
      client.setQueryData<AppSettings>(['settings'], { ...settings, locale, timezone_user: tz });
    });
    expect(client.getQueryData<AppSettings>(['settings'])).toMatchObject({ locale, timezone_user: tz });
    expect(client.getQueryCache().find({ queryKey: ['settings'] })?.getObserversCount()).toBeGreaterThan(0);
    await waitFor(() => {
      timestamps.forEach((timestamp, index) => {
        const brief = screen.getByTestId(`db-health-summary-${index}`);
        expect(brief).toHaveTextContent(`Last successful fetch: ${formatDateTime(timestamp, { locale, tz })}.`);
        expect(brief).not.toHaveTextContent(timestamp);
        expect(brief).toHaveTextContent('This source is independent of the other database sources.');
        expect(brief).toHaveTextContent('Source loaded');
        expect(brief.textContent).not.toBe(before[index]);
      });
    });
    expect(screen.getByTestId('db-health-summary-1').textContent).toMatch(
      locale === 'en-US' ? /AM|PM/ : /14:20|16:20/,
    );
    expect(iso.mock.results.filter(result => result.type === 'return').map(result => result.value))
      .toEqual(expect.arrayContaining(timestamps));
    expect([sources.stats.updatedAt, sources.migration.updatedAt, sources.pool.updatedAt])
      .toEqual(timestamps.map(timestamp => Date.parse(timestamp)));
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getAllByRole('button', { name: 'Review details' })).toHaveLength(3);
  });

  it('retains independent last-success dates through refresh errors, in-flight refreshes and paused sources', () => {
    const timestamps = ['2026-10-13T01:05:00.000Z', '2026-10-13T14:20:00.000Z', '2026-10-14T00:35:00.000Z'];
    renderSummary({
      stats: deriveDataState({ data: stats, dataUpdatedAt: Date.parse(timestamps[0]), error: new Error('stats refresh failed') }),
      migration: deriveDataState({ data: migration, dataUpdatedAt: Date.parse(timestamps[1]), isFetching: true }),
      pool: deriveDataState({ data: pool, dataUpdatedAt: Date.parse(timestamps[2]), fetchStatus: 'paused' }),
    });
    timestamps.forEach((timestamp, index) => {
      const brief = screen.getByTestId(`db-health-summary-${index}`);
      expect(brief).toHaveTextContent(formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }));
      expect(brief).toHaveTextContent(index === 1 ? 'Refreshing source' : 'Retained source');
    });
    expect(screen.getAllByText('Showing retained measurements')).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent('stats refresh failed');
    expect(screen.getByTestId('db-health-summary-0').querySelector('[data-operational-value]')).toHaveTextContent('512.25 B');
    expect(screen.getByTestId('db-health-summary-1').querySelector('[data-operational-value]')).toHaveTextContent('185');
    expect(screen.getByTestId('db-health-summary-2').querySelector('[data-operational-value]')).toHaveTextContent('20.00%');
  });

  it('does not borrow a sibling timestamp or the clock for unknown retained or failed sources', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-04T12:00:00.000Z'));
    const timestamp = '2026-10-13T01:05:00.000Z';
    const { container } = renderSummary({
      stats: deriveDataState({ data: stats, dataUpdatedAt: Date.parse(timestamp) }),
      migration: deriveDataState({ data: migration, error: new Error('migration refresh failed') }),
      pool: deriveDataState<ConnectionPool>({ error: new Error('pool unavailable'), dataUpdatedAt: Date.parse(timestamp) }),
      poolUsage: null,
    });
    expect(screen.getByTestId('db-health-summary-0')).toHaveTextContent(formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }));
    [1, 2].forEach(index => {
      const brief = screen.getByTestId(`db-health-summary-${index}`);
      expect(brief).toHaveTextContent('Last successful fetch time unknown; this source is independent');
      expect(brief).not.toHaveTextContent(formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }));
      expect(brief).not.toHaveTextContent('2030');
    });
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('Retained source');
    expect(screen.getByTestId('db-health-summary-1').querySelector('[data-operational-value]')).toHaveTextContent('185');
    expect(screen.getByTestId('db-health-summary-2')).toHaveTextContent('Source unavailable');
    expect(container.querySelector('[data-operational-metric="db-pool-usage"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('preserves query zero-as-unknown but formats an explicitly supplied epoch observation instead of treating it as missing', () => {
    const { rerender } = renderSummary({ stats: deriveDataState({ data: stats, dataUpdatedAt: 0 }) });
    expect(screen.getByTestId('db-health-summary-0')).toHaveTextContent('Last successful fetch time unknown');
    rerender(<DBHealthSummary {...props} stats={{ ...props.stats, updatedAt: 0 }} />);
    expect(screen.getByTestId('db-health-summary-0')).toHaveTextContent(
      `Last successful fetch: ${formatDateTime(new Date(0), { locale: 'en-US', tz: 'UTC' })}.`,
    );
    expect(screen.getByTestId('db-health-summary-0')).not.toHaveTextContent('Last successful fetch time unknown');
  });

  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1])(
    'keeps invalid last-success timestamp %s unknown without losing retained metrics or sibling dates',
    updatedAt => {
      renderSummary({
        stats: { ...props.stats, updatedAt },
      });
      const brief = screen.getByTestId('db-health-summary-0');
      expect(brief).toHaveTextContent('Last successful fetch time unknown; this source is independent');
      expect(brief).not.toHaveTextContent('Last successful fetch:');
      expect(brief.querySelector('[data-operational-value]')).toHaveTextContent('512.25 B');
      [2000, 3000].forEach((timestamp, index) => {
        expect(screen.getByTestId(`db-health-summary-${index + 1}`)).toHaveTextContent(
          formatDateTime(new Date(timestamp), { locale: 'en-US', tz: 'UTC' }),
        );
      });
      expect(screen.getAllByRole('button', { name: 'Review details' })).toHaveLength(3);
    },
  );
});
