import type { ComponentProps, PropsWithChildren, ReactElement } from 'react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { ChartContainer, ChartTooltip, XAxis, YAxis } from '@/components/charts';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import { resolveTimezone } from '@/lib/timezone';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { objectsToCSV, toCSV } from '@/lib/csvExport';
import type { AlignmentStats } from '../components/charge-departure-alignment-modernization/AlignmentStats';
import type { AlignmentPairs } from '../components/charge-departure-alignment-modernization/AlignmentPairs';
import type { ChargeDepartureAlignmentSummary, DeparturePair } from '../lib/chargeDepartureAlignment';
import { chartTokens, typography } from '@/lib/tokens';
import { resolveChartPalette, type ChartPaletteId } from '@/hooks/useChartPalette';
import english from '@/i18n/en.json';
import ChargeDepartureAlignmentPage from './ChargeDepartureAlignmentPage';

vi.unmock('react-i18next');
vi.unmock('@/lib/timezone');

const source = vi.hoisted(() => ({
  sessions: {} as DataStateSource<Array<{ ended_at?: string | null }>>,
  drives: {} as DataStateSource<Array<{ startTs: string }>>,
  summary: {} as ChargeDepartureAlignmentSummary,
  chart: undefined as ComponentProps<typeof ChartContainer> | undefined,
  chargeRetry: vi.fn(),
  driveRetry: vi.fn(),
  chargeHook: vi.fn(),
  driveHook: vi.fn(),
  analyze: vi.fn(),
  hidden: vi.fn((key: string) => key === 'margin'),
  locale: 'en-US',
  mode: 'utc' as 'utc' | 'user' | 'vehicle',
  userZone: 'America/Los_Angeles',
  vehicleZone: 'Asia/Tokyo',
  tooltip: undefined as ComponentProps<typeof ChartTooltip> | undefined,
  axis: undefined as ComponentProps<typeof XAxis> | undefined,
  plotted: undefined as Array<{ dwellMin: number; margin: number | null }> | undefined,
  palette: 'cb_safe' as ChartPaletteId,
}));

vi.mock('@/hooks/useChartPalette', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useChartPalette')>(),
  useChartPalette: () => resolveChartPalette(source.palette),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: source.locale,
    settings: {
      tz_display_default: source.mode,
      timezone_user: source.userZone,
      currency_symbol: '$',
    },
  }),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingHistory: (vehicleId?: string) => {
    source.chargeHook(vehicleId);
    return source.sessions;
  },
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (vehicleId?: string) => {
    source.driveHook(vehicleId);
    return source.drives;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 4, vehicle: { timezone: source.vehicleZone } }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useHiddenSeries', () => ({
  useHiddenSeries: (key: string) => ({ chartKey: key, isHidden: source.hidden }),
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock('../lib/chargeDepartureAlignment', () => ({
  analyzeChargeDepartureAlignment: (...args: unknown[]) => {
    source.analyze(...args);
    return source.summary;
  },
}));
vi.mock('../components/charge-departure-alignment-modernization', async importOriginal => ({
  ...await importOriginal<typeof import('../components/charge-departure-alignment-modernization')>(),
  AlignmentStats: ({ historyContext }: ComponentProps<typeof AlignmentStats>) =>
    <section aria-label="KPI band">{historyContext}</section>,
  AlignmentPairs: ({ pairs }: ComponentProps<typeof AlignmentPairs>) =>
    <section aria-label="Recent Pairs"><output>{pairs.map(pair => pair.chargeId).join(',')}</output></section>,
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ChartContainer: (props: ComponentProps<typeof ChartContainer>) => {
    source.chart = props;
    return <section aria-label={props.title}>
      {props.empty && props.emptyIcon}
      {typeof props.children === 'function' ? null : props.children}
    </section>;
  },
  ResponsiveContainer: ({ children }: PropsWithChildren) => <>{children}</>,
  ComposedChart: ({ children, data }: PropsWithChildren<{ data: typeof source.plotted }>) => {
    source.plotted = data;
    return <>{children}</>;
  },
  CartesianGrid: ({ stroke }: { stroke?: string }) => <output data-testid="grid-stroke">{stroke}</output>,
  XAxis: (props: ComponentProps<typeof XAxis>) => {
    source.axis = props;
    return <output data-testid="x-tick">{JSON.stringify(props.tick)}</output>;
  },
  YAxis: ({ tick, yAxisId, domain, unit }: ComponentProps<typeof YAxis>) =>
    <output data-testid={`y-tick-${yAxisId}`}>{JSON.stringify({ tick, domain, unit })}</output>,
  Bar: ({ dataKey, hide, fill, children }: PropsWithChildren<{ dataKey: string; hide: boolean; fill?: string }>) =>
    <div data-testid={dataKey} data-hidden={hide} data-fill={fill}>{children}</div>,
  Line: ({ dataKey, hide, stroke }: { dataKey: string; hide: boolean; stroke?: string }) =>
    <div data-testid={dataKey} data-hidden={hide} data-stroke={stroke} />,
  Cell: ({ fill, fillOpacity }: { fill?: string; fillOpacity?: number }) =>
    <output data-testid="dwell-cell" data-fill={fill} data-opacity={fillOpacity} />,
  Tooltip: ({ content }: { content: ReactElement<ComponentProps<typeof ChartTooltip>> }) => {
    source.tooltip = content.props;
    return null;
  },
  ChartLegend: ({ state }: { state: { chartKey: string } }) =>
    <output data-testid="legend-key">{state.chartKey}</output>,
}));

let translations: i18n;

function mountPage() {
  return render(
    <I18nextProvider i18n={translations}>
      <MemoryRouter initialEntries={['/charge-departure-alignment']}>
        <ChargeDepartureAlignmentPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function pair(overrides: Partial<DeparturePair> = {}): DeparturePair {
  return {
    chargeId: 'test-charge-1', driveId: 1,
    chargeEndedMs: Date.parse('2026-09-01T09:00:00Z'),
    driveStartMs: Date.parse('2026-09-01T10:00:00Z'),
    dwellS: 3600, endSocPct: 80, driveStartSocPct: 79, driveEndSocPct: 45,
    socUsedPct: 34, socDriftPct: -1, readinessMarginPct: 45,
    earlyFullDwellS: 0, flags: [], ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  translations = createInstance();
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: { en: { translation: english } },
  });
  document.documentElement.style.setProperty('--font-scale', '1.5');
  document.documentElement.style.setProperty('--font-sans', 'Test Sans, sans-serif');
  source.sessions = {
    data: [{ ended_at: '2026-09-01T09:00:00Z' }, { ended_at: 'invalid' }],
    refetch: source.chargeRetry,
  };
  source.drives = { data: [{ startTs: '2026-09-01T10:00:00Z' }], refetch: source.driveRetry };
  source.summary = {
    pairs: [pair(), pair({
      chargeId: 'test-charge-2', driveId: 2, dwellS: 5400,
      readinessMarginPct: null, flags: ['soc_mismatch'],
    })],
    totalEndedCharges: 2, pairedCount: 2, unpairedCount: 0,
    avgDwellS: 4500, avgReadinessMarginPct: 45,
    misalignedCount: 1, misalignedRatePct: 50, totalEarlyFullDwellS: 0,
    tightMarginCount: 0, excessBufferCount: 0,
  };
  source.chart = undefined;
  source.locale = 'en-US';
  source.mode = 'utc';
  source.tooltip = undefined;
  source.axis = undefined;
  source.plotted = undefined;
  source.palette = 'cb_safe';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});
afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--font-scale');
  document.documentElement.style.removeProperty('--font-sans');
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('Charge departure page contract adoption', () => {
  it.each(['cb_safe', 'neon'] as const)(
    'applies the saved %s palette without changing series preferences or datasets',
    savedPalette => {
      source.palette = savedPalette === 'cb_safe' ? 'neon' : 'cb_safe';
      const sessionsBefore = structuredClone(source.sessions.data);
      const drivesBefore = structuredClone(source.drives.data);
      const summaryBefore = structuredClone(source.summary);
      const page = mountPage();
      const plottedBefore = structuredClone(source.plotted);
      const accessibleBefore = structuredClone(source.chart?.data);
      const csvDataBefore = structuredClone(source.chart?.exportData);
      const csvBefore = objectsToCSV(source.chart?.exportData ?? []);

      source.palette = savedPalette;
      page.rerender(
        <I18nextProvider i18n={translations}>
          <MemoryRouter initialEntries={['/charge-departure-alignment']}>
            <ChargeDepartureAlignmentPage />
          </MemoryRouter>
        </I18nextProvider>,
      );

      const palette = resolveChartPalette(savedPalette);
      expect(screen.getByTestId('dwellMin')).toHaveAttribute('data-fill', palette[0]);
      const cells = screen.getAllByTestId('dwell-cell');
      expect(cells[0]).toHaveAttribute('data-fill', palette[0]);
      expect(cells[0]).toHaveAttribute('data-opacity', '0.7');
      expect(cells[1]).toHaveAttribute('data-fill', palette[3]);
      expect(cells[1]).toHaveAttribute('data-opacity', '1');
      expect(screen.getByTestId('margin')).toHaveAttribute('data-stroke', palette[2]);
      expect(screen.getByTestId('dwellMin')).toHaveAttribute('data-hidden', 'false');
      expect(screen.getByTestId('margin')).toHaveAttribute('data-hidden', 'true');
      expect(screen.getByTestId('legend-key')).toHaveTextContent('charge-departure-alignment');
      expect(source.chart?.chartKey).toBe('charge-departure-alignment');
      expect(source.plotted).toEqual(plottedBefore);
      expect(source.chart?.data).toEqual(accessibleBefore);
      expect(source.chart?.exportData).toEqual(csvDataBefore);
      expect(objectsToCSV(source.chart?.exportData ?? [])).toBe(csvBefore);
      expect(source.sessions.data).toEqual(sessionsBefore);
      expect(source.drives.data).toEqual(drivesBefore);
      expect(source.summary).toEqual(summaryBefore);
      expect(source.analyze).toHaveBeenLastCalledWith(source.sessions.data, source.drives.data);
    },
  );

  it('updates scalar number formatting with decimal-comma preferences without changing chart measurements or CSV', () => {
    source.summary.pairs = [
      pair({ dwellS: 1234 * 60, readinessMarginPct: 45.678 }),
      pair({ dwellS: 0, readinessMarginPct: 0 }),
      pair({ readinessMarginPct: null }),
    ];
    const page = mountPage();
    const rawCSV = objectsToCSV(source.chart?.exportData ?? []);
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    page.rerender(
      <I18nextProvider i18n={translations}>
        <MemoryRouter initialEntries={['/charge-departure-alignment']}>
          <ChargeDepartureAlignmentPage />
        </MemoryRouter>
      </I18nextProvider>,
    );

    const columns = source.chart?.dataColumns;
    const dwell = columns?.find(column => column.key === 'dwellMin')?.format;
    const margin = columns?.find(column => column.key === 'margin')?.format;
    expect(dwell?.(1234)).toBe('1.234');
    expect(dwell?.(0)).toBe('0');
    expect(margin?.(45.678)).toBe('45,678');
    expect(margin?.(0)).toBe('0,000');
    for (const missing of [null, undefined, NaN, Infinity]) {
      expect(dwell?.(missing)).toBe('—');
      expect(margin?.(missing)).toBe('—');
    }
    expect(source.plotted?.map(({ dwellMin, margin }) => ({ dwellMin, margin }))).toEqual([
      { dwellMin: 1234, margin: 45.678 },
      { dwellMin: 0, margin: 0 },
      { dwellMin: 60, margin: null },
    ]);
    expect(source.chart?.data?.map(row => row.date)).toEqual([
      'Sep 1, 2026, 09:00:00 AM',
      'Sep 1, 2026, 09:00:00 AM',
      'Sep 1, 2026, 09:00:00 AM',
    ]);
    expect(source.chart?.exportData?.map(row => row.date)).toEqual([
      '2026-09-01T09:00:00.000Z',
      '2026-09-01T09:00:00.000Z',
      '2026-09-01T09:00:00.000Z',
    ]);
    expect(objectsToCSV(source.chart?.exportData ?? [])).toBe(rawCSV);
    expect(toCSV(source.chart?.exportData ?? [], [
      { key: 'dwellMin' }, { key: 'margin' },
    ])).toBe('dwellMin,margin\r\n1234,45.678\r\n0,0\r\n60,');
  });

  it('uses shared chart font and grid roles while preserving axes, series, legend and scalar exports', () => {
    mountPage();
    const tick = { fill: chartTokens.axisStroke, fontSize: 17, fontFamily: 'Test Sans, sans-serif' };
    expect(JSON.parse(screen.getByTestId('x-tick').textContent ?? '')).toEqual(tick);
    expect(JSON.parse(screen.getByTestId('y-tick-dwell').textContent ?? '')).toEqual({ tick });
    expect(JSON.parse(screen.getByTestId('y-tick-margin').textContent ?? '')).toEqual({
      tick, domain: [0, 100], unit: '%',
    });
    expect(screen.getByTestId('grid-stroke')).toHaveTextContent(chartTokens.gridStroke);
    expect(screen.getByTestId('dwellMin')).toHaveAttribute('data-hidden', 'false');
    expect(screen.getByTestId('margin')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByTestId('legend-key')).toHaveTextContent('charge-departure-alignment');
    expect(source.chart?.chartKey).toBe('charge-departure-alignment');
    expect(source.chart?.height).toBe(340);
    expect(source.chart?.dataColumns?.map(column => column.key)).toEqual(['date', 'dwellMin', 'margin', 'flags']);
    const friendly = formatDateTime('2026-09-01T09:00:00Z', { locale: 'en-US', tz: 'UTC', clock: { second: '2-digit' } });
    expect(source.chart?.data).toEqual([
      { date: friendly, dwellMin: 60, margin: 45, flags: 'Well matched' },
      { date: friendly, dwellMin: 90, margin: null, flags: 'Heuristic flags, not confirmed faults' },
    ]);
    expect(source.chart?.exportData).toEqual([
      { date: '2026-09-01T09:00:00.000Z', dwellMin: 60, margin: 45, flags: 'Well matched' },
      { date: '2026-09-01T09:00:00.000Z', dwellMin: 90, margin: null, flags: 'Heuristic flags, not confirmed faults' },
    ]);
    expect(source.chargeHook).toHaveBeenLastCalledWith('4');
    expect(source.driveHook).toHaveBeenLastCalledWith('4');
    expect(source.analyze).toHaveBeenLastCalledWith(source.sessions.data, source.drives.data);
    expect(screen.getByRole('region', { name: 'Recent Pairs' })).toHaveTextContent('test-charge-1,test-charge-2');
  });

  it('keeps semantic history labels and all count and observed-bound metadata in shared typography roles', () => {
    mountPage();
    const history = screen.getByRole('region', { name: 'KPI band' });
    const chargeLabel = within(history).getByText('Charging history', { selector: 'dt' });
    expect(chargeLabel).toHaveClass(...typography.role.label.split(' '));
    expect(chargeLabel.parentElement?.querySelectorAll('dd')).toHaveLength(2);
    const count = within(history).getByText('2 records loaded', { selector: 'dd' });
    expect(count).toHaveClass(...typography.role.caption.split(' '));
    expect(within(history).getByText('1 records loaded', { selector: 'dd' })).toBeInTheDocument();
    expect(history).toHaveTextContent('Observed charge-end timestamps');
    expect(history).toHaveTextContent('Observed drive-start timestamps');
    expect(history).toHaveTextContent('valid timestamp count: 1');
    expect(history).toHaveTextContent(formatDateTime('2026-09-01T09:00:00Z', {
      locale: 'en-US', tz: 'UTC', clock: { second: '2-digit' },
    }));
  });

  describe('Complete charge instants with saved display preferences', () => {
    it.each([
      ['utc', 'en-US'],
      ['user', 'en-GB'],
      ['vehicle', 'de-DE'],
    ] as const)('preserves year and time in %s mode with %s locale and keeps exact identity in CSV', (mode, locale) => {
      source.mode = mode;
      source.locale = locale;
      const instants = [
        '2025-12-31T23:30:45.123Z',
        '2026-01-01T23:30:45.123Z',
        '2026-11-01T08:30:00.000Z',
        '2026-11-01T09:30:00.000Z',
      ];
      source.summary.pairs = instants.map((date, index) => pair({
        chargeId: `charge-${index}`, driveId: index,
        chargeEndedMs: Date.parse(date),
      }));
      mountPage();
      const zone = resolveTimezone(mode, source.vehicleZone, source.userZone);
      const labels = instants.map(iso =>
        formatDateTime(iso, { locale, tz: zone, clock: { second: '2-digit' } }),
      );
      expect(source.chart?.data?.map(row => row.date)).toEqual(labels);
      expect(source.chart?.exportData?.map(row => row.date)).toEqual(instants);
      expect(new Set(source.chart?.exportData?.map(row => row.date)).size).toBe(instants.length);
      instants.forEach((iso, index) => {
        expect(source.tooltip?.labelFormatter?.(iso)).toBe(labels[index]);
        expect(source.axis?.tickFormatter?.(iso, index)).toBe(formatDateShort(iso, { locale, tz: zone }));
      });
      expect(source.tooltip?.labelFormatter?.(undefined)).toBe('—');
      expect(source.chart?.subtitle).toContain('Chart timestamps use your selected time zone.');
      expect(source.chart?.subtitle).toContain('Pairing uses elapsed instants within 24 hours');
      expect(source.analyze).toHaveBeenLastCalledWith(source.sessions.data, source.drives.data);
    });
  });

  it.each(['initial', 'empty', 'fatal', 'retained', 'paused'] as const)(
    'keeps all three sections and independent source recovery for %s history',
    state => {
      if (state === 'initial') {
        source.sessions = { isLoading: true, refetch: source.chargeRetry };
      } else if (state === 'empty') {
        source.sessions.data = [];
        source.drives.data = [];
        source.summary.pairs = [];
      } else if (state === 'fatal') {
        source.sessions = { error: new Error('Test initial failure'), refetch: source.chargeRetry };
      } else if (state === 'retained') {
        source.sessions.error = new Error('Test refresh failure');
      } else {
        source.sessions = { fetchStatus: 'paused', refetch: source.chargeRetry };
      }
      const result = mountPage();
      expect(screen.getByRole('region', { name: 'KPI band' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: english.chargeDepartureAlignment.chart })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Recent Pairs' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'KPI band' })).not.toHaveTextContent('undefined records loaded');
      expect(source.chart?.loading).toBe(state === 'initial');
      expect(source.chart?.error != null).toBe(state === 'fatal');
      if (state === 'empty') {
        const icon = screen.getByRole('region', { name: english.chargeDepartureAlignment.chart }).querySelector('svg');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
        expect(icon).toHaveClass('h-6', 'w-6', 'shrink-0');
        expect(source.chart?.empty).toBe(true);
        expect(source.chart?.exportData).toEqual([]);
        expect(screen.getByRole('region', { name: 'KPI band' })).toHaveTextContent('0 records loaded');
      }
      if (state === 'fatal' || state === 'paused' || state === 'retained') {
        const recovery = result.container.querySelector<HTMLElement>('[data-alignment-source="charging-history"]');
        if (!recovery) throw new Error('Charging recovery section missing');
        fireEvent.click(within(recovery).getByRole('button', {
          name: state === 'retained' ? 'Refresh' : 'Retry',
        }));
        expect(source.chargeRetry).toHaveBeenCalledTimes(1);
        expect(source.driveRetry).not.toHaveBeenCalled();
      }
      if (state === 'initial' || state === 'fatal' || state === 'paused') {
        expect(screen.getByRole('region', { name: 'KPI band' })).toHaveTextContent('— records loaded');
        expect(screen.getByRole('region', { name: 'KPI band' })).toHaveTextContent('1 records loaded');
      }
      if (state === 'retained') {
        expect(source.chart?.exportData).toHaveLength(2);
        expect(screen.getByRole('region', { name: 'Recent Pairs' })).toHaveTextContent('test-charge-1,test-charge-2');
      }
    },
  );
});
