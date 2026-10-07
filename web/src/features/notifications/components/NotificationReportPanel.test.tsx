import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationReport } from '@/api/types';

vi.mock('@/api/hooks/useNotifications', () => ({ useNotificationReport: vi.fn() }));
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ title, data }: { title: string; data: unknown[] }) => (
    <div>{title}<output data-testid="timeline-buckets">{JSON.stringify(data)}</output></div>
  ),
  Bar: () => null,
  BarChart: () => null,
  CartesianGrid: () => null,
  ChartLegend: () => null,
  ChartTooltip: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { useNotificationReport } from '@/api/hooks/useNotifications';
import { NotificationReportPanel } from './NotificationReportPanel';

const useReport = vi.mocked(useNotificationReport);
const report: NotificationReport = {
  from: '2026-01-01',
  to: '2026-01-30',
  from_instant: '2026-01-01T08:00:00Z',
  to_exclusive: '2026-01-31T08:00:00Z',
  timezone: 'America/Los_Angeles',
  triggered: 3,
  deliveries: 5,
  outbound_http_calls: 11,
  uncorrelated_deliveries: 0,
  by_source: [{ key: 'system', count: 2 }, { key: 'alert', count: 1 }],
  by_type: [{ key: 'system.mqtt.outage', count: 2 }, { key: 'alert.triggered', count: 1 }],
  by_severity: [{ key: 'warn', count: 3 }],
  by_channel: [{ key: 'email', count: 3 }, { key: 'webhook', count: 2 }],
  by_status: [{ key: 'sent', count: 4 }, { key: 'failed', count: 1 }],
  daily: [{ day: '2026-01-01', triggered: 3, deliveries: 5 }],
};

function renderPanel() {
  return render(<MemoryRouter><NotificationReportPanel fromInstant="2026-01-01T08:00:00Z" toExclusive="2026-01-31T08:00:00Z" timezone="America/Los_Angeles" /></MemoryRouter>);
}

beforeEach(() => {
  useReport.mockReturnValue({ data: report, isLoading: false, isError: false } as ReturnType<typeof useNotificationReport>);
});

describe('NotificationReportPanel', () => {
  it('keeps every breakdown row in the shared evidence table engine', () => {
    renderPanel();
    expect(screen.getAllByRole('table')).toHaveLength(5);
    const sources = screen.getByRole('table', { name: 'Trigger sources' });
    expect(within(sources).getAllByRole('row')).toHaveLength(report.by_source.length + 1);
    expect(within(sources).getByRole('cell', { name: 'System' })).toBeInTheDocument();
    expect(within(sources).getByRole('cell', { name: '2' })).toHaveClass('text-right', 'tabular-nums');
  });

  it('separates triggered events from multi-channel deliveries and shows each breakdown', () => {
    renderPanel();
    expect(useReport).toHaveBeenCalledWith('2026-01-01T08:00:00Z', '2026-01-31T08:00:00Z', 'America/Los_Angeles');
    expect(screen.queryByText('Choose date range')).not.toBeInTheDocument();
    expect(screen.getByText('Triggers recorded')).toBeInTheDocument();
    expect(screen.getByText('Channel deliveries')).toBeInTheDocument();
    expect(screen.getByText('Outbound HTTP calls').closest('[data-operational-metric]')).toHaveTextContent('11');
    expect(screen.getByText(/Outbound HTTP calls include retries and failures/)).toBeInTheDocument();
    expect(screen.getByText(/Compare with Notifications under API Logs’ By Service/)).toBeInTheDocument();
    expect(screen.getByText('1.67')).toBeInTheDocument();
    expect(screen.getByText('Deliveries without a linked trigger')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Alert')).toBeInTheDocument();
    expect(screen.getByText('System MQTT outage')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delivery outcomes' })).toBeInTheDocument();
    expect(screen.getByText('Daily activity')).toBeInTheDocument();
  });

  it('excludes unattributed historical deliveries from the fan-out ratio', () => {
    useReport.mockReturnValue({
      data: { ...report, uncorrelated_deliveries: 2 },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getByText('1.00')).toBeInTheDocument();
    expect(screen.getByText('Deliveries without a linked trigger').closest('[data-operational-metric]')).toHaveTextContent('2');
    expect(screen.getByText(/Older deliveries without an event identifier appear only in delivery counts/)).toBeInTheDocument();
  });

  it('aggregates long all-time windows without dropping older daily counts', () => {
    const daily = Array.from({ length: 4000 }, (_, index) => ({
      day: new Date(Date.UTC(2015, 0, 1 + index)).toISOString().slice(0, 10),
      triggered: 1,
      deliveries: 2,
    }));
    useReport.mockReturnValue({
      data: { ...report, daily },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getByText('Annual activity')).toBeInTheDocument();
    const buckets = JSON.parse(screen.getByTestId('timeline-buckets').textContent ?? '') as {
      period: string; triggered: number; deliveries: number
    }[];
    expect(buckets.length).toBeLessThanOrEqual(12);
    expect(buckets.reduce((total, row) => total + row.triggered, 0)).toBe(4000);
    expect(buckets.reduce((total, row) => total + row.deliveries, 0)).toBe(8000);
  });

  it('keeps all breakdown panels visible with no activity', () => {
    useReport.mockReturnValue({
      data: { ...report, triggered: 0, deliveries: 0, by_source: [], by_type: [], by_severity: [], by_channel: [], by_status: [], daily: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getAllByText('No activity in this period')).toHaveLength(5);
    expect(screen.getByText('Trigger sources')).toBeInTheDocument();
  });

  it('shows loading and error feedback rather than success-shaped zero counts', () => {
    useReport.mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useNotificationReport>);
    const view = renderPanel();
    const brief = screen.getByTestId('notification-report-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Delivery outcomes' })).toBeInTheDocument();
    view.unmount();
    useReport.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('offline'), refetch: vi.fn() } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    const unavailable = screen.getByTestId('notification-report-brief');
    expect(unavailable.querySelector('[data-operational-metric="report-triggered"]')).toHaveAttribute('data-value-state', 'missing');
    expect(unavailable.querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(screen.getByRole('heading', { name: 'Trigger sources' })).toBeInTheDocument();
  });

  it('retains the complete cached report when a background refresh fails', () => {
    useReport.mockReturnValue({
      data: report, dataUpdatedAt: Date.now(), isLoading: false, isError: true,
      error: new Error('refresh offline'), refetch: vi.fn(),
    } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(5);
    expect(screen.getByText('Triggers recorded')).toBeInTheDocument();
    expect(screen.getByText('System MQTT outage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('reviews raw-count evidence, attribution limits, HTTP scope, and exact exclusive bounds in the actual drawer', () => {
    renderPanel();
    const brief = screen.getByTestId('notification-report-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(brief.querySelector('[data-operational-metric="report-fanout"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('1.67');
    expect(drawer).toHaveTextContent('Older deliveries without an event identifier');
    expect(drawer).toHaveTextContent('Outbound HTTP calls include retries and failures');
    expect(drawer).toHaveTextContent('2026-01-01T08:00:00Z');
    expect(drawer).toHaveTextContent('2026-01-31T08:00:00Z');
    expect(drawer).toHaveTextContent('America/Los_Angeles');
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getAllByRole('table')).toHaveLength(5);
  });
});
