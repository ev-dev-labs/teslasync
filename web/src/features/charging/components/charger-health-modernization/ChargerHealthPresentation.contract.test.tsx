import { createElement, type ComponentProps, type PropsWithChildren } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChartContainer } from '@/components/charts';
import type { DataTable } from '@/components/ui';
import type { FadeIn } from '@/components/motion';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { ChargerHealthSummary, ChargerSite } from '../../lib/chargerHealth';
import { ChargerHealthStats } from './ChargerHealthStats';
import { ChargerHealthLocations } from './ChargerHealthLocations';
import { ChargerHealthChart } from './ChargerHealthChart';
import ChargerHealthPage from '../../pages/ChargerHealthPage';

const fixture = vi.hoisted(() => ({
  locale: 'de-DE',
  timezone: 'America/Los_Angeles',
  translated: false,
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<ChargingSession[]>,
  sessionsHook: vi.fn(),
  retry: vi.fn(),
  chart: null as ComponentProps<typeof ChartContainer> | null,
  table: null as ComponentProps<typeof DataTable<ChargerSite>> | null,
}));
vi.mock('react-i18next', async importOriginal => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  const { createInstance } = await import('i18next');
  const i18n = createInstance();
  await i18n.init({
    lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
    resources: {
      de: { translation: { chargerHealth: { status: {
        healthy: 'Gesund', degrading: 'Nachlassend', degraded: 'Beeinträchtigt',
        unknown: 'Nicht genug Daten',
      } } } },
    },
  });
  return {
    ...actual,
    useTranslation: () => ({ t: i18n.getFixedT(fixture.translated ? 'de' : 'en'), i18n }),
  };
});
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      locale: fixture.locale, decimal_precision: 2, unit_of_length: 'km',
      unit_of_temp: 'C', unit_of_pressure: 'bar', tz_display_default: 'user',
      timezone_user: fixture.timezone, currency_symbol: '$', base_cost_per_kwh: 0.12,
    },
    locale: fixture.locale, decimals: 2, density: 'comfortable',
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: fixture.vehicleId, vehicle: { timezone: 'UTC' } }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: (...args: unknown[]) => {
    fixture.sessionsHook(...args);
    return fixture.query;
  },
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children, className }: ComponentProps<typeof FadeIn>) =>
      createElement('div', { className }, children),
  };
});
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const passthrough = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    ...actual,
    ChartContainer: (props: ComponentProps<typeof ChartContainer>) => {
      fixture.chart = props;
      return createElement(actual.ChartContainer, props);
    },
    ResponsiveContainer: passthrough, BarChart: passthrough, Bar: passthrough,
    Cell: () => null, CartesianGrid: () => null, XAxis: () => null,
    YAxis: () => null, Tooltip: () => null, ReferenceLine: () => null,
  };
});
vi.mock('@/components/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    DataTable: (props: ComponentProps<typeof DataTable<ChargerSite>>) => {
      fixture.table = props;
      return createElement(actual.DataTable<ChargerSite>, props);
    },
  };
});

function site(overrides: Partial<ChargerSite> = {}): ChargerSite {
  return {
    key: 'place:synthetic group', label: 'Synthetic group', lat: null, lng: null,
    kind: 'ac', sessions: 5, ratedSessions: 4,
    firstSeenMs: Date.parse('2026-09-01T00:30:00Z'),
    lastSeenMs: Date.parse('2026-09-05T00:30:00Z'),
    baselineW: 11_100, recentW: 9_700, performanceRatio: 0.875,
    totalEnergyWh: 55_000, status: 'degrading', hoursLostPerYear: 12.4,
    history: [], ...overrides,
  };
}
function summary(sites: ChargerSite[] = [site()]): ChargerHealthSummary {
  const judged = sites.filter(item => item.status !== 'unknown');
  return {
    sites, degradedCount: judged.filter(item => item.status !== 'healthy').length,
    fastestSite: judged[0] ?? null, primarySite: sites[0] ?? null,
    totalSessions: 7, usableSessions: 5,
  };
}
function sourceState(source: DataStateSource<unknown> = { data: [] }) {
  return deriveDataState({ refetch: fixture.retry, ...source }, { provenance: 'historical' });
}
function mount(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children: content }: PropsWithChildren) {
    return <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charger-health?existing=kept']}>{content}</MemoryRouter>
    </QueryClientProvider>;
  }
  return render(children, { wrapper: Wrapper });
}
function tableProps() {
  if (!fixture.table) throw new Error('Location table not rendered');
  return fixture.table;
}
function chartProps() {
  if (!fixture.chart) throw new Error('Chart not rendered');
  return fixture.chart;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.locale = 'de-DE';
  fixture.timezone = 'America/Los_Angeles';
  fixture.translated = false;
  fixture.vehicleId = 7;
  fixture.query = { data: [], fetchStatus: 'idle', refetch: fixture.retry };
  fixture.chart = null;
  fixture.table = null;
});
afterEach(cleanup);

describe('Charger Health confirmed presentation contracts', () => {
  it('separates returned, admitted, clean and excluded denominators without changing metrics', () => {
    const { container } = mount(<ChargerHealthStats summary={summary()} state={sourceState()} loading={false} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Charger health metrics details' });
    expect(within(details).getByText(/4 scorable sessions/)).toBeInTheDocument();
    expect(screen.getByText(/Returned sessions: 7; model-admitted: 5; clean for scoring: 4; excluded before admission: 2/))
      .toBeInTheDocument();
    expect(screen.getByText(/Admitted tapered sessions contribute to usage, not scoring/)).toBeInTheDocument();
  });

  it('localizes grouped denominator counts at the display boundary', () => {
    const data = { ...summary([site({ ratedSessions: 1000 })]), totalSessions: 1200, usableSessions: 1100 };
    mount(<ChargerHealthStats summary={data} state={sourceState()} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Charger health metrics details' });
    expect(within(details).getByText(/1\.000 scorable sessions/)).toBeInTheDocument();
    expect(screen.getByText(/Returned sessions: 1\.200; model-admitted: 1\.100/)).toBeInTheDocument();
  });

  it.each([
    { status: 'healthy' as const, valueState: 'value', expected: '0' },
    { status: 'unknown' as const, valueState: 'missing', expected: '—' },
  ])('keeps $status aggregate underperformance and annual loss distinct from unknown', ({ status, valueState, expected }) => {
    const { container } = mount(<ChargerHealthStats
      summary={summary([site({ status, hoursLostPerYear: 0 })])}
      state={sourceState()} loading={false}
    />);
    if (valueState === 'missing') {
      // Face-value disclosure: unknown tiles are omitted from the face while
      // the valued site count stays visible; the drawer counts the hidden.
      for (const id of ['charger-health-underperforming', 'charger-health-time-lost']) {
        expect(container.querySelector(`[data-operational-metric="${id}"]`)).toBeNull();
      }
      expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
      expect(container.querySelector('[data-operational-metric="charger-health-sites"] [data-operational-value]'))
        .toHaveTextContent('1');
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      const details = screen.getByRole('dialog', { name: 'Charger health metrics details' });
      expect(within(details).getByText('3 empty fields are hidden.')).toBeInTheDocument();
      return;
    }
    for (const id of ['charger-health-underperforming', 'charger-health-time-lost']) {
      const tile = container.querySelector(`[data-operational-metric="${id}"]`);
      expect(tile).toHaveAttribute('data-value-state', valueState);
      expect(tile?.querySelector('[data-operational-value]')).toHaveTextContent(expected);
    }
  });

  it.each([
    ['healthy', 0, '0 h/year'],
    ['degrading', 0.4, '0 h/year'],
    ['degraded', 1200.4, '1.200 h/year'],
    ['unknown', 0, '—'],
  ] as const)('distinguishes %s modeled loss %s from unrated unknown', (status, hoursLostPerYear, expected) => {
    const datum = site({ status, hoursLostPerYear });
    mount(<ChargerHealthLocations summary={summary([datum])} state={sourceState()} loading={false} />);
    const table = tableProps();
    const cost = table.columns.find(column => column.key === 'cost');
    expect(cost?.render(datum)).toBe(expected);
    expect(table.mobilePresentation?.displayValue?.(datum, 'cost')).toBe(expected);
    expect(screen.getByText(/Annual time loss is a model estimate/)).toBeInTheDocument();
  });

  it('preserves all nine location facts and complete mobile display values', () => {
    const datum = site();
    mount(<ChargerHealthLocations summary={summary([datum])} state={sourceState()} loading={false} />);
    const table = tableProps();
    expect(table.columns.map(column => column.key)).toEqual([
      'label', 'status', 'kind', 'baseline', 'recent', 'energy', 'visits', 'lastSeen', 'cost',
    ]);
    for (const column of table.columns) {
      expect(table.mobilePresentation?.displayValue?.(datum, column.key)).not.toBeNull();
    }
    expect(table).toMatchObject({
      tableId: 'charging:charger-health-locations', pagination: false,
      searchable: false, exportable: false, mobileColumns: ['label', 'status', 'recent'],
    });
    expect(table.mobilePresentation?.displayValue?.(datum, 'visits')).toBe('5 (4 scored)');
    expect(screen.getByText(/Visits, energy and last visit describe model-admitted sessions only/)).toBeInTheDocument();
  });

  it('uses saved locale and timezone for midnight-adjacent admitted visit dates', () => {
    const datum = site({ lastSeenMs: Date.parse('2026-09-01T00:30:00Z') });
    const result = mount(<ChargerHealthLocations summary={summary([datum])} state={sourceState()} loading={false} />);
    expect(tableProps().mobilePresentation?.displayValue?.(datum, 'lastSeen')).toBe('31. Aug.');
    fixture.timezone = 'UTC';
    fixture.locale = 'en-US';
    result.rerender(<ChargerHealthLocations summary={summary([datum])} state={sourceState()} loading={false} />);
    expect(tableProps().mobilePresentation?.displayValue?.(datum, 'lastSeen')).toBe('Sep 1');
  });

  it('describes approximate groups and inferred mixed class without stall-recognition promises', () => {
    mount(<ChargerHealthLocations summary={summary()} state={sourceState()} loading={false} />);
    fireEvent.focus(screen.getByRole('button', { name: 'More info about site grouping' }));
    expect(screen.getByText(/case-insensitive place name/)).toBeInTheDocument();
    expect(screen.getByText(/A group can combine multiple stalls and AC \/ DC sessions/)).toBeInTheDocument();
    expect(screen.queryByText(/same physical stall is recognised/)).not.toBeInTheDocument();
  });

  it('localizes accessible numeric and status cells while retaining raw CSV values and row order', () => {
    const sites = [
      site({ status: 'degraded', label: 'Synthetic degraded' }),
      site({ status: 'degrading', label: 'Synthetic slipping' }),
      site({ status: 'healthy', label: 'Synthetic healthy' }),
      site({ status: 'unknown', label: 'Synthetic unrated' }),
    ];
    mount(<ChargerHealthChart summary={summary(sites)} state={sourceState()} loading={false} />);
    const figure = screen.getByRole('figure', { name: 'Recent Power vs. Own Baseline' });
    const alternative = within(figure).getByRole('table');
    for (const value of ['87,5', '11,1', '9,7', 'Healthy', 'Slipping', 'Degraded']) {
      expect(alternative).toHaveTextContent(value);
    }
    expect(alternative).not.toHaveTextContent('Synthetic unrated');
    expect(chartProps().exportData).toEqual(sites.slice(0, 3).map(datum => ({
      site: datum.label, ratio: 87.5, baseline: 11.1, recent: 9.7, status: datum.status,
    })));
    expect(chartProps().data).toEqual(chartProps().exportData);
    expect(sites[0]?.baselineW).toBe(11_100);
    expect(sites[0]?.recentW).toBe(9_700);
  });

  it('does not fabricate chart alternative readings for invalid numeric values', () => {
    mount(<ChargerHealthChart summary={summary()} state={sourceState()} loading={false} />);
    const format = chartProps().dataColumns?.find(column => column.key === 'ratio')?.format;
    for (const value of [null, undefined, NaN, Infinity, '87.5']) expect(format?.(value)).toBe('—');
    expect(format?.(0)).toBe('0,0');
  });

  it('translates visible chart and location statuses without translating raw CSV enums', () => {
    fixture.translated = true;
    const sites = [
      site({ key: 'degraded', status: 'degraded', label: 'Synthetic degraded' }),
      site({ key: 'slipping', status: 'degrading', label: 'Synthetic slipping' }),
      site({ key: 'healthy', status: 'healthy', label: 'Synthetic healthy' }),
      site({ key: 'unknown', status: 'unknown', label: 'Synthetic unknown' }),
    ];
    mount(<>
      <ChargerHealthChart summary={summary(sites)} state={sourceState()} loading={false} />
      <ChargerHealthLocations summary={summary(sites)} state={sourceState()} loading={false} />
    </>);
    const alternative = within(screen.getByRole('figure', { name: 'Recent Power vs. Own Baseline' }))
      .getByRole('table');
    for (const label of ['Gesund', 'Nachlassend', 'Beeinträchtigt']) {
      expect(alternative).toHaveTextContent(label);
    }
    for (const [index, label] of ['Beeinträchtigt', 'Nachlassend', 'Gesund', 'Nicht genug Daten'].entries()) {
      expect(tableProps().mobilePresentation?.displayValue?.(sites[index]!, 'status')).toBe(label);
    }
    expect(chartProps().exportData?.map(row => row.status)).toEqual(['degraded', 'degrading', 'healthy']);
    expect(chartProps().exportData?.map(row => Object.keys(row))).toEqual(
      sites.slice(0, 3).map(() => ['site', 'ratio', 'baseline', 'recent', 'status']),
    );
  });

  it.each([
    { name: 'refresh failure', source: { data: [], error: new Error('refresh'), isError: true } },
    { name: 'paused refresh', source: { data: [], fetchStatus: 'paused' as const } },
  ])('retains all three sections and source-specific retry on $name', ({ source }) => {
    const state = sourceState(source);
    const data = summary();
    const { container } = mount(<>
      <ChargerHealthStats summary={data} state={state} loading={false} />
      <ChargerHealthChart summary={data} state={state} loading={false} />
      <ChargerHealthLocations summary={data} state={state} loading={false} />
    </>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(chartProps().error).toBeNull();
    expect(chartProps().exportData).toHaveLength(1);
    expect(tableProps().data).toEqual(data.sites);
    const notices = screen.getAllByTestId('stale-refresh-warning');
    expect(notices).toHaveLength(3);
    fireEvent.click(within(notices[0]!).getByRole('button', { name: 'Refresh' }));
    expect(fixture.retry).toHaveBeenCalledOnce();
    expect(state.provenance).toBe('historical');
  });

  it('keeps the existing selected-vehicle query with no added bounds or producer substitution', () => {
    const { container } = mount(<ChargerHealthPage />);
    expect(fixture.sessionsHook).toHaveBeenLastCalledWith('7');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    const stats = container.querySelector('#charger-health-metrics') as HTMLElement;
    fireEvent.click(within(stats).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Charger health metrics details' });
    expect(within(details).getByText('3 empty fields are hidden.')).toBeInTheDocument();
    expect(screen.getByText(/individual stalls and charger faults are not identified/)).toBeInTheDocument();
    expect(chartProps().exportData).toEqual([]);
    expect(screen.getByText('No charging locations recorded yet.')).toBeInTheDocument();
  });
});
