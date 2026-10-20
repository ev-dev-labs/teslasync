import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { ChartContainerProps } from '@/components/charts';
import type { ChargingSession } from '@/types/charging';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { neonColorMap } from '@/lib/tokens';
import ChargerResiliencePage from './ChargerResiliencePage';

const h = vi.hoisted(() => ({
  query: {} as DataStateSource<ChargingSession[]> & { isLoading: boolean },
  chart: undefined as ChartContainerProps | undefined,
  refetch: vi.fn(),
  downloadCSV: vi.fn(),
  formatEnergy: vi.fn((wh: number) => `${wh} Wh`),
  unknownLocation: 'Unknown location',
  contextualHelp: true,
  translations: {} as Record<string, string>,
}));
vi.mock('@/hooks/useProductPreferences', () => ({
  useProductPreferences: () => ({ preferences: { contextualHelp: h.contextualHelp } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const defaultValue = typeof fallback === 'string' ? fallback : options?.defaultValue;
      const label = h.translations[key] ?? (key === 'chargerResilience.unknownLocation' ? h.unknownLocation
        : typeof defaultValue === 'string' ? defaultValue : key);
      return label.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
        options?.[name] == null ? match : String(options[name]));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: h.downloadCSV,
}));
vi.mock('@/api/hooks/useCharging', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useCharging')>(),
  useChargingHistory: () => h.query,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useUnits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useUnits')>();
  return {
    ...actual,
    useUnits: () => ({ ...actual.useUnits(), formatEnergy: h.formatEnergy }),
  };
});
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: (props: ChartContainerProps) => {
      h.chart = props;
      return <actual.ChartContainer {...props} />;
    },
  };
});

const longSite = 'Home charging location with a complete specialist label longer than twenty characters';
function session(id: string, place: string, wh: number): ChargingSession {
  const started = '2026-01-01T00:00:00Z';
  return {
    id, vehicle_id: '7', charger_type: 'AC', start_soc_pct: 30, end_soc_pct: 70,
    total_energy_added_wh: wh, peak_power_w: 7000, cost_decimal: null,
    started_at: started, ended_at: '2026-01-01T02:00:00Z',
    start_ts: started, startedAt: started, duration_min: 120,
    start_place: place, start_lat: null, start_lng: null,
  };
}
const sessions = [
  session('one', longSite, 10_000), session('two', longSite, 10_000),
  session('three', 'Backup station', 5000),
];
const preferences = getFormatterPreferences();
const clients: QueryClient[] = [];
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charger-resilience']}>
        <ChargerResiliencePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  h.chart = undefined;
  h.unknownLocation = 'Unknown location';
  h.contextualHelp = true;
  h.translations = {};
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  h.query = {
    data: sessions, error: null, isError: false, isLoading: false,
    isFetching: false, fetchStatus: 'idle', dataUpdatedAt: 1, refetch: h.refetch,
  };
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  setGlobalPrecision(preferences.precision);
  setGlobalLocale(preferences.locale);
});

describe('charger resilience page-local modernization', () => {
  it('localizes distinct contextual help names and preserves their explanations and preference', () => {
    h.translations = {
      'help.chargerResilience.scoreIconLabel': 'Informationen zum Resilienzwert',
      'help.chargerResilience.effectiveSitesIconLabel': 'Informationen zur effektiven Standortanzahl',
      'help.chargerResilience.whatIfIconLabel': 'Informationen zum hypothetischen Szenario',
    };
    const { rerender } = mountPage();
    const help = [
      ['Informationen zum Resilienzwert', 'A composite of three things:'],
      ['Informationen zur effektiven Standortanzahl', 'The reciprocal of the energy-weighted Herfindahl-Hirschman Index'],
      ['Informationen zum hypothetischen Szenario', 'A hypothetical, not a prediction:'],
    ];
    const assertHelp = () => {
      if (screen.queryByRole('dialog') == null) {
        fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
        expect(screen.getByRole('dialog', { name: 'Charger resilience metrics details' })).toBeInTheDocument();
      }
      for (const [name, explanation] of help) {
        const trigger = screen.getByRole('button', { name: name! });
        const tooltip = document.getElementById(trigger.getAttribute('aria-describedby')!);
        expect(tooltip).toHaveAttribute('role', 'tooltip');
        expect(tooltip).toHaveTextContent(explanation!);
      }
      expect(screen.queryByRole('button', { name: 'More info' })).not.toBeInTheDocument();
    };
    assertHelp();
    h.contextualHelp = false;
    rerender(
      <QueryClientProvider client={clients[clients.length - 1]!}>
        <MemoryRouter initialEntries={['/charger-resilience']}>
          <ChargerResiliencePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const [name] of help) {
      expect(screen.queryByRole('button', { name: name! })).not.toBeInTheDocument();
    }
    const face = document.getElementById('charger-resilience-metrics')!;
    expect(within(face).getByText('Resilience Score')).toBeInTheDocument();
    expect(within(face).getByText('Effective Site Count')).toBeInTheDocument();
    expect(screen.getByText('What if the Top site disappeared?')).toBeInTheDocument();
    h.contextualHelp = true;
    rerender(
      <QueryClientProvider client={clients[clients.length - 1]!}>
        <MemoryRouter initialEntries={['/charger-resilience']}>
          <ChargerResiliencePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    assertHelp();
  });

  it.each([true, false])('localizes the synthetic site across chart, export, detail and KPI (energy available: %s)', energyAvailable => {
    h.unknownLocation = 'Unbekannter Standort';
    h.query = { ...h.query, data: [
      { ...session('unknown', '', energyAvailable ? 100 : 0), charger_type: null },
      { ...session('unknown-again', '', energyAvailable ? 100 : 0), charger_type: null },
      session('named', 'Unknown location', energyAvailable ? 20 : 0),
      { ...session('typed', '', energyAvailable ? 10 : 0), charger_type: 'DC fast / CCS' },
    ] };
    mountPage();
    expect(h.chart?.data?.map(row => row.site)).toEqual([
      'Unbekannter Standort', 'Unknown location', 'DC fast / CCS',
    ]);
    expect(h.chart?.exportData).toEqual(h.chart?.data);
    const syntheticSite = screen.getAllByText('Unbekannter Standort').find(node => node.closest('li'))?.closest('li');
    expect(syntheticSite).toHaveTextContent('2 sessions');
    if (energyAvailable) {
      expect(screen.getAllByText('Unbekannter Standort').length).toBeGreaterThan(0);
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      const dialog = screen.getByRole('dialog', { name: 'Charger resilience metrics details' });
      expect(within(dialog).getAllByText('Unbekannter Standort — share of sessions, not energy').length).toBeGreaterThan(0);
    }
    expect(screen.getByText('New top site').nextElementSibling).toHaveTextContent('Unknown location');
  });

  it('localizes a synthetic runner-up without confusing it with no remaining site', () => {
    h.unknownLocation = 'Unbekannter Standort';
    h.query = { ...h.query, data: [
      session('home', 'Home', 100),
      { ...session('unknown', '', 20), charger_type: null },
    ] };
    mountPage();
    expect(screen.getByText('New top site').nextElementSibling).toHaveTextContent('Unbekannter Standort');
    expect(screen.queryByText('None yet')).not.toBeInTheDocument();
  });

  it.each([null, undefined, NaN, Infinity, 'bad'])('discloses invalid energy %s without hiding sites or inventing zero shares', energy => {
    h.query = { ...h.query, data: [
      Object.assign(session('missing', 'Home', 0), { total_energy_added_wh: energy }),
      session('backup', 'Backup', 0),
    ] };
    const { container } = mountPage();
    expect(screen.getAllByText('Energy denominator unavailable: some sessions have missing or invalid energy measurements.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Session-based fallback, not energy-weighted/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Energy share unavailable')).toHaveLength(2);
    expect(screen.getByText('Sites')).toBeInTheDocument();
    expect(screen.getByText('What if the Top site disappeared?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog', { name: 'Charger resilience metrics details' });
    expect(within(dialog).getByText('Session-based fallback, not energy-weighted; diversification uses the observed site count.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(3);
    expect(within(dialog).getByText(/^1 empty fields? (is|are) hidden\.$/)).toBeInTheDocument();
    expect(h.chart?.data?.map(row => row.share)).toEqual([null, null]);
    const chart = screen.getByRole('figure', { name: 'Energy share by site' });
    for (const row of within(chart).getAllByRole('row').slice(1)) {
      expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—');
      expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('1');
    }
  });

  it('explains measured zero and remaining sites without remaining energy', () => {
    h.query = { ...h.query, data: [session('home', 'Home', 10), session('backup', 'Backup', 0)] };
    mountPage();
    expect(screen.getByText(/Sites remain, but no positive recorded energy remains\./)).toBeInTheDocument();
    expect(screen.queryByText('No remaining sites after removing the top site.')).not.toBeInTheDocument();
    expect(screen.getByText('New top site').nextElementSibling).toHaveTextContent('Backup');
    expect(h.formatEnergy).toHaveBeenCalledWith(10);
    const chart = screen.getByRole('figure', { name: 'Energy share by site' });
    expect(within(within(chart).getAllByRole('row')[2]!).getAllByRole('cell')[1]).toHaveTextContent('0.00');
  });

  it('discloses measured-zero fallback separately from invalid energy', () => {
    h.query = { ...h.query, data: [session('home', 'Home', 0), session('backup', 'Backup', -0)] };
    mountPage();
    expect(screen.getAllByText('Energy denominator unavailable: no positive recorded energy.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Energy denominator unavailable: some sessions have missing or invalid energy measurements.')).not.toBeInTheDocument();
    expect(h.formatEnergy).toHaveBeenCalledWith(0);
  });

  it('passes signed fractional Wh unchanged to the display boundary', () => {
    h.query = { ...h.query, data: [
      session('home', 'Home', 0.75), session('adjustment', 'Home', -2.5),
      session('backup', 'Backup', 0.25),
    ] };
    mountPage();
    expect(h.formatEnergy).toHaveBeenCalledWith(-1.75);
    expect(h.chart?.data?.map(row => row.share)).toEqual([75, 25]);
  });

  it('preserves every scalar row and adds textual top-site identity to the table, export and site detail', () => {
    mountPage();
    const rows = [
      { site: longSite, share: 80, sessions: 2, dependency: 'Top-site dependency' },
      { site: 'Backup station', share: 20, sessions: 1, dependency: '—' },
    ];
    expect(h.chart?.data).toEqual(rows);
    expect(h.chart?.exportData).toEqual(rows);
    const chart = screen.getByRole('figure', { name: 'Energy share by site' });
    const tableRows = within(chart).getAllByRole('row');
    expect(tableRows).toHaveLength(3);
    expect(within(tableRows[1]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      longSite, '80.00', '2', 'Top-site dependency',
    ]);
    expect(within(tableRows[2]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      'Backup station', '20.00', '1', '—',
    ]);
    const siteRow = screen.getAllByText(longSite).find(node => node.closest('li'))?.closest('li');
    expect(siteRow).toHaveTextContent('Named place');
    expect(siteRow).toHaveTextContent('2 sessions');
    expect(siteRow).toHaveTextContent('80.00%');
    expect(siteRow).toHaveTextContent('Top-site dependency');
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    expect(screen.getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(h.downloadCSV).toHaveBeenCalledWith(expect.any(String),
      `site,share,sessions,dependency\r\n${longSite},80,2,Top-site dependency\r\nBackup station,20,1,—`);
  });

  it('localizes fractional shares while keeping counts integral and CSV values scalar', () => {
    setGlobalLocale('de-DE');
    h.query = { ...h.query, data: [
      session('home', longSite, 2), session('backup', 'Backup station', 1),
    ] };
    mountPage();
    expect(h.chart?.dataColumns?.filter(column => column.kind != null).map(column => [column.key, column.kind]))
      .toEqual([['share', 'measurement'], ['sessions', 'count']]);
    const chart = screen.getByRole('figure', { name: 'Energy share by site' });
    const rows = within(chart).getAllByRole('row');
    expect(within(rows[1]!).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual([longSite, '66,70', '1', 'Top-site dependency']);
    expect(within(rows[2]!).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['Backup station', '33,30', '1', '—']);
    expect(h.chart?.exportData?.map(row => [row.share, row.sessions])).toEqual([[66.7, 1], [33.3, 1]]);
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(h.downloadCSV).toHaveBeenCalledWith(expect.any(String),
      `site,share,sessions,dependency\r\n${longSite},66.7,1,Top-site dependency\r\nBackup station,33.3,1,—`);
  });

  it.each(['refresh-error', 'paused'] as const)('explains retained empty sections with one source recovery for %s', mode => {
    h.query = {
      ...h.query, data: [], error: mode === 'refresh-error' ? new Error('Refresh failed') : null,
      isError: mode === 'refresh-error', fetchStatus: mode === 'paused' ? 'paused' : 'idle',
    };
    const { container } = mountPage();
    expect(screen.getByText('What if the Top site disappeared?')).toBeInTheDocument();
    expect(screen.getByText('Sites')).toBeInTheDocument();
    expect(screen.getByText('Not enough data to model a loss scenario yet.')).toBeInTheDocument();
    expect(screen.getAllByText('No charging locations recorded yet.')).toHaveLength(2);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog', { name: 'Charger resilience metrics details' });
    expect(within(dialog).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: 'Retry' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('associates all what-if terms with locale-formatted values while passing unchanged Wh to display conversion', () => {
    setGlobalLocale('de-DE');
    const { container } = mountPage();
    const fields = [
      ['Energy at risk', '20000 Wh'], ['New top site', 'Backup station'],
      ['Score before', '22,00'], ['Score after loss', '0,00 (-22,00)'],
    ];
    for (const [term, value] of fields) {
      const label = screen.getByText(term!);
      expect(label.tagName).toBe('DT');
      expect(label.nextElementSibling?.tagName).toBe('DD');
      expect(label.nextElementSibling).toHaveTextContent(value!);
    }
    expect(container.querySelectorAll('dl dt')).toHaveLength(4);
    expect(h.formatEnergy).toHaveBeenCalledWith(20_000);
    expect(screen.getByText('0,00 (-22,00)')).toHaveClass(neonColorMap.red.text);
    expect(sessions.map(item => item.total_energy_added_wh)).toEqual([10_000, 10_000, 5000]);
  });

  it.each([
    { id: 'below', wh: 49, warning: false },
    { id: 'boundary', wh: 50, warning: true },
    { id: 'above', wh: 51, warning: true },
  ])('preserves the concentration warning threshold and quiets ordinary shares for $id', ({ wh, warning }) => {
    h.query = { ...h.query, data: [session('alpha', 'Alpha', wh), session('backup', 'Backup', 100 - wh)] };
    mountPage();
    const siteRow = screen.getAllByText('Alpha').find(node => node.closest('li'))?.closest('li');
    expect(siteRow).not.toBeNull();
    const share = within(siteRow!).getByText(`${wh.toFixed(2)}%`);
    expect(share).toHaveClass(warning ? 'text-[var(--semantic-warning)]' : 'text-[var(--text-secondary)]');
    expect(share).not.toHaveClass('text-[var(--semantic-info)]');
  });

  it('keeps measured zero scores and signed zero distinct from an empty history', () => {
    h.query = { ...h.query, data: [sessions[0]!] };
    const { container } = mountPage();
    expect(container.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByText('0.00 (+0.00)')).toHaveClass(neonColorMap.green.text);
    expect(screen.getByText('None yet')).toBeInTheDocument();
    expect(screen.getByText('No remaining sites after removing the top site.')).toBeInTheDocument();
    expect(screen.getByText('10000 Wh')).toBeInTheDocument();
  });
});
