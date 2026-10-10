import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationLog } from '@/api/types';
import { AlertFatiguePanel } from './AlertFatiguePanel';
import { NotificationBurnRatePanel } from './NotificationBurnRatePanel';
import { NotificationLatencyPanel } from './NotificationLatencyPanel';

const state = vi.hoisted(() => ({
  analysis: undefined as NotificationLog[] | undefined,
  delivery: undefined as NotificationLog[] | undefined,
  analysisError: null as Error | null,
  deliveryError: null as Error | null,
  paused: false,
  retryAnalysis: vi.fn(),
  retryDelivery: vi.fn(),
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationAnalysisLogs: () => ({
    data: state.analysis, error: state.analysisError, isError: state.analysisError != null,
    isLoading: state.analysis === undefined && state.analysisError == null,
    fetchStatus: state.paused ? 'paused' : 'idle', refetch: state.retryAnalysis,
  }),
  useNotificationDeliveryLogs: () => ({
    data: state.delivery, error: state.deliveryError, isError: state.deliveryError != null,
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
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
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

describe('Notification health continuation source independence', () => {
  beforeEach(() => {
    state.analysis = [log()];
    state.delivery = [log(), log({ id: 2, status: 'deferred_dnd', latency_ms: null })];
    state.analysisError = null;
    state.deliveryError = null;
    state.paused = false;
    state.retryAnalysis.mockClear();
    state.retryDelivery.mockClear();
    localStorage.clear();
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
    expect(fatigue.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(within(fatigue).getByText('Data may be stale')).toBeInTheDocument();
    expect(fatigue.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    fireEvent.click(within(fatigue).getByRole('button', { name: 'Refresh' }));
    expect(state.retryAnalysis).toHaveBeenCalledOnce();
    expect(state.retryDelivery).not.toHaveBeenCalled();
    const burn = screen.getByRole('region', { name: 'Notification burn rate' });
    expect(burn.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(within(burn).getByText('Data may be stale')).toBeInTheDocument();
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
    expect(within(rules).getByText('of 1 rules')).toBeInTheDocument();
    expect(within(rules).getByRole('button', { name: 'More info about fatiguing rules' })).toBeInTheDocument();
    const perDay = statTile(fatigue, 'Notifications per day');
    expect(perDay.querySelector('[data-operational-value]')).toHaveTextContent(/^20.0$/);
    expect(within(perDay).getByText('across 1 days')).toBeInTheDocument();
    const ignored = statTile(fatigue, 'Never read');
    expect(ignored.querySelector('[data-operational-value]')).toHaveTextContent(/^100%$/);
    expect(within(ignored).getByText('of notifications with read tracking')).toBeInTheDocument();
    const bursts = statTile(fatigue, 'Arrived in bursts');
    expect(bursts.querySelector('[data-operational-value]')).toHaveTextContent(/^100%$/);
    expect(within(bursts).getByText('firings that piled onto another')).toBeInTheDocument();
    expect(within(fatigue).getByText('Rates use the recorded firing span, not a complete requested analysis period; read tracking includes delivered notifications only.')).toBeInTheDocument();
    expect(within(fatigue).getByRole('heading', { name: 'Rule breakdown' })).toBeInTheDocument();
  });

  it('keeps absent read tracking unknown rather than inventing a never-read zero', () => {
    state.analysis = [log()];
    renderPanels();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    const ignored = statTile(fatigue, 'Never read');
    expect(ignored).toHaveAttribute('data-value-state', 'missing');
    expect(ignored.querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(within(ignored).getByText('Not tracked')).toBeInTheDocument();
    expect(within(ignored).queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps the screenshot short-window unknown and long-window 100 times burn distinct', () => {
    state.delivery = [log({
      status: 'failed', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    })];
    renderPanels();
    const burn = screen.getByRole('region', { name: 'Notification burn rate' });
    expect(burn.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(burn.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(within(burn).getByText('Recorded outcomes · 1h and 24h windows')).toBeInTheDocument();
    const delivery = statTile(burn, '24h delivery SLO');
    expect(delivery.querySelector('[data-operational-value]')).toHaveTextContent(/^0.00%$/);
    expect(within(delivery).getByText('99% objective')).toBeInTheDocument();
    const short = statTile(burn, '1h burn rate');
    expect(short).toHaveAttribute('data-value-state', 'missing');
    expect(short.querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(within(short).getByText('0 delivery outcomes')).toBeInTheDocument();
    expect(within(short).getByText('No delivery outcomes in the last hour')).toBeInTheDocument();
    const long = statTile(burn, '24h burn rate');
    expect(long).toHaveAttribute('data-operational-metric', 'burn-long');
    expect(long.querySelector('[data-operational-value]')).toHaveTextContent(/^100.00×$/);
    expect(within(long).queryByText('%')).not.toBeInTheDocument();
    expect(within(long).getByText('1 failed · 0 sent')).toBeInTheDocument();
    const budget = statTile(burn, 'Budget status');
    expect(budget.querySelector('[data-operational-value]')).toHaveTextContent('Burning fast');
    expect(within(budget).getByText('0 deferred by DND')).toBeInTheDocument();
    expect(within(burn).getByText('Short and long windows are separate; only sent and failed outcomes consume the 1% error budget. Deferred DND and pending attempts are excluded.')).toBeInTheDocument();
    expect(within(burn).getByRole('heading', { name: 'Delivery outcomes by hour' })).toBeInTheDocument();
    expect(within(burn).getByRole('heading', { name: 'Severity breakdown' })).toBeInTheDocument();
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
    unmount();
    state.delivery = [log({ status: 'deferred_dnd', latency_ms: null })];
    renderPanels();
    burn = screen.getByRole('region', { name: 'Notification burn rate' });
    for (const label of ['24h delivery SLO', '1h burn rate', '24h burn rate']) {
      const tile = statTile(burn, label);
      expect(tile).toHaveAttribute('data-value-state', 'missing');
      expect(tile.querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
    expect(statTile(burn, 'Budget status').querySelector('[data-operational-value]')).toHaveTextContent('No outcomes');
    expect(within(statTile(burn, 'Budget status')).getByText('1 deferred by DND')).toBeInTheDocument();
  });

  it('reviews full fatigue and mixed-window SLO evidence without removing the latency analysis', () => {
    state.delivery = [log({ status: 'failed', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() })];
    renderPanels();
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    fireEvent.click(within(fatigue).getByRole('button', { name: 'Review details' }));
    let drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('of 1 rules');
    expect(drawer).toHaveTextContent('across 1 days');
    expect(drawer).toHaveTextContent('of notifications with read tracking');
    expect(drawer).toHaveTextContent('firings that piled onto another');
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    const burn = screen.getByRole('region', { name: 'Notification burn rate' });
    fireEvent.click(within(burn).getByRole('button', { name: 'Review details' }));
    drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('99% objective');
    expect(drawer).toHaveTextContent('No delivery outcomes in the last hour');
    expect(drawer).toHaveTextContent('100.00×');
    expect(drawer).toHaveTextContent('1 failed · 0 sent');
    expect(drawer).toHaveTextContent('0 deferred by DND');
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getByRole('region', { name: 'Notification latency' })).toBeInTheDocument();
  });
});
