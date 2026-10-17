import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationLog } from '@/api/types';
import type { FormatOptions } from '@/lib/dateFormat';
import type { ReactNode } from 'react';
import { NotificationLatencyPanel } from './NotificationLatencyPanel';
import { AlertFatiguePanel } from './AlertFatiguePanel';
import { NotificationBurnRatePanel } from './NotificationBurnRatePanel';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';

const state = vi.hoisted(() => ({
  logs: [] as NotificationLog[] | undefined, error: null as Error | null,
  isLoading: false, fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused', retry: vi.fn(),
  updatedAt: undefined as number | undefined,
}));
const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'America/Los_Angeles' }));
vi.mock('@/hooks/useDateFormat', async () => {
  const dates = await import('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      tz: datePreferences.tz,
      formatDateTime: (value: string | Date) => dates.formatDateTime(value, {
        locale: datePreferences.locale, tz: datePreferences.tz,
      }),
      formatTime: (value: string | Date, override?: FormatOptions) => dates.formatTime(value, {
        locale: datePreferences.locale, tz: datePreferences.tz, ...override,
      }),
    }),
  };
});
function logsQuery() {
  return {
    data: state.logs, isLoading: state.isLoading, isError: state.error != null,
    isPending: state.logs === undefined && state.error == null,
    isFetching: state.fetchStatus === 'fetching', fetchStatus: state.fetchStatus,
    error: state.error, refetch: state.retry, dataUpdatedAt: state.updatedAt,
  };
}
vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationDeliveryLogs: () => logsQuery(),
  useNotificationAnalysisLogs: () => logsQuery(),
}));
vi.mock('react-i18next', async () => {
  const { createInstance } = await import('i18next');
  const { default: english } = await import('@/i18n/en.json');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: english } }, interpolation: { escapeValue: false } });
  return { useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) };
});
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles, inertCartesianParts } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles, ...inertCartesianParts,
    BarChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="notification-chart-data" data-rows={JSON.stringify(data)}>{children}</div>
    ),
    Bar: () => null,
    Cell: () => null,
    ReferenceLine: () => null,
  };
});

describe('NotificationLatencyPanel shared delivery table', () => {
  beforeEach(() => {
    state.logs = [];
    state.error = null;
    state.isLoading = false;
    state.fetchStatus = 'idle';
    state.retry.mockClear();
    state.updatedAt = undefined;
    datePreferences.locale = 'en-US';
    datePreferences.tz = 'America/Los_Angeles';
  });
  it('updates populated delivery timestamps with locale and zone without changing latency', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Clock delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 1250,
      created_at: '2024-01-01T00:30:00Z', sent_at: null,
    }];
    const { rerender } = render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(table).toHaveTextContent('Dec 31, 2023, 04:30 PM (America/Los_Angeles)');
    datePreferences.locale = 'en-GB';
    datePreferences.tz = 'Asia/Tokyo';
    rerender(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(table).toHaveTextContent('1 Jan 2024, 09:30 (Asia/Tokyo)');
    expect(table).toHaveTextContent('1,250.00 ms');
    expect(table).toHaveTextContent('Clock delivery');
  });

  it('keeps fatigue hour buckets in the browser zone while updating 12/24-hour labels', () => {
    const instant = '2024-01-01T00:30:00Z';
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Hour delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 0,
      created_at: instant, sent_at: null,
    }];
    const { rerender } = render(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
    const hourRows = () => JSON.parse(
      screen.getAllByTestId('notification-chart-data')[1]!.getAttribute('data-rows')!,
    ) as { hour: string; count: number }[];
    const before = hourRows();
    expect(before).toHaveLength(24);
    expect(before[0]?.hour).toBe('12:00 AM');
    expect(before[new Date(instant).getHours()]?.count).toBe(1);
    expect(screen.getByText(/Firings by hour of day across every rule/)).toHaveTextContent(
      `(${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    );
    datePreferences.locale = 'en-GB';
    datePreferences.tz = 'Asia/Tokyo';
    rerender(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
    const after = hourRows();
    expect(after[0]?.hour).toBe('00:00');
    expect(after.map(row => row.count)).toEqual(before.map(row => row.count));
    expect(screen.getByRole('table', { name: 'Hour delivery' })).toHaveTextContent('1 · 1.00/day');
  });

  it('formats burn-rate instants without changing window outcomes or the analysis instant', () => {
    state.updatedAt = Date.parse('2024-01-01T00:30:00Z');
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Burn delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 0,
      created_at: '2024-01-01T00:15:00Z', sent_at: null,
    }];
    const { rerender } = render(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
    expect(screen.getByTestId('notification-burn-rate-as-of')).toHaveTextContent(
      'Dec 31, 2023, 04:30 PM (America/Los_Angeles)',
    );
    const rows = () => JSON.parse(
      screen.getByTestId('notification-chart-data').getAttribute('data-rows')!,
    ) as { time: string; sent: number; failed: number }[];
    const before = rows();
    expect(before.reduce((total, row) => total + row.sent, 0)).toBe(1);
    datePreferences.locale = 'en-GB';
    datePreferences.tz = 'Asia/Tokyo';
    rerender(<MemoryRouter><NotificationBurnRatePanel /></MemoryRouter>);
    expect(screen.getByTestId('notification-burn-rate-as-of')).toHaveTextContent(
      '1 Jan 2024, 09:30 (Asia/Tokyo)',
    );
    expect(rows().map(({ sent, failed }) => ({ sent, failed })))
      .toEqual(before.map(({ sent, failed }) => ({ sent, failed })));
    expect(rows().map(row => row.time)).not.toEqual(before.map(row => row.time));
  });
  it.each([
    { name: 'empty delivery logs', logs: [] },
    { name: 'deliveries without usable latency', logs: [{
      id: 1, channel_id: 1, alert_id: null, title: 'Unmeasured delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: null,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }] },
  ] satisfies { name: string; logs: NotificationLog[] }[])(
    'keeps unknown Apdex neutral for $name',
    ({ logs }) => {
      state.logs = logs;
      render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
      const brief = screen.getByTestId('notification-latency-brief');
      assertOperationalMetricUnavailable(brief, 'Delivery Apdex');
      assertOperationalBriefDisclosure(brief, 'No usable latency measurements');
      expect(brief).toHaveTextContent('No metric values are available yet.');
    },
  );

  it.each([
    { name: 'missing', latency: undefined },
    { name: 'null', latency: null },
    { name: 'NaN', latency: Number.NaN },
    { name: 'positive infinity', latency: Number.POSITIVE_INFINITY },
    { name: 'negative infinity', latency: Number.NEGATIVE_INFINITY },
    { name: 'negative latency', latency: -1.25 },
  ])('keeps $name latency missing rather than measured zero', ({ latency }) => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Unusable delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: latency,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const brief = screen.getByTestId('notification-latency-brief');
    for (const label of ['p50 latency', 'p95 latency', 'p99 latency', 'Delivery Apdex']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expect(screen.queryByRole('table', { name: 'Slowest delivery records' })).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(brief, 'No usable latency measurements');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('4 empty fields are hidden.');
    fireEvent.keyDown(dialog, { key: 'Escape' });
  });

  it.each([
    { name: 'measured zero', latency: 0, value: '0.00 ms' },
    { name: 'signed zero', latency: -0, value: '0.00 ms' },
    { name: 'positive signed fraction', latency: +1250.25, value: '1,250.25 ms' },
    { name: 'submillisecond fraction', latency: 0.125, value: '0.13 ms' },
  ])('preserves $name as a usable measurement', ({ latency, value }) => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Usable delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: latency,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const brief = screen.getByTestId('notification-latency-brief');
    const p50 = brief.querySelector('[data-operational-metric="latency-p50"]');
    expect(p50).toHaveAttribute('data-value-state', 'value');
    expect(p50?.querySelector('[data-operational-value]')).toHaveTextContent(value);
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(table).toHaveTextContent(value);
    expect(within(table).getByText('Measured')).toBeInTheDocument();
  });

  it('pluralizes cohort samples using the usable denominator rather than all attempts', () => {
    const base: NotificationLog = {
      id: 1, channel_id: 1, alert_id: null, title: 'Delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 5000,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    };
    state.logs = [base, { ...base, id: 2, latency_ms: 0 }, { ...base, id: 3, latency_ms: null }];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(screen.getAllByText('2 samples · 50.00% tail')).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId('notification-latency-brief')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 deliveries have usable latency measurements.');
    expect(screen.getByRole('dialog')).toHaveTextContent('50.00% slower than 4 seconds');
  });

  it('uses singular whole-sentence copy for one measured delivery', () => {
    const delivery: NotificationLog = {
      id: 1, channel_id: 1, alert_id: null, title: 'Delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 500,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    };
    state.logs = [delivery];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const brief = screen.getByTestId('notification-latency-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('1 delivery has a usable latency measurement.');
  });
  it.each([
    { satisfied: 0, value: '0.000', tone: 'warning' },
    { satisfied: 16, value: '0.800', tone: 'warning' },
    { satisfied: 17, value: '0.850', tone: 'success' },
    { satisfied: 20, value: '1.000', tone: 'success' },
  ])('preserves the known Apdex $value $tone tone', ({ satisfied, value, tone }) => {
    state.logs = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1, channel_id: 1, alert_id: null, title: `Delivery ${index + 1}`, message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: index < satisfied ? 0 : 5000,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }));
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const metric = screen.getByTestId('notification-latency-brief')
      .querySelector('[data-operational-metric="latency-apdex"]');
    expect(metric).toHaveAttribute('data-value-state', 'value');
    expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent(value);
    expect(metric?.querySelector('[data-operational-value]')).toHaveClass(`text-[var(--semantic-${tone})]`);
  });

  describe('AlertFatiguePanel count copy', () => {
    beforeEach(() => {
      state.error = null;
      state.isLoading = false;
      state.fetchStatus = 'idle';
    });

    it.each([
      { count: 0, rules: 'of 0 rules', days: null as string | null },
      { count: 1, rules: 'of 1 rules', days: 'across 1.00 days' },
      { count: 2, rules: 'of 2 rules', days: 'across 2.00 days' },
    ])('uses canonical plural forms for $count rules', ({ count, rules, days }) => {
      state.logs = Array.from({ length: count }, (_, index) => ({
        id: index + 1, channel_id: 1, alert_id: null, title: index === 0 ? 'Battery warning' : 'Security warning',
        message: '', status: 'sent', severity: 'warn', error: '', latency_ms: 0,
        created_at: `2026-08-0${4 + index * 2}T12:00:00Z`, sent_at: null,
      }));
      render(<MemoryRouter><AlertFatiguePanel /></MemoryRouter>);
      const brief = screen.getByTestId('alert-fatigue-brief');
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      expect(drawer).toHaveTextContent(rules);
      if (days == null) {
        fireEvent.keyDown(drawer, { key: 'Escape' });
        assertOperationalMetricUnavailable(brief, 'Notifications per day');
      } else {
        expect(drawer).toHaveTextContent(days);
        fireEvent.keyDown(drawer, { key: 'Escape' });
      }
    });
  });

  it('preserves notification text, provenance, status and latency without subset checklists', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'User TITLE unchanged', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 1250,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(within(table).getByText('User TITLE unchanged')).toBeInTheDocument();
    expect(within(table).getByText('Measured')).toBeInTheDocument();
    expect(within(table).getByText(/warn · sent/)).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: /1,250\.00 ms/ })).toHaveClass('text-right');
    expect(within(table).queryByRole('button', { name: /Filter/ })).not.toBeInTheDocument();
  });

  it('reviews measured percentiles, trimmed mean, sample denominator, tail share, and Apdex thresholds', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Measured delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 1250,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const brief = screen.getByTestId('notification-latency-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    for (const key of ['latency-p50', 'latency-p95', 'latency-p99']) {
      const metric = brief.querySelector(`[data-operational-metric="${key}"]`);
      expect(metric).toHaveAttribute('data-value-state', 'value');
      expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent('1,250.00 ms');
    }
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('trimmed mean 1,250.00 ms');
    expect(drawer).toHaveTextContent('1 delivery has a usable latency measurement.');
    expect(screen.getAllByText('1 samples · 0.00% tail')).toHaveLength(2);
    expect(drawer).toHaveTextContent('0.00% slower than 4 seconds');
    expect(drawer).toHaveTextContent('T = 1 s · tolerating through 4 s');
    expect(drawer).toHaveTextContent('0.500');
    expect(drawer).toHaveTextContent('not a guaranteed complete analysis window');
  });

  it('describes only usable measured and derived samples, excluding unmeasured attempts', () => {
    const base: NotificationLog = {
      id: 1, channel_id: 1, alert_id: null, title: 'Measured delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 0,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    };
    state.logs = [
      base,
      { ...base, id: 2, title: 'Derived delivery', latency_ms: null, sent_at: '2026-08-04T12:00:02Z' },
      { ...base, id: 3, title: 'Unmeasured delivery', latency_ms: null },
      { ...base, id: 4, title: 'Invalid delivery', latency_ms: -1, sent_at: '2026-08-04T11:59:59Z' },
    ];
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(screen.queryByText(/Measure all recorded delivery attempts/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/for attempts with usable measurements/).length).toBeGreaterThan(0);
    const brief = screen.getByTestId('notification-latency-brief');
    expect(brief.querySelector('[data-operational-metric="latency-p50"] [data-operational-value]'))
      .toHaveTextContent('1,000.00 ms');
    const table = screen.getByRole('table', { name: 'Slowest delivery records' });
    expect(within(table).getByText('Measured')).toBeInTheDocument();
    expect(within(table).getByText('Derived')).toBeInTheDocument();
    expect(within(table).queryByText('Unmeasured delivery')).not.toBeInTheDocument();
    expect(within(table).queryByText('Invalid delivery')).not.toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('2 deliveries have usable latency measurements.');
    expect(drawer).not.toHaveTextContent('measured deliveries');
  });

  it('keeps the real latency brief busy without invented measurements on first load', () => {
    state.logs = undefined;
    state.isLoading = true;
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    const brief = screen.getByTestId('notification-latency-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.queryByText('No usable latency measurements')).not.toBeInTheDocument();
  });

  it('retains cached latency values and slowest records after a failed refresh', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Retained delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 0,
      created_at: '2026-08-04T12:00:00Z', sent_at: null,
    }];
    state.error = new Error('refresh offline');
    render(<MemoryRouter><NotificationLatencyPanel /></MemoryRouter>);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    const brief = screen.getByTestId('notification-latency-brief');
    const p50 = brief.querySelector('[data-operational-metric="latency-p50"]');
    expect(p50).toHaveAttribute('data-value-state', 'value');
    expect(p50?.querySelector('[data-operational-value]')).toHaveTextContent('0.00 ms');
    expect(screen.getByRole('table', { name: 'Slowest delivery records' })).toHaveTextContent('Retained delivery');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
});

describe.each([
  { name: 'latency', Panel: NotificationLatencyPanel, sections: ['Latency distribution', 'Severity and status cohorts', 'Slowest delivery records'], briefId: 'notification-latency-brief', drawerIcons: { empty: 0, populated: 4 } },
  { name: 'fatigue', Panel: AlertFatiguePanel, sections: ['When notifications arrive', 'Rule breakdown'], briefId: 'alert-fatigue-brief', drawerIcons: { empty: 1, populated: 2 } },
  { name: 'burn rate', Panel: NotificationBurnRatePanel, sections: ['Delivery outcomes by hour', 'Severity breakdown'], briefId: 'notification-burn-rate-brief', drawerIcons: { empty: 1, populated: 4 } },
])('$name source feedback', ({ Panel, sections, briefId, drawerIcons }) => {
  beforeEach(() => {
    state.logs = undefined;
    state.error = null;
    state.isLoading = false;
    state.fetchStatus = 'idle';
    state.retry.mockClear();
    state.updatedAt = undefined;
    datePreferences.locale = 'en-US';
    datePreferences.tz = 'America/Los_Angeles';
  });

  it('keeps historical provenance separate from fetch freshness through refresh failure and recovery', () => {
    state.updatedAt = Date.parse('2024-01-01T00:30:00Z');
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Historical delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 1250,
      created_at: '2024-01-01T00:15:00Z', sent_at: null,
    }];
    const { rerender } = render(<MemoryRouter><Panel /></MemoryRouter>);
    fireEvent.click(within(screen.getByTestId(briefId)).getByRole('button', { name: 'Review details' }));
    const badge = () => within(screen.getByRole('dialog')).getByLabelText('Historical');
    expect(badge()).toHaveAttribute('data-provenance', 'historical');
    expect(badge()).toHaveAttribute('data-data-status', 'ok');
    expect(badge()).toHaveAttribute('title', expect.stringContaining(
      'Last updated: Dec 31, 2023, 04:30 PM (America/Los_Angeles)',
    ));
    expect(badge()).not.toHaveAttribute('title', expect.stringContaining('04:15 PM'));
    const values = Array.from(screen.getByTestId(briefId).querySelectorAll('[data-operational-value]'),
      metric => metric.textContent);

    state.error = new Error('refresh failed');
    rerender(<MemoryRouter><Panel /></MemoryRouter>);
    expect(badge()).toHaveAttribute('data-provenance', 'historical');
    expect(badge()).toHaveAttribute('data-data-status', 'stale');
    expect(badge()).toHaveAttribute('title', expect.stringContaining('04:30 PM'));
    expect(Array.from(screen.getByTestId(briefId).querySelectorAll('[data-operational-value]'),
      metric => metric.textContent)).toEqual(values);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();

    state.error = null;
    state.updatedAt = Date.parse('2024-01-01T00:45:00Z');
    rerender(<MemoryRouter><Panel /></MemoryRouter>);
    expect(badge()).toHaveAttribute('data-provenance', 'historical');
    expect(badge()).toHaveAttribute('data-data-status', 'ok');
    expect(badge()).toHaveAttribute('title', expect.stringContaining('04:45 PM'));
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  });

  it('does not substitute a delivery event time for an unknown fetch time', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Historical delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 1250,
      created_at: '2024-01-01T00:15:00Z', sent_at: null,
    }];
    render(<MemoryRouter><Panel /></MemoryRouter>);
    fireEvent.click(within(screen.getByTestId(briefId)).getByRole('button', { name: 'Review details' }));
    const badge = within(screen.getByRole('dialog')).getByLabelText('Historical');
    expect(badge).toHaveAttribute('data-provenance', 'historical');
    expect(badge).toHaveAttribute('title', 'Read from stored history rather than current state.');
  });

  it.each([false, true])('keeps supporting icons neutral with populated data: %s', populated => {
    state.logs = populated ? [{
      id: 1, channel_id: 1, alert_id: null, title: 'Neutral icon delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 5000,
      created_at: new Date().toISOString(), sent_at: null,
    }] : [];
    const { container } = render(<MemoryRouter><Panel /></MemoryRouter>);
    const headingIcons = container.querySelectorAll('svg.h-4.w-4.text-\\[var\\(--text-secondary\\)\\]');
    expect(headingIcons.length).toBeGreaterThan(0);
    if (!populated) {
      const emptyIcons = container.querySelectorAll('svg.h-8.w-8');
      expect(emptyIcons.length).toBeGreaterThan(0);
      for (const icon of emptyIcons) expect(icon).toHaveClass('text-[var(--text-muted)]');
    }
    fireEvent.click(within(screen.getByTestId(briefId)).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    const contextIcons = drawer.querySelectorAll('svg.h-5.w-5');
    expect(contextIcons).toHaveLength(populated ? drawerIcons.populated : drawerIcons.empty);
    for (const icon of contextIcons) {
      expect(icon).toHaveClass('text-[var(--text-muted)]');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    if (populated) {
      expect(screen.getByTestId(briefId).querySelectorAll('[data-value-state="value"]').length)
        .toBeGreaterThan(0);
    }
  });

  it('shows active loading without successful empty results', () => {
    state.isLoading = true;
    state.fetchStatus = 'fetching';
    render(<MemoryRouter><Panel /></MemoryRouter>);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText(/No (usable|recorded|eligible)/)).not.toBeInTheDocument();
    for (const section of sections) expect(screen.getByText(section)).toBeInTheDocument();
  });

  it('shows a retryable pause without data, then recovers to a successful empty result', () => {
    state.fetchStatus = 'paused';
    const { rerender } = render(<MemoryRouter><Panel /></MemoryRouter>);
    expect(screen.getAllByText('Refresh paused').length).toBeGreaterThan(0);
    expect(screen.queryByTestId(briefId)).not.toBeInTheDocument();
    for (const section of sections) expect(screen.getByText(section)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Retry/ })[0]!);
    expect(state.retry).toHaveBeenCalledOnce();

    state.fetchStatus = 'idle';
    state.logs = [];
    rerender(<MemoryRouter><Panel /></MemoryRouter>);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByTestId(briefId)).not.toHaveAttribute('aria-busy', 'true');
    for (const section of sections) expect(screen.getByText(section)).toBeInTheDocument();
  });

  it('retains zero-valued records through refresh failure and clears the warning on recovery', () => {
    state.logs = [{
      id: 1, channel_id: 1, alert_id: null, title: 'Retained delivery', message: '',
      status: 'sent', severity: 'warn', error: '', latency_ms: 0,
      created_at: new Date().toISOString(), sent_at: null,
    }];
    const { rerender } = render(<MemoryRouter><Panel /></MemoryRouter>);
    const initialMetrics = screen.getByTestId(briefId).querySelectorAll('[data-operational-value]');
    const values = Array.from(initialMetrics, metric => metric.textContent);
    expect(values.length).toBeGreaterThan(0);
    state.error = new Error('refresh failed');
    rerender(<MemoryRouter><Panel /></MemoryRouter>);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(Array.from(screen.getByTestId(briefId).querySelectorAll('[data-operational-value]'), metric => metric.textContent)).toEqual(values);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    state.error = null;
    rerender(<MemoryRouter><Panel /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId(briefId)).toBeInTheDocument();
  });
});
