import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { NotificationLog } from '@/api/types';
import type { ChartContainer } from '@/components/charts';
import { fmtNumber, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { AlertFatiguePanel } from './AlertFatiguePanel';
import { NotificationBurnRatePanel } from './NotificationBurnRatePanel';
import { NotificationLatencyPanel } from './NotificationLatencyPanel';
import * as burnRateAnalysis from '../lib/notificationBurnRate';
import { analyzeAlertFatigue } from '../lib/alertFatigue';
import * as fatigueAnalysis from '../lib/alertFatigue';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';

const state = vi.hoisted(() => ({
  analysis: undefined as NotificationLog[] | undefined,
  delivery: undefined as NotificationLog[] | undefined,
  analysisError: null as Error | null,
  deliveryError: null as Error | null,
  deliveryUpdatedAt: 0,
  paused: false,
  retryAnalysis: vi.fn(),
  retryDelivery: vi.fn(),
  chartFrames: vi.fn<(props: ComponentProps<typeof ChartContainer>) => void>(),
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationAnalysisLogs: () => ({
    data: state.analysis, error: state.analysisError, isError: state.analysisError != null,
    isLoading: state.analysis === undefined && state.analysisError == null,
    fetchStatus: state.paused ? 'paused' : 'idle', refetch: state.retryAnalysis,
  }),
  useNotificationDeliveryLogs: () => ({
    data: state.delivery, error: state.deliveryError, isError: state.deliveryError != null,
    dataUpdatedAt: state.deliveryUpdatedAt,
    isLoading: state.delivery === undefined && state.deliveryError == null,
    fetchStatus: state.paused ? 'paused' : 'idle', refetch: state.retryDelivery,
  }),
}));

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string'
        ? fallback
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      const replacements = options?.replace as Record<string, unknown> | undefined;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(replacements?.[name] ?? options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ChartContainer: (props: ComponentProps<typeof actual.ChartContainer>) => {
      state.chartFrames(props);
      return <actual.ChartContainer {...props} />;
    },
  };
});
vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>(
    '@/hooks/useOperationalMetrics',
  );
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

function log(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: 1, channel_id: 1, alert_id: null, title: 'Complete notification title',
    message: 'Complete notification body', status: 'sent', severity: 'warn',
    error: '', latency_ms: 1250, created_at: new Date(Date.now() - 60_000).toISOString(),
    sent_at: null, ...overrides,
  };
}

function renderPanels() {
  return render(<MemoryRouter>
    <AlertFatiguePanel />
    <NotificationBurnRatePanel />
    <NotificationLatencyPanel />
  </MemoryRouter>);
}

function statTile(region: HTMLElement, label: string): HTMLElement {
  const tile = within(region).getByText(label, { selector: '[data-operational-metric] *' }).closest<HTMLElement>('[data-operational-metric]');
  expect(tile).not.toBeNull();
  return tile!;
}

// Omitted metrics carry no drawer group, so the missing/invalid
// classification is pinned on the mapped hook output instead. Panels share
// the spy, so select the latest call that carries the occurrence id.
function hookProbe(occurrenceId: string) {
  const mocked = vi.mocked(useOperationalMetrics);
  for (let index = mocked.mock.calls.length - 1; index >= 0; index--) {
    const input = mocked.mock.calls[index]![0];
    if (input.some(metric => metric.occurrenceId === occurrenceId)) {
      const mapped = mocked.mock.results[index]?.value as
        readonly { valueState?: string }[] | undefined;
      return { input, mapped };
    }
  }
  throw new Error(`Missing hook call for ${occurrenceId}`);
}

describe('Notification health continuation source independence', () => {
  beforeEach(() => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    state.analysis = [log()];
    state.delivery = [log(), log({ id: 2, status: 'deferred_dnd', latency_ms: null })];
    state.analysisError = null;
    state.deliveryError = null;
    state.deliveryUpdatedAt = 0;
    state.paused = false;
    state.retryAnalysis.mockClear();
    state.retryDelivery.mockClear();
    state.chartFrames.mockClear();
    localStorage.clear();
  });
  afterEach(() => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    vi.restoreAllMocks();
  });

  it('retains all populated sections after refresh failures and retries only the requested source', () => {
    state.analysisError = new Error('analysis refresh failed');
    state.deliveryError = new Error('delivery refresh failed');
    renderPanels();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Noise score by rule' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'When notifications arrive' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delivery outcomes by hour' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Latency distribution' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rule breakdown' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Rule breakdown' }))
      .getByRole('button', { name: 'More info about rule grouping' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Severity breakdown' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Severity and status cohorts' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(within(table).getByText('Complete notification title')).toBeInTheDocument();
    expect(within(table).getByText('Measured')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    const fatigueBrief = within(fatigue).getByTestId('alert-fatigue-brief');
    expect(fatigueBrief).toBeInTheDocument();
    assertOperationalBriefDisclosure(fatigueBrief, 'Data may be stale');
    expect(fatigue.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    assertOperationalMetricUnavailable(fatigueBrief, 'Never read');
    assertOperationalMetricUnavailable(fatigueBrief, 'Arrived in bursts');
    fireEvent.click(within(fatigue).getByRole('button', { name: 'Refresh' }));
    expect(state.retryAnalysis).toHaveBeenCalledOnce();
    expect(state.retryDelivery).not.toHaveBeenCalled();
    const burn = screen.getByRole('region', { name: 'Notification burn rate' });
    const burnBrief = within(burn).getByTestId('notification-burn-rate-brief');
    expect(burnBrief).toBeInTheDocument();
    assertOperationalBriefDisclosure(burnBrief, 'Data may be stale');
    expect(burn.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    fireEvent.click(within(burn).getByRole('button', { name: 'Refresh' }));
    expect(state.retryDelivery).toHaveBeenCalledOnce();
  });

  it('keeps successful delivery panels when analysis fails initially', () => {
    state.analysis = undefined;
    state.analysisError = new Error('analysis unavailable');
    renderPanels();
    expect(screen.getByRole('heading', { name: 'Delivery outcomes by hour' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Slowest delivery records' })).toBeInTheDocument();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(within(fatigue).getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
    expect(within(fatigue).queryByText('No notifications have been delivered yet, so there is nothing to score.')).not.toBeInTheDocument();
  });

  it('does not present empty-history metrics while the source is unknown', () => {
    state.analysis = undefined;
    state.delivery = undefined;
    renderPanels();
    for (const label of ['Alert fatigue metrics', 'Delivery SLO metrics']) {
      const metrics = screen.getByRole('region', { name: label });
      const skeletons = metrics.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]');
      expect(skeletons).toHaveLength(4);
      for (const skeleton of skeletons) {
        expect(skeleton).toHaveStyle({ height: '96px' });
        expect(skeleton).toHaveClass('w-full', 'rounded-xl');
      }
      expect(metrics.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    }
    const latency = screen.getByRole('region', { name: 'Notification latency metrics' });
    expect(within(latency).getByTestId('notification-latency-brief')).toHaveAttribute('aria-busy', 'true');
    const pendingValues = latency.querySelectorAll('[data-operational-metric] [aria-hidden="true"][class~="bg-[var(--surface-3)]"]');
    expect(pendingValues).toHaveLength(4);
    for (const value of pendingValues) {
      expect(value).toHaveClass('h-5', 'w-20', 'max-w-full', 'rounded');
      expect(value).toBeEmptyDOMElement();
    }
    expect(latency.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Slowest delivery records' })).not.toBeInTheDocument();
    expect(screen.queryByText('No outcomes')).not.toBeInTheDocument();
    expect(screen.queryByText('No notifications have been delivered yet, so there is nothing to score.')).not.toBeInTheDocument();
  });

  it('retains source data during paused refreshes and labels it as offline', () => {
    state.paused = true;
    renderPanels();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3);
    for (const label of ['Alert fatigue', 'Notification burn rate', 'Notification latency']) {
      const region = screen.getByRole('region', { name: label });
      const warning = within(region).getByTestId('stale-refresh-warning');
      expect(warning).toHaveAttribute('role', 'status');
      expect(warning).toHaveAttribute('data-data-state', 'stale');
      expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
      expect(within(warning).getByText(`${label} may be out of date`)).toBeInTheDocument();
      expect(within(warning).getByText('The latest values are temporarily unavailable. Previously loaded data remains visible.')).toBeInTheDocument();
      expect(within(warning).queryByText(/The device is offline/)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Noise score by rule' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delivery outcomes by hour' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Latency distribution' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Slowest delivery records' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(within(table).getByText('Complete notification title')).toBeInTheDocument();
    expect(within(table).getByText('Measured')).toBeInTheDocument();
  });

  it('mounts real fatigue metrics with complete captions, read eligibility, and burst denominators', () => {
    const now = Date.now();
    state.analysis = Array.from({ length: 20 }, (_, index) => log({
      id: index + 1, created_at: new Date(now - index * 60_000).toISOString(),
      read_at: null,
    }));
    renderPanels();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(fatigue.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(fatigue.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    const rules = statTile(fatigue, 'Fatiguing rules');
    expect(rules.querySelector('[data-operational-value]')).toHaveTextContent(/^1$/);
    const perDay = statTile(fatigue, 'Notifications per day');
    expect(perDay.querySelector('[data-operational-value]')).toHaveTextContent(/^20.00$/);
    const ignored = statTile(fatigue, 'Never read');
    expect(ignored.querySelector('[data-operational-value]')).toHaveTextContent(/^100.00%$/);
    const bursts = statTile(fatigue, 'Arrived in bursts');
    expect(bursts.querySelector('[data-operational-value]')).toHaveTextContent(/^100.00%$/);
    const brief = within(fatigue).getByTestId('alert-fatigue-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    try {
      expect(within(drawer).getByRole('group', { name: 'Fatiguing rules' })).toHaveTextContent('of 1 rules');
      expect(within(within(drawer).getByRole('group', { name: 'Fatiguing rules' }))
        .getByRole('button', { name: 'More info about fatiguing rules' })).toBeInTheDocument();
      expect(within(drawer).getByRole('group', { name: 'Notifications per day' })).toHaveTextContent('across 1.00 days');
      expect(within(drawer).getByRole('group', { name: 'Never read' })).toHaveTextContent('of notifications with read tracking');
      expect(within(drawer).getByRole('group', { name: 'Arrived in bursts' })).toHaveTextContent('firings that piled onto another');
      expect(drawer).toHaveTextContent('Rates use the recorded firing span, not a complete requested analysis period; read tracking includes delivered notifications only.');
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' });
    }
    expect(within(fatigue).getByRole('heading', { name: 'Rule breakdown' })).toBeInTheDocument();
  });

  it('explains composite fatigue grouping without merging different alerts, event types or vehicle names', () => {
    state.analysis = [
      log({ id: 1, alert_id: 10, event_type: 'battery_low', title: 'Roadster battery at 19%' }),
      log({ id: 2, alert_id: 10, event_type: 'battery_low', title: '  ROADSTER   battery at 18%  ' }),
      log({ id: 3, alert_id: 11, event_type: 'battery_low', title: 'Roadster battery at 17%' }),
      log({ id: 4, alert_id: 10, event_type: 'battery_warning', title: 'Roadster battery at 16%' }),
      log({ id: 5, alert_id: 10, event_type: 'battery_low', title: 'Falcon battery at 15%' }),
      log({ id: 6, alert_id: null, event_type: 'battery_low', title: 'Roadster battery at 14%' }),
    ];
    render(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    const heading = within(fatigue).getByRole('heading', { name: 'Rule breakdown' });
    const help = within(heading).getByRole('button', { name: 'More info about rule grouping' });
    const tooltip = document.getElementById(help.getAttribute('aria-describedby')!);
    expect(tooltip).toHaveTextContent(
      'Notifications are grouped by alert ID, event type and normalised title together. Titles are lowercased, numeric values are replaced with placeholders and whitespace is collapsed; vehicle names and other text remain. Different alert IDs or event types stay separate even when their normalised titles match.',
    );
    expect(tooltip).not.toHaveTextContent('vehicle names are stripped');
    const detailPanel = heading.closest('[data-print-card]')!;
    const tables = within(detailPanel).getAllByRole('table');
    expect(tables).toHaveLength(5);
    const grouped = within(fatigue).getByRole('table', { name: 'Roadster battery at 19%' });
    expect(within(grouped).getByText('2 · 2.00/day')).toBeInTheDocument();
    for (const title of [
      'Roadster battery at 17%', 'Roadster battery at 16%',
      'Falcon battery at 15%', 'Roadster battery at 14%',
    ]) {
      expect(within(within(fatigue).getByRole('table', { name: title }))
        .getByText('1 · 1.00/day')).toBeInTheDocument();
    }
    expect(within(fatigue).getByRole('heading', { name: 'Noise score by rule' })).toBeInTheDocument();
    expect(within(fatigue).getByRole('heading', { name: 'When notifications arrive' })).toBeInTheDocument();
  });

  it('uses composite group keys for colliding chart labels while preserving full-title alternatives', () => {
    const title = 'Roadster battery warning';
    state.analysis = [
      log({ id: 1, alert_id: 10, event_type: 'battery_low', title }),
      log({ id: 2, alert_id: 11, event_type: 'battery_low', title }),
      log({ id: 3, alert_id: 10, event_type: 'battery_warning', title }),
      log({ id: 4, alert_id: 12, event_type: 'battery_low', title: 'Roadster battery critical' }),
    ];
    render(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
    const groups = analyzeAlertFatigue(state.analysis).groups;
    const frame = state.chartFrames.mock.calls.find(([props]) => props.title === 'Noise score by rule')![0];
    type ChartElementProps = { children?: ReactNode; data?: unknown[]; dataKey?: string };
    if (typeof frame.children === 'function') throw new Error('Expected static rule chart');
    const responsive = Children.only(frame.children);
    expect(isValidElement<ChartElementProps>(responsive)).toBe(true);
    if (!isValidElement<ChartElementProps>(responsive)) throw new Error('Missing responsive chart');
    const chart = Children.only(responsive.props.children);
    expect(isValidElement<ChartElementProps>(chart)).toBe(true);
    if (!isValidElement<ChartElementProps>(chart)) throw new Error('Missing rule chart');
    expect(chart.props.data).toEqual(groups.map(group => ({
      key: group.key,
      rule: `${group.title.slice(0, 15)}…`,
      score: group.noiseScore,
      perDay: group.perDay,
      ignored: null,
      verdict: group.verdict,
    })));
    const cellKeys: (string | null)[] = [];
    Children.forEach(chart.props.children, child => {
      if (isValidElement<ChartElementProps>(child) && child.props.dataKey === 'score') {
        Children.forEach(child.props.children, cell => {
          if (isValidElement(cell)) cellKeys.push(cell.key);
        });
      }
    });
    expect(cellKeys).toEqual(groups.map(group => group.key));
    expect(new Set(cellKeys).size).toBe(4);
    expect(frame.data?.map(row => row.rule)).toEqual(groups.map(group => group.title));
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(within(fatigue).getAllByRole('table', { name: title })).toHaveLength(3);
    expect(within(fatigue).getByRole('table', { name: 'Roadster battery critical' })).toBeInTheDocument();
    expect(within(fatigue).getByRole('heading', { name: 'When notifications arrive' })).toBeInTheDocument();
  });

  it('keeps absent read tracking unknown rather than inventing a never-read zero', () => {
    state.analysis = [log()];
    renderPanels();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    const brief = within(fatigue).getByTestId('alert-fatigue-brief');
    assertOperationalMetricUnavailable(brief, 'Never read');
    const { input, mapped } = hookProbe('fatigue-ignored');
    expect(input.find(metric => metric.occurrenceId === 'fatigue-ignored')?.missingReason).toBe('Not tracked');
    expect(mapped?.find((_, index) => input[index]?.occurrenceId === 'fatigue-ignored')?.valueState).toBe('missing');
  });

  it.each([
    { name: 'null', value: null, expectedState: 'missing' },
    { name: 'undefined', value: undefined, expectedState: 'missing' },
    { name: 'NaN', value: NaN, expectedState: 'invalid' },
    { name: 'positive infinity', value: Infinity, expectedState: 'invalid' },
    { name: 'negative infinity', value: -Infinity, expectedState: 'invalid' },
    { name: 'numeric string', value: '0', expectedState: 'invalid' },
    { name: 'empty string', value: '', expectedState: 'invalid' },
    { name: 'boolean', value: false, expectedState: 'invalid' },
    { name: 'zero', value: 0, expectedState: 'value' },
    { name: 'positive fraction', value: 1.23456, expectedState: 'value' },
    { name: 'negative fraction', value: -1.23456, expectedState: 'value' },
  ])('preserves $name fatigue measurements without coercion or early rounding', ({ value, expectedState }) => {
    const summary = analyzeAlertFatigue([log()]);
    for (const key of ['overallPerDay', 'overallIgnoredRate', 'overallBurstRate']) {
      Reflect.set(summary, key, value);
    }
    const group = summary.groups[0]!;
    for (const key of ['perDay', 'noiseScore', 'ignoredRate', 'burstRate']) {
      Reflect.set(group, key, value);
    }
    vi.spyOn(fatigueAnalysis, 'analyzeAlertFatigue').mockReturnValue(summary);
    render(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    const brief = within(fatigue).getByTestId('alert-fatigue-brief');
    const labels = ['Notifications per day', 'Never read', 'Arrived in bursts'] as const;
    if (expectedState === 'value') {
      for (const label of labels) {
        const tile = statTile(fatigue, label);
        expect(tile).toHaveAttribute('data-value-state', expectedState);
        expect(tile.querySelector('[data-operational-value]')).toHaveTextContent(
          label === 'Notifications per day' ? fmtNumber(value) : `${fmtNumber(Number(value) * 100)}%`,
        );
      }
    } else {
      const { mapped, input } = hookProbe('fatigue-per-day');
      for (const label of labels) {
        assertOperationalMetricUnavailable(brief, label);
      }
      const states = labels.map(label => {
        const occurrenceId = label === 'Notifications per day' ? 'fatigue-per-day'
          : label === 'Never read' ? 'fatigue-ignored' : 'fatigue-bursts';
        return mapped?.find((_, index) => input[index]?.occurrenceId === occurrenceId)?.valueState;
      });
      expect(states).toEqual([expectedState, expectedState, expectedState]);
    }
    const details = within(fatigue).getByRole('table', { name: group.title });
    expect(within(details).getByText(
      `1 · ${expectedState === 'value' ? fmtNumber(value) : '—'}/day`,
    )).toBeInTheDocument();
    const ignoredRow = within(details).getByText('Never read').closest('tr')!;
    expect(ignoredRow).toHaveTextContent(value == null ? 'Not tracked'
      : expectedState === 'value' ? `${fmtNumber(Number(value) * 100)}%` : '—');
    const frame = state.chartFrames.mock.calls.find(([props]) => props.title === 'Noise score by rule')![0];
    expect(frame.data?.[0]).toMatchObject({
      score: expectedState === 'value' ? value : null,
      perDay: expectedState === 'value' ? value : null,
      ignored: expectedState === 'value' ? Number(value) * 100 : null,
    });
  });

  it('reacts to locale and precision changes without refetching or rounding chart exports', () => {
    const summary = analyzeAlertFatigue([log()]);
    summary.overallPerDay = summary.groups[0]!.perDay = 1234.56789;
    summary.overallIgnoredRate = summary.groups[0]!.ignoredRate = 0.123456;
    summary.overallBurstRate = summary.groups[0]!.burstRate = -0.123456;
    summary.groups[0]!.noiseScore = 12.34567;
    summary.analyzedDays = 1.23456;
    vi.spyOn(fatigueAnalysis, 'analyzeAlertFatigue').mockReturnValue(summary);
    render(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    const perDay = statTile(fatigue, 'Notifications per day');
    expect(perDay.querySelector('[data-operational-value]')).toHaveTextContent(/^1,234.57$/);
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(perDay.querySelector('[data-operational-value]')).toHaveTextContent(/^1.234,5679$/);
    const brief = within(fatigue).getByTestId('alert-fatigue-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    try {
      expect(within(drawer).getByRole('group', { name: 'Notifications per day' })).toHaveTextContent('across 1,2346 days');
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' });
    }
    expect(statTile(fatigue, 'Never read').querySelector('[data-operational-value]')).toHaveTextContent(/^12,3456%$/);
    expect(statTile(fatigue, 'Arrived in bursts').querySelector('[data-operational-value]')).toHaveTextContent(/^-12,3456%$/);
    const details = within(fatigue).getByRole('table', { name: summary.groups[0]!.title });
    expect(within(details).getByText('1 · 1.234,5679/day')).toBeInTheDocument();
    expect(within(details).getByText('-12,3456% · max 1')).toBeInTheDocument();
    for (const [frame] of state.chartFrames.mock.calls.filter(([props]) => props.title === 'Noise score by rule')) {
      expect(frame.data?.[0]).toMatchObject({ score: 12.34567, perDay: 1234.56789, ignored: 12.3456 });
    }
    expect(state.retryAnalysis).not.toHaveBeenCalled();
  });

  it('keeps the screenshot short-window unknown and long-window 100 times burn distinct', () => {
    state.delivery = [log({
      status: 'failed', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    })];
    renderPanels();
    const burn = screen.getByRole('region', { name: 'Notification burn rate' });
    const brief = within(burn).getByTestId('notification-burn-rate-brief');
    expect(burn.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(burn.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    assertOperationalBriefDisclosure(brief, 'Recorded outcomes · 1h and 24h windows');
    const delivery = statTile(burn, '24h delivery SLO');
    expect(delivery.querySelector('[data-operational-value]')).toHaveTextContent(/^0.00%$/);
    assertOperationalMetricUnavailable(brief, '1h burn rate');
    const { input, mapped } = hookProbe('burn-short');
    expect(mapped?.find((_, index) => input[index]?.occurrenceId === 'burn-short')?.valueState).toBe('missing');
    expect(input.find(metric => metric.occurrenceId === 'burn-short')?.missingReason)
      .toBe('No delivery outcomes in the last hour');
    expect(burnRateAnalysis.analyzeNotificationBurnRate(state.delivery!, { nowMs: Date.now() }).shortWindow.eligible).toBe(0);
    const long = statTile(burn, '24h burn rate');
    expect(long).toHaveAttribute('data-operational-metric', 'burn-long');
    expect(long.querySelector('[data-operational-value]')).toHaveTextContent(/^100.00×$/);
    expect(within(long).queryByText('%')).not.toBeInTheDocument();
    const budget = statTile(burn, 'Budget status');
    expect(budget.querySelector('[data-operational-value]')).toHaveTextContent('Burning fast');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    try {
      expect(within(drawer).getByRole('group', { name: '24h delivery SLO' })).toHaveTextContent('99% objective');
      expect(within(drawer).getByRole('group', { name: '24h burn rate' })).toHaveTextContent('1 failed · 0 sent');
      expect(within(drawer).getByRole('group', { name: 'Budget status' })).toHaveTextContent('0 deferred by DND');
      expect(drawer).toHaveTextContent('Short and long windows are separate; only sent and failed outcomes consume the 1% error budget. Deferred DND and pending attempts are excluded.');
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' });
    }
    expect(within(burn).getByRole('heading', { name: 'Delivery outcomes by hour' })).toBeInTheDocument();
    expect(within(burn).getByRole('heading', { name: 'Severity breakdown' })).toBeInTheDocument();
  });

  it('anchors burn windows to successful snapshots, including unchanged logs, without requesting refreshes', () => {
    const snapshot = Date.parse('2026-10-14T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(snapshot);
    try {
      state.deliveryUpdatedAt = snapshot;
      state.delivery = [
        log({ id: 1, status: 'failed', created_at: new Date(snapshot - 30 * 60_000).toISOString() }),
        log({ id: 2, status: 'sent', created_at: new Date(snapshot - 23.5 * 3_600_000).toISOString() }),
      ];
      const { rerender } = render(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
      const burn = screen.getByRole('region', { name: 'Notification burn rate' });
      const asOf = within(burn).getByTestId('notification-burn-rate-as-of');
      expect(asOf).toHaveTextContent('As of Oct 14, 2026, 12:00 PM (UTC)');
      expect(statTile(burn, '1h burn rate').querySelector('[data-operational-value]')).toHaveTextContent(/^100.00×$/);
      expect(statTile(burn, '24h burn rate').querySelector('[data-operational-value]')).toHaveTextContent(/^50.00×$/);
      expect(statTile(burn, 'Budget status')).toHaveTextContent('SLO breach');

      vi.setSystemTime(snapshot + 2 * 3_600_000);
      state.deliveryError = new Error('snapshot refresh failed');
      state.paused = true;
      rerender(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
      expect(asOf).toHaveTextContent('As of Oct 14, 2026, 12:00 PM (UTC)');
      expect(statTile(burn, '1h burn rate').querySelector('[data-operational-value]')).toHaveTextContent(/^100.00×$/);
      expect(statTile(burn, '24h burn rate').querySelector('[data-operational-value]')).toHaveTextContent(/^50.00×$/);
      expect(within(burn).getByTestId('stale-refresh-warning')).toBeInTheDocument();

      state.deliveryError = null;
      state.paused = false;
      state.deliveryUpdatedAt = Date.now();
      rerender(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
      expect(asOf).toHaveTextContent('As of Oct 14, 2026, 02:00 PM (UTC)');
      assertOperationalMetricUnavailable(within(burn).getByTestId('notification-burn-rate-brief'), '1h burn rate');
      expect(statTile(burn, '24h burn rate').querySelector('[data-operational-value]')).toHaveTextContent(/^100.00×$/);
      expect(statTile(burn, 'Budget status')).toHaveTextContent('Burning fast');
      expect(within(burn).getByRole('heading', { name: 'Delivery outcomes by hour' })).toBeInTheDocument();
      expect(within(burn).getByText('0 sent · 1 failed · 0 deferred · 0 pending')).toBeInTheDocument();
      expect(state.retryDelivery).not.toHaveBeenCalled();
      expect(state.retryAnalysis).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('discloses a stable mount snapshot when the delivery query has no update timestamp', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    try {
      state.delivery = [log()];
      const { rerender } = render(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
      expect(screen.getByTestId('notification-burn-rate-as-of')).toHaveTextContent('As of Oct 14, 2026, 12:00 PM (UTC)');
      vi.setSystemTime(new Date('2026-10-15T14:00:00Z'));
      state.delivery = [...state.delivery];
      rerender(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
      expect(screen.getByTestId('notification-burn-rate-as-of')).toHaveTextContent('As of Oct 14, 2026, 12:00 PM (UTC)');
      expect(statTile(screen.getByRole('region', { name: 'Notification burn rate' }), '1h burn rate')
        .querySelector('[data-operational-value]')).toHaveTextContent(/^0.00×$/);
      expect(state.retryDelivery).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes measured zero burn from deferred-only histories with no eligible outcomes', () => {
    state.delivery = [log()];
    const { unmount } = renderPanels();
    let burn = screen.getByRole('region', { name: 'Notification burn rate' });
    for (const label of ['1h burn rate', '24h burn rate']) {
      const tile = statTile(burn, label);
      expect(tile).toHaveAttribute('data-value-state', 'value');
      expect(tile.querySelector('[data-operational-value]')).toHaveTextContent(/^0.00×$/);
    }
    const severityPanel = within(burn).getByRole('heading', { name: 'Severity breakdown' })
      .closest<HTMLElement>('[data-print-card]')!;
    expect(within(severityPanel).getByText(`${fmtNumber(0)}×`))
      .toHaveClass('bg-[var(--semantic-success-bg)]');
    expect(within(severityPanel).getByText('1 sent · 0 failed · 0 deferred · 0 pending')).toBeInTheDocument();
    unmount();
    state.delivery = [log({ status: 'deferred_dnd', latency_ms: null })];
    renderPanels();
    burn = screen.getByRole('region', { name: 'Notification burn rate' });
    const brief = within(burn).getByTestId('notification-burn-rate-brief');
    for (const label of ['24h delivery SLO', '1h burn rate', '24h burn rate']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expect(statTile(burn, 'Budget status').querySelector('[data-operational-value]')).toHaveTextContent('No outcomes');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    try {
      expect(within(drawer).getByRole('group', { name: 'Budget status' })).toHaveTextContent('1 deferred by DND');
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' });
    }
  });

  it.each(['deferred_dnd', 'pending'] as const)(
    'keeps %s-only severity burn neutral without losing outcome counts',
    status => {
      state.delivery = [log({ status, latency_ms: null })];
      renderPanels();
      const heading = screen.getByRole('heading', { name: 'Severity breakdown' });
      const panel = heading.closest<HTMLElement>('[data-print-card]')!;
      const badge = within(panel).getByText('—');
      expect(badge).toHaveClass('bg-[var(--surface-2)]', 'text-[var(--text-secondary)]');
      expect(badge).not.toHaveClass('bg-[var(--semantic-success-bg)]');
      expect(within(panel).getByText(
        status === 'deferred_dnd'
          ? '0 sent · 0 failed · 1 deferred · 0 pending'
          : '0 sent · 0 failed · 0 deferred · 1 pending',
      )).toBeInTheDocument();
    },
  );

  it.each([
    { label: 'null', value: null, variant: 'neutral', text: '—' },
    { label: 'undefined', value: undefined, variant: 'neutral', text: '—' },
    { label: 'NaN', value: NaN, variant: 'neutral', text: '—' },
    { label: 'positive infinity', value: Infinity, variant: 'neutral', text: '—' },
    { label: 'negative infinity', value: -Infinity, variant: 'neutral', text: '—' },
    { label: 'numeric string', value: '0', variant: 'neutral', text: '—' },
    { label: 'empty string', value: '', variant: 'neutral', text: '—' },
    { label: 'boolean', value: false, variant: 'neutral', text: '—' },
    { label: 'zero', value: 0, variant: 'success', text: '0×' },
    { label: 'negative', value: -2, variant: 'success', text: '-2×' },
    { label: 'negative fraction', value: -0.5, variant: 'success', text: '-0.5×' },
    { label: 'positive fraction', value: 0.5, variant: 'success', text: '0.5×' },
    { label: 'threshold', value: 1, variant: 'success', text: '1×' },
    { label: 'above threshold', value: 1.25, variant: 'warning', text: '1.25×' },
  ])('preserves severity badge semantics for $label burn', ({ value, variant, text }) => {
    const summary = burnRateAnalysis.analyzeNotificationBurnRate([log()]);
    Reflect.set(summary.severities[0]!, 'burnRate', value);
    const analyze = vi.spyOn(burnRateAnalysis, 'analyzeNotificationBurnRate').mockReturnValueOnce(summary);
    try {
      render(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
      const heading = screen.getByRole('heading', { name: 'Severity breakdown' });
      const panel = heading.closest<HTMLElement>('[data-print-card]')!;
      const badge = within(panel).getByText(
        typeof value === 'number' && Number.isFinite(value) ? `${fmtNumber(value)}×` : text,
      );
      expect(badge).toHaveClass(variant === 'neutral'
        ? 'bg-[var(--surface-2)]'
        : `bg-[var(--semantic-${variant}-bg)]`);
      expect(within(panel).getByText('1 sent · 0 failed · 0 deferred · 0 pending')).toBeInTheDocument();
    } finally {
      analyze.mockRestore();
    }
  });

  it('reviews full fatigue and mixed-window SLO evidence without removing the latency analysis', () => {
    const now = Date.now();
    state.analysis = Array.from({ length: 20 }, (_, index) => log({
      id: index + 1, created_at: new Date(now - index * 60_000).toISOString(),
      read_at: null,
    }));
    state.delivery = [log({ status: 'failed', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() })];
    renderPanels();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    fireEvent.click(within(fatigue).getByRole('button', { name: 'Review details' }));
    let drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('of 1 rules');
    expect(drawer).toHaveTextContent('across 1.00 days');
    expect(drawer).toHaveTextContent('of notifications with read tracking');
    expect(drawer).toHaveTextContent('firings that piled onto another');
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    const burn = screen.getByRole('region', { name: 'Notification burn rate' });
    fireEvent.click(within(burn).getByRole('button', { name: 'Review details' }));
    drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('99% objective');
    expect(drawer).toHaveTextContent('100.00×');
    expect(drawer).toHaveTextContent('1 failed · 0 sent');
    expect(drawer).toHaveTextContent('0 deferred by DND');
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    // The omitted short-window tile keeps its missing reason on the mapped input.
    const { input } = hookProbe('burn-short');
    expect(input.find(metric => metric.occurrenceId === 'burn-short')?.missingReason)
      .toBe('No delivery outcomes in the last hour');
    expect(screen.getByRole('region', { name: 'Notification latency' })).toBeInTheDocument();
  });
});
