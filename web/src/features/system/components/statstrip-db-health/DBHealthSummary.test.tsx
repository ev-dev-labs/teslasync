import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
      // Honor i18next plural defaults like the shared global mock does, so
      // counted drawer explanations render their real singular/plural forms.
      let template = fallback;
      if (vars && typeof vars.count === 'number') {
        if (vars.count === 1 && typeof vars.defaultValue_one === 'string') template = vars.defaultValue_one;
        else if (typeof vars.defaultValue_other === 'string') template = vars.defaultValue_other;
      }
      return template.replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match);
    },
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

// Open one brief's real Review-details dialog, run group/detail assertions
// against it, then close it again.
function withDrawer(strip: HTMLElement, assert: (dialog: HTMLElement) => void): void {
  expect(screen.queryByRole('dialog'), 'Finish any open interaction before inspecting evidence').not.toBeInTheDocument();
  fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    assert(dialog);
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    expect(tiles[5].querySelector('[data-operational-value]')).toHaveTextContent('%');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(3);
    // Metric context lives in the drawer groups, not on the value-only face.
    withDrawer(screen.getByTestId('db-health-summary-0'), (dialog) => {
      expect(within(dialog).getByRole('group', { name: 'Large tables' })).toHaveTextContent('> 100 MB');
    });
    withDrawer(screen.getByTestId('db-health-summary-1'), (dialog) => {
      expect(within(dialog).getByRole('group', { name: 'Migration' })).toHaveTextContent('Clean');
    });
    [1000, 2000, 3000].forEach((timestamp, index) => {
      assertOperationalBriefDisclosure(screen.getByTestId(`db-health-summary-${index}`),
        formatDateTime(new Date(timestamp), { locale: 'en-US', tz: 'UTC' }), { contains: true });
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
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-1'), 'Retained source', { contains: true });
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('185');
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-2'), 'Source loaded', { contains: true });
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
    // Every tile is omitted; each brief shows the empty state and counts its
    // hidden fields in the drawer (4 + 1 + 1 = 6 withheld readings).
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    [0, 1, 2].forEach((index) => {
      expect(screen.getByTestId(`db-health-summary-${index}`)).toHaveTextContent('No metric values are available yet.');
      assertOperationalBriefDisclosure(screen.getByTestId(`db-health-summary-${index}`), 'Last successful fetch time unknown', { contains: true });
    });
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-0'), 'Total DB size');
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-1'), 'Migration');
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-2'), 'Pool usage');
    withDrawer(screen.getByTestId('db-health-summary-0'), (dialog) => {
      expect(within(dialog).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    });
    withDrawer(screen.getByTestId('db-health-summary-1'), (dialog) => {
      expect(within(dialog).getByText('1 empty field is hidden.')).toBeInTheDocument();
    });
    withDrawer(screen.getByTestId('db-health-summary-2'), (dialog) => {
      expect(within(dialog).getByText('1 empty field is hidden.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Clean')).not.toBeInTheDocument();
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
    // Source dates live in the drawer headers now; snapshot them there so the
    // settings-change reaction below compares the surface that shows them.
    const headerText = (index: number): string | null => {
      const brief = screen.getByTestId(`db-health-summary-${index}`);
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const dialog = screen.getByRole('dialog');
      const text = dialog.querySelector('[data-drawer-header]')?.textContent ?? null;
      fireEvent.keyDown(dialog, { key: 'Escape' });
      return text;
    };
    const before = [0, 1, 2].map(headerText);
    await act(async () => {
      client.setQueryData<AppSettings>(['settings'], { ...settings, locale, timezone_user: tz });
    });
    expect(client.getQueryData<AppSettings>(['settings'])).toMatchObject({ locale, timezone_user: tz });
    expect(client.getQueryCache().find({ queryKey: ['settings'] })?.getObserversCount()).toBeGreaterThan(0);
    // Open each drawer once and wait for its live header to adopt the new
    // locale; polling drawer open/close cycles never settles.
    for (const [index, timestamp] of timestamps.entries()) {
      const brief = screen.getByTestId(`db-health-summary-${index}`);
      expect(brief).not.toHaveTextContent(timestamp);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const dialog = screen.getByRole('dialog');
      try {
        const header = () => dialog.querySelector('[data-drawer-header]') as HTMLElement;
        await waitFor(() => {
          expect(header()).toHaveTextContent(`Last successful fetch: ${formatDateTime(timestamp, { locale, tz })}.`);
        });
        expect(header()).not.toHaveTextContent(timestamp);
        expect(header()).toHaveTextContent('This source is independent of the other database sources.');
        expect(header()).toHaveTextContent('Source loaded');
        expect(header().textContent).not.toBe(before[index]);
      } finally {
        fireEvent.keyDown(dialog, { key: 'Escape' });
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    withDrawer(screen.getByTestId('db-health-summary-1'), (dialog) => {
      expect((dialog.querySelector('[data-drawer-header]') as HTMLElement).textContent).toMatch(
        locale === 'en-US' ? /AM|PM/ : /14:20|16:20/,
      );
    });
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
      assertOperationalBriefDisclosure(brief, formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }), { contains: true });
      assertOperationalBriefDisclosure(brief, index === 1 ? 'Refreshing source' : 'Retained source', { contains: true });
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
    renderSummary({
      stats: deriveDataState({ data: stats, dataUpdatedAt: Date.parse(timestamp) }),
      migration: deriveDataState({ data: migration, error: new Error('migration refresh failed') }),
      pool: deriveDataState<ConnectionPool>({ error: new Error('pool unavailable'), dataUpdatedAt: Date.parse(timestamp) }),
      poolUsage: null,
    });
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-0'), formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }), { contains: true });
    [1, 2].forEach(index => {
      const brief = screen.getByTestId(`db-health-summary-${index}`);
      assertOperationalBriefDisclosure(brief, 'Last successful fetch time unknown; this source is independent', { contains: true });
      assertOperationalBriefDisclosure(brief, formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }), { contains: true, absent: true });
      assertOperationalBriefDisclosure(brief, '2030', { contains: true, absent: true });
      expect(brief).not.toHaveTextContent(formatDateTime(timestamp, { locale: 'en-US', tz: 'UTC' }));
      expect(brief).not.toHaveTextContent('2030');
    });
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-1'), 'Retained source', { contains: true });
    expect(screen.getByTestId('db-health-summary-1').querySelector('[data-operational-value]')).toHaveTextContent('185');
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-2'), 'Source unavailable', { contains: true });
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-2'), 'Pool usage');
  });

  it('preserves query zero-as-unknown but formats an explicitly supplied epoch observation instead of treating it as missing', () => {
    const { rerender } = renderSummary({ stats: deriveDataState({ data: stats, dataUpdatedAt: 0 }) });
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-0'), 'Last successful fetch time unknown', { contains: true });
    rerender(<DBHealthSummary {...props} stats={{ ...props.stats, updatedAt: 0 }} />);
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-0'),
      `Last successful fetch: ${formatDateTime(new Date(0), { locale: 'en-US', tz: 'UTC' })}.`, { contains: true });
    assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-0'), 'Last successful fetch time unknown', { contains: true, absent: true });
  });

  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1])(
    'keeps invalid last-success timestamp %s unknown without losing retained metrics or sibling dates',
    updatedAt => {
      renderSummary({
        stats: { ...props.stats, updatedAt },
      });
      const brief = screen.getByTestId('db-health-summary-0');
      assertOperationalBriefDisclosure(brief, 'Last successful fetch time unknown; this source is independent', { contains: true });
      assertOperationalBriefDisclosure(brief, 'Last successful fetch:', { contains: true, absent: true });
      expect(brief.querySelector('[data-operational-value]')).toHaveTextContent('512.25 B');
      [2000, 3000].forEach((timestamp, index) => {
        assertOperationalBriefDisclosure(screen.getByTestId(`db-health-summary-${index + 1}`),
          formatDateTime(new Date(timestamp), { locale: 'en-US', tz: 'UTC' }), { contains: true });
      });
      expect(screen.getAllByRole('button', { name: 'Review details' })).toHaveLength(3);
    },
  );
});
