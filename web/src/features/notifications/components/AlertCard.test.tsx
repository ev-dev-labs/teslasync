/**
 * AlertCard tests.
 *
 * AlertCard is presentation-only: it renders a single alert row and delegates
 * mark-read / acknowledge / reopen / open-detail to callbacks the hosting page
 * supplies. These tests pin the behaviour that matters:
 *
 *   1. Content — title, message, severity, and humanised type render.
 *   2. Relative time — the minute/hour/day branches of getTimeAgo, plus the
 *      hardened guards that stop malformed / epoch / future timestamps from
 *      rendering "NaNm ago", "20000d ago", or negative minutes.
 *   3. Read/unread — the unread status dot + "Mark read" affordance appear only
 *      while unread and wire up onMarkRead.
 *   4. Acknowledgement — the acked badge (named + anonymous) and the
 *      Acknowledge ⇄ Reopen button swap, each firing the right callback.
 *   5. Drill-through — both "View context" links target the mapped context page
 *      for a known signal and fall back to the Signal Explorer otherwise.
 *   6. Null-safety + a11y — a missing title degrades to an em-dash and the
 *      icon-only status dot exposes an accessible label.
 *
 * `t` is threaded in as a real i18next function (via a tiny harness) so the
 * count-interpolated relative-time strings resolve exactly as they do in the
 * app. No network is touched — the component has no data dependencies.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';

import DefaultAlertCard, { AlertCard, type AlertCardProps } from './AlertCard';
import type { Alert } from '@/api/types';

const minutesAgoIso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    vehicle_id: 1,
    type: 'low_battery',
    severity: 'warning',
    title: 'Battery low',
    message: 'Battery dropped below 20%',
    is_read: false,
    created_at: minutesAgoIso(5),
    rule_signal: 'BatteryLevel',
    ...overrides,
  };
}

type Handlers = Partial<
  Pick<
    AlertCardProps,
    | 'onMarkRead'
    | 'onAcknowledge'
    | 'onOpenDetail'
    | 'onReopen'
    | 'selected'
    | 'onToggleSelect'
  >
>;

function renderCard(alert: Alert, handlers: Handlers = {}) {
  const onMarkRead = handlers.onMarkRead ?? vi.fn();
  const onAcknowledge = handlers.onAcknowledge ?? vi.fn();
  const onOpenDetail = handlers.onOpenDetail ?? vi.fn();
  const onReopen = handlers.onReopen ?? vi.fn();

  function Harness() {
    const { t } = useTranslation();
    return (
      <AlertCard
        alert={alert}
        t={t}
        onMarkRead={onMarkRead}
        onAcknowledge={onAcknowledge}
        onOpenDetail={onOpenDetail}
        onReopen={onReopen}
        selected={handlers.selected}
        onToggleSelect={handlers.onToggleSelect}
      />
    );
  }

  const utils = render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return { ...utils, onMarkRead, onAcknowledge, onOpenDetail, onReopen };
}

describe('AlertCard', () => {
  it('renders the title, message, severity, and humanised type', () => {
    renderCard(makeAlert());
    expect(screen.getByText('Battery low')).toBeInTheDocument();
    expect(screen.getByText('Battery dropped below 20%')).toBeInTheDocument();
    // severity is surfaced verbatim inside the SeverityBadge
    expect(screen.getByText('warning')).toBeInTheDocument();
    // the underscored wire type is displayed with spaces
    expect(screen.getByText('low battery')).toBeInTheDocument();
  });

  it.each([
    [minutesAgoIso(5), '5m ago'],
    [hoursAgoIso(3), '3h ago'],
    [daysAgoIso(2), '2d ago'],
  ])('renders relative time for %s as "%s"', (created_at, expected) => {
    renderCard(makeAlert({ created_at }));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each([
    ['malformed string', 'not-a-real-date'],
    ['empty string', ''],
    ['future timestamp (clock skew)', new Date(Date.now() + 5 * 60_000).toISOString()],
  ])('renders an em-dash instead of a broken relative time for a %s', (_label, created_at) => {
    renderCard(makeAlert({ created_at }));
    // The bug this guards: NaN/epoch/negative cascades previously produced
    // "NaNm ago" / "20000d ago" / "-3m ago".
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-\d/)).not.toBeInTheDocument();
  });

  it('shows an accessible unread dot and a working "Mark read" action while unread', () => {
    const { onMarkRead } = renderCard(makeAlert({ is_read: false }));
    // icon-only status indicator exposes a label to assistive tech
    expect(screen.getByRole('img', { name: /unread/i })).toBeInTheDocument();
    const markRead = screen.getByRole('button', { name: /mark read/i });
    fireEvent.click(markRead);
    expect(onMarkRead).toHaveBeenCalledTimes(1);
  });

  it('hides the unread dot and "Mark read" action once the alert is read', () => {
    renderCard(makeAlert({ is_read: true }));
    expect(screen.queryByRole('img', { name: /unread/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument();
  });

  it('offers Acknowledge (not Reopen) for an un-acked alert and fires onAcknowledge', () => {
    const { onAcknowledge } = renderCard(makeAlert({ acknowledged_at: null }));
    expect(screen.queryByText(/acknowledged by/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reopened/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^acknowledge$/i }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('shows the actor badge + Reopen (not Acknowledge) for an acked alert and fires onReopen', () => {
    const { onReopen } = renderCard(
      makeAlert({ acknowledged_at: minutesAgoIso(2), acknowledged_by: 'atul' }),
    );
    expect(screen.getByText('Acknowledged by atul')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^acknowledge$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reopened/i }));
    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it('renders an anonymous acknowledgement badge when no actor is recorded', () => {
    renderCard(makeAlert({ acknowledged_at: minutesAgoIso(2), acknowledged_by: null }));
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(screen.queryByText(/acknowledged by/i)).not.toBeInTheDocument();
  });

  it('opens the alert evidence drawer via onOpenDetail', () => {
    const { onOpenDetail } = renderCard(makeAlert());
    fireEvent.click(screen.getByRole('button', { name: /inspect alert/i }));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible controlled selection checkbox for bulk workflows', () => {
    const onToggleSelect = vi.fn();
    renderCard(makeAlert(), { selected: true, onToggleSelect });

    const checkbox = screen.getByRole('checkbox', { name: 'Select Battery low' });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith(false);
  });

  it('links both "View context" affordances to the mapped page for a known signal', () => {
    renderCard(makeAlert({ rule_signal: 'BatteryLevel', vehicle_id: 7 }));
    const links = screen.getAllByRole('link', { name: /view context/i });
    expect(links).toHaveLength(2);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).toContain('/battery');
      expect(href).toContain('signal=BatteryLevel');
      expect(href).toContain('vehicle_id=7');
    }
  });

  it('falls back to the Signal Explorer for an unmapped signal and omits an un-scoped vehicle', () => {
    renderCard(makeAlert({ rule_signal: null, type: 'system_mqtt', vehicle_id: 0 }));
    const href = screen.getAllByRole('link', { name: /view context/i })[0].getAttribute('href') ?? '';
    expect(href).toContain('/signal-explorer');
    expect(href).not.toContain('vehicle_id');
  });

  it('degrades a missing title to an em-dash without dropping the message', () => {
    renderCard(makeAlert({ title: undefined, message: 'Body still shows' }));
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Body still shows')).toBeInTheDocument();
  });

  it('exposes the same component as its default and named export', () => {
    expect(DefaultAlertCard).toBe(AlertCard);
  });
});
