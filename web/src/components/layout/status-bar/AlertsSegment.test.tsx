import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '@/api/types';
import { severityTokens } from '@/lib/tokens';
import { StatusBarProvider } from './StatusBarContext';

let mockAlerts: Alert[] = [];
let mockAlertsError = false;
let mockAlertsSuccess = true;
let mockAlertsHaveMore = false;

vi.mock('@/api/hooks/useNotifications', () => ({
  usePriorityAlerts: () => ({
    data: {
      alerts: mockAlerts,
      count: mockAlerts.filter(
        (item) =>
          !item.is_read &&
          (item.severity === 'warning' ||
            item.severity === 'warn' ||
            item.severity === 'critical'),
      ).length,
      hasMore: mockAlertsHaveMore,
    },
    isError: mockAlertsError,
    isSuccess: mockAlertsSuccess && !mockAlertsError,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (value, [key, replacement]) =>
          value.replace(`{{${key}}}`, String(replacement)),
        fallback,
      ),
  }),
}));

import { AlertsSegment } from './AlertsSegment';

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    vehicle_id: 7,
    type: 'battery',
    severity: 'warning',
    title: 'Battery low',
    message: 'Battery level is below the configured threshold.',
    is_read: false,
    created_at: '2026-07-05T12:00:00.000Z',
    rule_signal: 'BatteryLevel',
    ...overrides,
  };
}

function renderSegment(iconOnly = false) {
  return render(
    <MemoryRouter>
      <AlertsSegment iconOnly={iconOnly} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAlerts = [];
  mockAlertsError = false;
  mockAlertsSuccess = true;
  mockAlertsHaveMore = false;
});

afterEach(() => {
  cleanup();
});

describe('AlertsSegment', () => {
  it('stays hidden without unread warning or critical alerts', () => {
    mockAlerts = [
      alert({ severity: 'info' }),
      alert({ id: 2, severity: 'critical', is_read: true }),
    ];

    const { container } = renderSegment();
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces alert-monitoring failures instead of silently disappearing', () => {
    mockAlertsError = true;
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Priority alert monitoring is unavailable',
    });
    expect(trigger).toHaveTextContent('Alerts unavailable');
    expect(trigger.className).toContain(severityTokens.critical.fg);

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Priority alerts' });
    expect(dialog).toHaveTextContent(
      'The latest priority alerts could not be refreshed.',
    );
    expect(within(dialog).getByRole('link')).toHaveAttribute(
      'href',
      '/notifications/inbox?read=unread',
    );
  });

  it('shows a compact unread priority count and normalizes warning severity', () => {
    mockAlerts = [
      alert({ id: 1, severity: 'warning' }),
      alert({ id: 2, severity: 'critical' }),
      alert({ id: 3, severity: 'info' }),
    ];
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open 2 unread alerts. Highest severity: Critical',
    });
    expect(trigger).toHaveTextContent('Alerts');
    expect(trigger).toHaveTextContent('2');
    expect(trigger.className).toContain(severityTokens.critical.fg);
  });

  it('includes warning severity in the trigger accessible name', () => {
    mockAlerts = [alert({ severity: 'warning' })];
    renderSegment();

    expect(
      screen.getByRole('button', {
        name: 'Open 1 unread alerts. Highest severity: Warning',
      }),
    ).toBeInTheDocument();
  });

  it('opens newest-first actionable alerts with drill-through links', () => {
    mockAlerts = [
      alert({ id: 1, title: 'Older alert', created_at: '2026-07-05T10:00:00.000Z' }),
      alert({
        id: 2,
        title: 'New critical alert',
        severity: 'critical',
        created_at: '2026-07-05T12:00:00.000Z',
      }),
    ];
    renderSegment();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open 2 unread alerts. Highest severity: Critical',
      }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Priority alerts' });
    const links = within(dialog).getAllByRole('link');
    expect(links[0]).toHaveAccessibleName(/Critical.*New critical alert/);
    expect(links[0]).toHaveTextContent('New critical alert');
    expect(links[0]).toHaveAttribute(
      'href',
      '/battery?vehicle_id=7&t=2026-07-05T12%3A00%3A00.000Z&signal=BatteryLevel',
    );
    expect(links.slice(-1)[0]).toHaveAttribute('href', '/notifications/inbox?read=unread');
  });

  it('caps previews at four while retaining the full unread count', () => {
    mockAlerts = Array.from({ length: 7 }, (_, index) =>
      alert({ id: index + 1, title: `Alert ${index + 1}` }),
    );
    renderSegment(true);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open 7 unread alerts. Highest severity: Warning',
      }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Priority alerts' });
    expect(within(dialog).getAllByRole('link')).toHaveLength(5);
    expect(dialog).toHaveTextContent('7 unread alerts');
  });

  it('labels a bounded priority count as a lower bound', () => {
    mockAlerts = Array.from({ length: 50 }, (_, index) =>
      alert({ id: index + 1, title: `Alert ${index + 1}` }),
    );
    mockAlertsHaveMore = true;
    renderSegment(true);

    expect(
      screen.getByRole('button', {
        name: 'Open 50+ unread alerts. Highest severity: Warning',
      }),
    ).toHaveTextContent('50+');
  });

  it('keeps an open popover mounted while monitoring is unavailable', () => {
    mockAlerts = [alert({ severity: 'critical' })];
    const { rerender } = renderSegment();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open 1 unread alerts. Highest severity: Critical',
      }),
    );

    mockAlertsError = true;
    rerender(
      <MemoryRouter>
        <AlertsSegment />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Priority alerts' }),
    ).toHaveTextContent('Priority alert monitoring is unavailable');
    expect(
      within(screen.getByRole('dialog', { name: 'Priority alerts' })).getByRole('link', {
        name: /Critical.*Battery low/,
      }),
    ).toHaveAttribute(
      'href',
      '/battery?vehicle_id=7&t=2026-07-05T12%3A00%3A00.000Z&signal=BatteryLevel',
    );
    expect(
      screen.getByRole('button', {
        name: 'Priority alert monitoring is unavailable',
      }),
    ).toHaveAttribute('aria-expanded', 'true');

    mockAlertsError = false;
    rerender(
      <MemoryRouter>
        <AlertsSegment />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Priority alerts' }),
    ).toHaveTextContent('Battery low');
  });

  it('announces a newly arriving critical alert without announcing on mount', () => {
    mockAlerts = [alert({ id: 1, severity: 'warning' })];
    const { rerender } = render(
      <StatusBarProvider announcementLabel="Status announcements">
        <MemoryRouter>
          <AlertsSegment />
        </MemoryRouter>
      </StatusBarProvider>,
    );
    expect(
      screen.getByRole('status', { name: 'Status announcements' }),
    ).toHaveTextContent('');

    mockAlerts = [
      ...mockAlerts,
      alert({ id: 2, severity: 'critical', title: 'Thermal warning' }),
    ];
    rerender(
      <StatusBarProvider announcementLabel="Status announcements">
        <MemoryRouter>
          <AlertsSegment />
        </MemoryRouter>
      </StatusBarProvider>,
    );

    expect(
      screen.getByRole('status', { name: 'Status announcements' }),
    ).toHaveTextContent('Critical alert: Thermal warning');
  });

  it('treats the first asynchronously resolved critical snapshot as baseline', () => {
    mockAlertsSuccess = false;
    const { rerender } = render(
      <StatusBarProvider announcementLabel="Status announcements">
        <MemoryRouter>
          <AlertsSegment />
        </MemoryRouter>
      </StatusBarProvider>,
    );

    mockAlerts = [
      alert({ id: 8, severity: 'critical', title: 'Existing critical alert' }),
    ];
    mockAlertsSuccess = true;
    rerender(
      <StatusBarProvider announcementLabel="Status announcements">
        <MemoryRouter>
          <AlertsSegment />
        </MemoryRouter>
      </StatusBarProvider>,
    );

    expect(
      screen.getByRole('status', { name: 'Status announcements' }),
    ).toHaveTextContent('');
  });

  it('preserves native trigger and icon-only semantics with warning tokens', () => {
    mockAlerts = [alert()];
    renderSegment(true);
    const trigger = screen.getByRole('button', {
      name: 'Open 1 unread alerts. Highest severity: Warning',
    });
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.className).toContain(severityTokens.warn.fg);
    expect(within(trigger).queryByText('Alerts')).not.toBeInTheDocument();
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps long alert content reachable and closes on drill-through', async () => {
    const title = 'Long alert title '.repeat(20);
    const message = 'Detailed alert context '.repeat(30);
    mockAlerts = [alert({ title, message })];
    renderSegment();
    fireEvent.click(screen.getByRole('button', {
      name: 'Open 1 unread alerts. Highest severity: Warning',
    }));
    const dialog = screen.getByRole('dialog', { name: 'Priority alerts' });
    const link = within(dialog).getAllByRole('link')[0];
    expect(link).toHaveTextContent(title.trim());
    expect(link).toHaveTextContent(message.trim());
    expect(within(link).getByText(title.trim()).className).not.toContain('truncate');
    expect(within(link).getByText(message.trim()).className).not.toContain('line-clamp');
    await act(async () => {
      fireEvent.click(link);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not fabricate an unread count before the initial source resolves', () => {
    mockAlertsSuccess = false;
    const { container } = renderSegment();
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the exact named preview geometry without changing scroll ownership', () => {
    mockAlerts = [alert()];
    renderSegment();
    fireEvent.click(screen.getByRole('button', {
      name: 'Open 1 unread alerts. Highest severity: Warning',
    }));

    const dialog = screen.getByRole('dialog', { name: 'Priority alerts' });
    expect(dialog).toHaveClass('w-alerts-preview', 'p-2');
    expect(within(dialog).getByRole('list')).toHaveClass(
      'max-h-alerts-preview',
      'overflow-y-auto',
      'space-y-0.5',
      'py-1',
    );
    expect(within(dialog).getAllByRole('link')).toHaveLength(2);
    expect(within(dialog).getAllByRole('link').slice(-1)[0]).toHaveAttribute(
      'href',
      '/notifications/inbox?read=unread',
    );
  });
});
