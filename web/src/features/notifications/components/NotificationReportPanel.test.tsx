import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationReport } from '@/api/types';

vi.mock('@/api/hooks/useNotifications', () => ({ useNotificationReport: vi.fn() }));
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ title }: { title: string }) => <div>{title}</div>,
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
vi.mock('@/components/forms', () => ({
  RangePicker: () => <div>Choose date range</div>,
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
  triggered: 3,
  deliveries: 5,
  uncorrelated_deliveries: 0,
  by_source: [{ key: 'system', count: 2 }, { key: 'alert', count: 1 }],
  by_type: [{ key: 'system.mqtt.outage', count: 2 }, { key: 'alert.triggered', count: 1 }],
  by_severity: [{ key: 'warn', count: 3 }],
  by_channel: [{ key: 'email', count: 3 }, { key: 'webhook', count: 2 }],
  by_status: [{ key: 'sent', count: 4 }, { key: 'failed', count: 1 }],
  daily: [{ day: '2026-01-01', triggered: 3, deliveries: 5 }],
};

function renderPanel() {
  return render(<MemoryRouter><NotificationReportPanel /></MemoryRouter>);
}

beforeEach(() => {
  useReport.mockReturnValue({ data: report, isLoading: false, isError: false } as ReturnType<typeof useNotificationReport>);
});

describe('NotificationReportPanel', () => {
  it('separates triggered events from multi-channel deliveries and shows each breakdown', () => {
    renderPanel();
    expect(screen.getByText('Triggers recorded')).toBeInTheDocument();
    expect(screen.getByText('Channel deliveries')).toBeInTheDocument();
    expect(screen.getByText('1.7')).toBeInTheDocument();
    expect(screen.getByText('Unattributed deliveries')).toBeInTheDocument();
    expect(screen.getByText('system')).toBeInTheDocument();
    expect(screen.getByText('alert')).toBeInTheDocument();
    expect(screen.getByText('system.mqtt.outage')).toBeInTheDocument();
    expect(screen.getByText('Delivery outcomes')).toBeInTheDocument();
    expect(screen.getByText('Daily activity')).toBeInTheDocument();
  });

  it('excludes unattributed historical deliveries from the fan-out ratio', () => {
    useReport.mockReturnValue({
      data: { ...report, uncorrelated_deliveries: 2 },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.getByText('Unattributed deliveries').closest('[data-role="metric-card"]')).toHaveTextContent('2');
    expect(screen.getByText(/Older deliveries without an event identifier appear only in delivery counts/)).toBeInTheDocument();
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
    expect(screen.queryByText('Triggers recorded')).not.toBeInTheDocument();
    view.unmount();
    useReport.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('offline'), refetch: vi.fn() } as ReturnType<typeof useNotificationReport>);
    renderPanel();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
