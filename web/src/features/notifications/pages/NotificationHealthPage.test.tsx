import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationLog } from '@/api/types';
import '../../../i18n';

import NotificationHealthPage from './NotificationHealthPage';

const queries = vi.hoisted(() => ({
  events: { data: [] as NotificationLog[], isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  deliveries: { data: [] as NotificationLog[], isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationAnalysisLogs: () => queries.events,
  useNotificationDeliveryLogs: () => queries.deliveries,
}));

describe('Notification Health', () => {
  beforeEach(() => {
    queries.events.isError = false;
    queries.events.error = null;
    queries.events.data = [];
    queries.deliveries.isError = false;
    queries.deliveries.error = null;
    queries.deliveries.data = [];
  });

  it('keeps all three analyses and their empty states on one route', () => {
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    for (const [id, title] of [
      ['fatigue', 'Alert Fatigue'],
      ['burn-rate', 'Notification Burn Rate'],
      ['latency', 'Notification Latency'],
    ]) {
      const section = screen.getByRole('region', { name: title });
      expect(section).toHaveAttribute('id', id);
      expect(within(section).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: title })).toHaveAttribute('href', `#${id}`);
    }
    expect(screen.getByText('No notifications have been delivered yet, so there is nothing to score.')).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
    expect(screen.getByText(/No measured channel deliveries yet/)).toBeInTheDocument();
  });

  it('leaves reliability and latency visible if fatigue history fails', () => {
    queries.events.isError = true;
    queries.events.error = new Error('history unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Notification Burn Rate' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notification Latency' })).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
  });

  it('retains populated rule breakdowns, SLO outcomes, and measured latency records', () => {
    const now = new Date().toISOString();
    const base: NotificationLog = {
      id: 1, channel_id: 1, alert_id: 7, title: 'Battery low', message: '',
      status: 'sent', severity: 'warning', error: '', created_at: now, sent_at: now,
    };
    queries.events.data = [{ ...base, read_at: null }];
    queries.deliveries.data = [{ ...base, latency_ms: 450 }];

    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);

    const fatigue = screen.getByRole('region', { name: 'Alert Fatigue' });
    expect(within(fatigue).getByText('Rule Breakdown')).toBeInTheDocument();
    expect(within(fatigue).getAllByText('Battery low').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Notification Burn Rate' }))
      .getByText('Severity Breakdown')).toBeInTheDocument();
    const latency = screen.getByRole('region', { name: 'Notification Latency' });
    expect(within(latency).getByText('Slowest Delivery Records')).toBeInTheDocument();
    expect(within(latency).getByText('Measured')).toBeInTheDocument();
  });
});
