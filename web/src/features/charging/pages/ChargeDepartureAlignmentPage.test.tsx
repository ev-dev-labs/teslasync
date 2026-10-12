import type { ComponentProps, PropsWithChildren } from 'react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { ChartContainer, XAxis, YAxis } from '@/components/charts';
import type { AlignmentStats } from '../components/charge-departure-alignment-modernization/AlignmentStats';
import type { AlignmentPairs } from '../components/charge-departure-alignment-modernization/AlignmentPairs';
import type { ChargeDepartureAlignmentSummary, DeparturePair } from '../lib/chargeDepartureAlignment';
import { chartTokens, typography } from '@/lib/tokens';
import english from '@/i18n/en.json';
import ChargeDepartureAlignmentPage from './ChargeDepartureAlignmentPage';

vi.unmock('react-i18next');

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
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 4 }) }));
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
  ComposedChart: ({ children }: PropsWithChildren) => <>{children}</>,
  CartesianGrid: ({ stroke }: { stroke?: string }) => <output data-testid="grid-stroke">{stroke}</output>,
  XAxis: ({ tick }: ComponentProps<typeof XAxis>) => <output data-testid="x-tick">{JSON.stringify(tick)}</output>,
  YAxis: ({ tick, yAxisId, domain, unit }: ComponentProps<typeof YAxis>) =>
    <output data-testid={`y-tick-${yAxisId}`}>{JSON.stringify({ tick, domain, unit })}</output>,
  Bar: ({ dataKey, hide, children }: PropsWithChildren<{ dataKey: string; hide: boolean }>) =>
    <div data-testid={dataKey} data-hidden={hide}>{children}</div>,
  Line: ({ dataKey, hide }: { dataKey: string; hide: boolean }) =>
    <div data-testid={dataKey} data-hidden={hide} />,
  Cell: () => null,
  Tooltip: () => null,
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
});
afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--font-scale');
  document.documentElement.style.removeProperty('--font-sans');
});

describe('Charge departure page contract adoption', () => {
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
    expect(source.chart?.exportData).toEqual([
      { date: new Date('2026-09-01T09:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        dwellMin: 60, margin: 45, flags: 'Well matched' },
      { date: new Date('2026-09-01T09:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        dwellMin: 90, margin: null, flags: 'Heuristic flags, not confirmed faults' },
    ]);
    expect(source.chart?.data).toEqual(source.chart?.exportData);
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
    expect(history).toHaveTextContent('1 valid timestamps');
    expect(history).toHaveTextContent(new Date('2026-09-01T09:00:00Z').toLocaleString('en'));
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
