import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationLog, NotificationReport } from '@/api/types';
import type { StatMetric } from '@/components/data-display';
import type { MetricPreferences } from '@/lib/metric-reference';
import { NotificationLatencyPanel } from '../NotificationLatencyPanel';
import { NotificationReportPanel } from '../NotificationReportPanel';
import { BrowserNotificationsKpis } from '../BrowserNotificationsKpis';

const source = vi.hoisted(() => ({
  deliveries: [] as NotificationLog[],
  report: undefined as NotificationReport | undefined,
  metrics: [] as (readonly StatMetric[])[],
  settings: undefined as { tab_badge_enabled: boolean; critical_flash_enabled: boolean } | undefined,
}));

vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    ...actual,
    useOperationalMetrics: (metrics: readonly StatMetric[], preferences?: MetricPreferences) => {
      source.metrics = [...source.metrics, metrics];
      return actual.useOperationalMetrics(metrics, preferences);
    },
  };
});
vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationDeliveryLogs: () => ({ data: source.deliveries, isLoading: false, isError: false }),
  useNotificationReport: () => ({ data: source.report, isLoading: false, isError: false }),
}));
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({ data: source.settings, isLoading: source.settings === undefined }),
}));
vi.mock('@/lib/notificationSound', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/notificationSound')>(),
  useNotificationSoundPrefs: () => ({ master: false, perCategory: {}, volume: 0.6 }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

function rawMetric(id: string) {
  const metric = source.metrics.flat().find(item => item.occurrenceId === id);
  expect(metric).toBeDefined();
  return metric!;
}

function delivery(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: 1, channel_id: 1, alert_id: null, title: 'Raw delivery evidence',
    message: '', severity: 'info', status: 'sent', error: '',
    latency_ms: 1250, created_at: '2026-08-04T12:00:00Z', sent_at: null,
    ...overrides,
  };
}

describe('Notification briefs use the actual validated raw bridge', () => {
  beforeEach(() => {
    source.deliveries = [];
    source.report = undefined;
    source.settings = undefined;
    source.metrics = [];
  });

  it('normalizes measured milliseconds to canonical latency seconds without changing specialist display', () => {
    source.deliveries = [delivery()];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    for (const id of ['latency-p50', 'latency-p95', 'latency-p99']) {
      expect(rawMetric(id)).toMatchObject({ metricId: 'latency', rawValue: 1.25 });
      const metric = screen.getByTestId('notification-latency-brief').querySelector(`[data-operational-metric="${id}"]`);
      expect(metric).toHaveAttribute('data-value-state', 'value');
      expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent('1,250.00 ms');
    }
    expect(rawMetric('latency-apdex')).toMatchObject({ metricId: 'number', rawValue: 0.5 });
  });

  it('retains derived timestamp latency and distinguishes measured zero from missing measurements', () => {
    source.deliveries = [delivery({ latency_ms: null, sent_at: '2026-08-04T12:00:02Z' })];
    const view = render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(rawMetric('latency-p50').rawValue).toBe(2);
    expect(screen.getByRole('table', { name: 'Slowest delivery records' })).toHaveTextContent('Derived');
    view.unmount();
    source.metrics = [];
    source.deliveries = [delivery({ latency_ms: 0 })];
    const zero = render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(rawMetric('latency-p50').rawValue).toBe(0);
    expect(screen.getByTestId('notification-latency-brief').querySelector('[data-operational-metric="latency-p50"]'))
      .toHaveAttribute('data-value-state', 'value');
    zero.unmount();
    source.metrics = [];
    source.deliveries = [delivery({ latency_ms: null })];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(rawMetric('latency-p50').rawValue).toBeNull();
    expect(screen.getByTestId('notification-latency-brief').querySelector('[data-operational-metric="latency-p50"]'))
      .toHaveAttribute('data-value-state', 'missing');
  });

  it('keeps independent configuration counts numeric and missing tab settings unknown', () => {
    render(<BrowserNotificationsKpis permission="granted" notificationsSupported pushPrefs={{ alerts: true, exportStatus: false }} />);
    expect(rawMetric('browser-permission')).toMatchObject({ metricId: 'status', rawValue: 'Enabled' });
    expect(rawMetric('browser-push')).toMatchObject({ metricId: 'count', rawValue: 1, display: { countTotal: 2 } });
    expect(rawMetric('browser-tab')).toMatchObject({ metricId: 'count', rawValue: null, display: { countTotal: 2 } });
    expect(rawMetric('browser-sounds')).toMatchObject({ metricId: 'count', rawValue: 0 });
    const brief = screen.getByTestId('browser-notifications-brief');
    expect(brief.querySelector('[data-operational-metric="browser-tab"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="browser-sounds"]')).toHaveAttribute('data-value-state', 'value');
  });

  it('preserves linked-delivery attribution and leaves a zero-trigger denominator missing', () => {
    source.report = {
      from: '2026-08-01', to: '2026-08-31', from_instant: '2026-08-01T00:00:00Z',
      to_exclusive: '2026-09-01T00:00:00Z', timezone: 'UTC', triggered: 3,
      deliveries: 5, uncorrelated_deliveries: 2, outbound_http_calls: 11,
      daily: [], by_source: [], by_type: [], by_severity: [], by_channel: [], by_status: [],
    };
    const view = render(<MemoryRouter><NotificationReportPanel fromInstant="2026-08-01T00:00:00Z" toExclusive="2026-09-01T00:00:00Z" timezone="UTC" /></MemoryRouter>);
    expect(rawMetric('report-fanout')).toMatchObject({ metricId: 'number', rawValue: 1 });
    expect(rawMetric('report-http')).toMatchObject({ metricId: 'count', rawValue: 11 });
    expect(rawMetric('report-uncorrelated')).toMatchObject({ metricId: 'count', rawValue: 2 });
    view.unmount();
    source.metrics = [];
    source.report = { ...source.report, triggered: 0 };
    render(<MemoryRouter><NotificationReportPanel fromInstant="2026-08-01T00:00:00Z" toExclusive="2026-09-01T00:00:00Z" timezone="UTC" /></MemoryRouter>);
    expect(rawMetric('report-fanout').rawValue).toBeNull();
    expect(screen.getByTestId('notification-report-brief').querySelector('[data-operational-metric="report-fanout"]'))
      .toHaveAttribute('data-value-state', 'missing');
  });
});
