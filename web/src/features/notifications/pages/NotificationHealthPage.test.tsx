import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationLog } from '@/api/types';
import '../../../i18n';

import NotificationHealthPage from './NotificationHealthPage';

const queries = vi.hoisted(() => ({
  events: { data: [] as NotificationLog[] | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  deliveries: { data: [] as NotificationLog[] | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
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
    queries.events.refetch.mockClear();
    queries.deliveries.refetch.mockClear();
  });

  it('keeps all three analyses and their empty states on one route', () => {
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    for (const [id, title] of [
      ['fatigue', 'Alert fatigue'],
      ['burn-rate', 'Notification burn rate'],
      ['latency', 'Notification latency'],
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

  it('offers a responsive, keyboard-accessible overview without collapsing any analysis', () => {
    render(<MemoryRouter initialEntries={['/notifications/health#burn-rate']}><NotificationHealthPage /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Notification health sections' });
    expect(nav).toHaveClass('grid', 'md:grid-cols-3');
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: /Notification burn rate/ }))
      .toHaveAttribute('aria-current', 'location');
    for (const title of ['Alert fatigue', 'Notification burn rate', 'Notification latency']) {
      const section = screen.getByRole('region', { name: title });
      expect(section).toHaveClass('min-w-0', 'scroll-mt-24');
      expect(within(section).getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('region', { name: /metrics/i })).toHaveLength(3);
  });

  it('keeps each metrics band readable at phone, tablet, and desktop widths', () => {
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    for (const name of ['Alert fatigue metrics', 'Delivery SLO metrics', 'Notification latency metrics']) {
      const band = screen.getByRole('region', { name });
      expect(band.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
      expect(band.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
      expect(within(band).getByRole('list')).toHaveClass('sm:grid-cols-2', 'md:grid-cols-3', '3xl:grid-cols-6');
    }
    expect(screen.getByRole('link', { name: 'Manage delivery channels' }))
      .toHaveAttribute('href', '/notifications/channels');
  });

  it('leaves reliability and latency visible if fatigue history fails', () => {
    queries.events.data = undefined;
    queries.events.isError = true;
    queries.events.error = new Error('history unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Notification burn rate' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notification latency' })).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
  });

  it('leaves fatigue visible when the shared delivery-history query fails', () => {
    queries.deliveries.data = undefined;
    queries.deliveries.isError = true;
    queries.deliveries.error = new Error('deliveries unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Alert fatigue' })).toBeInTheDocument();
    expect(screen.getByText('No notifications have been delivered yet, so there is nothing to score.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    const burnRate = screen.getByRole('region', { name: 'Notification burn rate' });
    fireEvent.click(within(burnRate).getAllByRole('button', { name: 'Retry' })[0]);
    expect(queries.deliveries.refetch).toHaveBeenCalledOnce();
    expect(queries.events.refetch).not.toHaveBeenCalled();
  });

  it('retains successfully loaded empty histories after a delivery refresh fails', () => {
    queries.deliveries.isError = true;
    queries.deliveries.error = new Error('deliveries unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByText('No notifications have been delivered yet, so there is nothing to score.')).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
    expect(screen.getByText(/No measured channel deliveries yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    const latency = screen.getByRole('region', { name: 'Notification latency' });
    fireEvent.click(within(latency).getByRole('button', { name: 'Refresh' }));
    expect(queries.deliveries.refetch).toHaveBeenCalledOnce();
    expect(queries.events.refetch).not.toHaveBeenCalled();
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

    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(within(fatigue).getByText('Rule breakdown')).toBeInTheDocument();
    expect(within(fatigue).getAllByText('Battery low').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Notification burn rate' }))
      .getByText('Severity breakdown')).toBeInTheDocument();
    const latency = screen.getByRole('region', { name: 'Notification latency' });
    expect(within(latency).getByRole('heading', { name: 'Slowest delivery records' })).toBeInTheDocument();
    expect(within(latency).getByText('Measured')).toBeInTheDocument();
  });

  it('wraps long rule and delivery names instead of clipping details on narrow screens', () => {
    const now = new Date().toISOString();
    const title = 'Unusually long battery alert rule with important identifying details';
    const log: NotificationLog = {
      id: 42, channel_id: 1, alert_id: 7, title, message: '',
      status: 'sent', severity: 'warning', error: '', created_at: now, sent_at: now,
    };
    queries.events.data = [log];
    queries.deliveries.data = [{ ...log, latency_ms: 450 }];
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(within(fatigue).getAllByText(title).some((element) => element.classList.contains('break-words'))).toBe(true);
    const latency = screen.getByRole('region', { name: 'Notification latency' });
    expect(within(latency).getAllByText(title).some((element) => element.classList.contains('break-words'))).toBe(true);
  });
});
