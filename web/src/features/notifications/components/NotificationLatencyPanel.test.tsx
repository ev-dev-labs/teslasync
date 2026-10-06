import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationLog } from '@/api/types';
import { NotificationLatencyPanel } from './NotificationLatencyPanel';

const state = vi.hoisted(() => ({
  logs: [] as NotificationLog[] | undefined, error: null as Error | null,
  isLoading: false, retry: vi.fn(),
}));
vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationDeliveryLogs: () => ({
    data: state.logs, isLoading: state.isLoading, isError: state.error != null,
    error: state.error, refetch: state.retry,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? `{{${key}}}`)),
  }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

describe('NotificationLatencyPanel shared delivery table', () => {
  beforeEach(() => {
    state.logs = [];
    state.error = null;
    state.isLoading = false;
    state.retry.mockClear();
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
    expect(drawer).toHaveTextContent('1 measured deliveries');
    expect(drawer).toHaveTextContent('0.00% slower than 4 seconds');
    expect(drawer).toHaveTextContent('T = 1 s · tolerating through 4 s');
    expect(drawer).toHaveTextContent('0.500');
    expect(drawer).toHaveTextContent('not a guaranteed complete analysis window');
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
