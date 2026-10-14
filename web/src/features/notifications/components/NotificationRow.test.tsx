/**
 * NotificationRow tests.
 *
 * NotificationRow is presentation-only: it renders a single inbox row and
 * delegates every action (select, activate, mark read/unread, archive/restore,
 * drill-through) to callbacks the hosting inbox supplies. These tests pin the
 * behaviour that matters:
 *
 *   1. Content — severity, title, message, vehicle name, and rule name render.
 *   2. Selection — the checkbox reflects `selected`, and toggling it fires
 *      onSelectionChange with the row id + next checked state (NOT onActivate).
 *   3. Row activation — clicking / Enter / Space on the row BODY fires
 *      onActivate, while the same gesture on a control (checkbox, action button,
 *      drill link) is suppressed so it doesn't double-fire.
 *   4. Read/unread + archive/restore — the four quick-action buttons appear only
 *      in the matching state AND only when their handler is wired, each firing
 *      the right callback with the row id.
 *   5. Drill-through — the "View context" link targets the mapped context page
 *      for a known signal and disappears entirely when there is no rule.
 *   6. Null-safety + a11y — a blank title degrades to an em-dash, a missing
 *      vehicle/rule hides its chip, and the checkbox + icon-only buttons expose
 *      accessible names.
 *
 * The bundle still loads through the normal catalog checks. Local translation
 * and timezone fixtures make identity and translated-label assertions causal;
 * they do not establish browser or production-locale acceptance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';

import { NotificationRow, type NotificationRowProps } from './NotificationRow';
import type { NotificationLog, AlertRule, Vehicle } from '@/api/types';

const fixtures = vi.hoisted(() => ({
  userZone: 'UTC',
  selectedZone: 'Europe/Berlin',
  translations: {} as Record<string, string>,
  timezone: vi.fn(),
  translate: vi.fn(),
}));

vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: (mode: string) => {
    fixtures.timezone(mode);
    return mode === 'vehicle' ? fixtures.selectedZone : fixtures.userZone;
  },
}));

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      fixtures.translate(key);
      let result = fixtures.translations[key] ?? fallback;
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
  }),
}));

const CREATED_AT = new Date('2024-01-02T03:04:05Z').toISOString();

beforeEach(() => {
  fixtures.userZone = 'UTC';
  fixtures.selectedZone = 'Europe/Berlin';
  fixtures.translations = {};
  fixtures.timezone.mockClear();
  fixtures.translate.mockClear();
});

function makeLog(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: 42,
    channel_id: 1,
    alert_id: 10,
    title: 'Tire pressure low',
    message: 'Front-left tire below 30 PSI',
    status: 'sent',
    severity: 'warn',
    error: '',
    created_at: CREATED_AT,
    sent_at: CREATED_AT,
    read_at: null,
    archived_at: null,
    ...overrides,
  };
}

const RULE: AlertRule = {
  id: 10,
  name: 'Tire Pressure Low',
  enabled: true,
  severity: 'warn',
  vehicle_id: 1,
  signal_name: 'TpmsPressureFl',
  op: '<',
  value_num: 30,
} as unknown as AlertRule;

const VEHICLE: Vehicle = {
  id: 1,
  vehicle_id: 1,
  vin: 'VIN-A',
  display_name: 'Model 3',
} as unknown as Vehicle;

interface RenderOpts {
  log?: NotificationLog;
  rule?: AlertRule;
  vehicle?: Vehicle;
  selected?: boolean;
  onSelectionChange?: NotificationRowProps['onSelectionChange'];
  onActivate?: NotificationRowProps['onActivate'];
  onArchive?: NotificationRowProps['onArchive'];
  onUnarchive?: NotificationRowProps['onUnarchive'];
  onMarkRead?: NotificationRowProps['onMarkRead'];
  onMarkUnread?: NotificationRowProps['onMarkUnread'];
}

function renderRow(opts: RenderOpts = {}) {
  const log = opts.log ?? makeLog();
  // Distinguish "not passed" (default to fixture) from "explicitly undefined"
  // (exercise the no-rule / no-vehicle branch) via own-property presence.
  const rule = 'rule' in opts ? opts.rule : RULE;
  const vehicle = 'vehicle' in opts ? opts.vehicle : VEHICLE;
  const onSelectionChange = opts.onSelectionChange ?? vi.fn();

  const props: NotificationRowProps = {
    log,
    rule,
    vehicle,
    selected: opts.selected ?? false,
    onSelectionChange,
    onActivate: opts.onActivate,
    onArchive: opts.onArchive,
    onUnarchive: opts.onUnarchive,
    onMarkRead: opts.onMarkRead,
    onMarkUnread: opts.onMarkUnread,
  };

  const utils = render(
    <MemoryRouter>
      <NotificationRow {...props} />
    </MemoryRouter>,
  );
  return { ...utils, log, rule, vehicle, onSelectionChange };
}

describe('NotificationRow', () => {
  it('renders a Web-Push-only event without a channel delivery row', () => {
    renderRow({
      log: makeLog({
        channel_id: null,
        alert_id: null,
        status: 'triggered',
        event_type: 'system.web_push',
        title: 'Push received',
      }),
      rule: undefined,
      vehicle: undefined,
    });
    expect(screen.getByText('Push received')).toBeInTheDocument();
    expect(screen.getByText(/system\.web_push/)).toBeInTheDocument();
  });

  it('renders severity, title, message, vehicle name, and rule name', () => {
    renderRow();
    expect(screen.getByText('Warn')).toBeInTheDocument();
    expect(screen.getByText('Tire pressure low')).toBeInTheDocument();
    expect(screen.getByText('Front-left tire below 30 PSI')).toBeInTheDocument();
    // vehicle name + rule name render as "· <name>" chips
    expect(screen.getByText(/Model 3/)).toBeInTheDocument();
    expect(screen.getByText(/Tire Pressure Low/)).toBeInTheDocument();
  });

  it('reflects the selected prop on both the row and the checkbox', () => {
    const { rerender } = render(
      <MemoryRouter>
        <NotificationRow
          log={makeLog()}
          rule={RULE}
          vehicle={VEHICLE}
          selected={false}
          onSelectionChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    const checkbox = screen.getByRole('checkbox', { name: /select notification/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('group', { name: 'Tire pressure low' })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <NotificationRow
          log={makeLog()}
          rule={RULE}
          vehicle={VEHICLE}
          selected={true}
          onSelectionChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('checkbox', { name: /select notification/i })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Tire pressure low' })).toBeInTheDocument();
  });

  it('toggling the checkbox fires onSelectionChange with (id, checked) but not onActivate', () => {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();
    const { log } = renderRow({ onSelectionChange, onActivate });

    fireEvent.click(screen.getByRole('checkbox', { name: /select notification/i }));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith(log.id, true);
    // The checkbox is a control, so the row-body activate must NOT fire.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('clicking the row body fires onActivate with the log', () => {
    const onActivate = vi.fn();
    const { log } = renderRow({ onActivate });
    fireEvent.click(screen.getByText('Tire pressure low'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(log);
  });

  it('uses a native action button for keyboard access without nesting selection controls', () => {
    const onActivate = vi.fn();
    renderRow({ onActivate });
    const button = screen.getByRole('button', { name: 'Open notification: Tire pressure low' });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);

    // A key press that originates on the checkbox must be ignored by the row.
    fireEvent.keyDown(screen.getByRole('checkbox', { name: /select notification/i }), {
      key: 'Enter',
    });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('shows "Mark as read" only while unread and wired, firing onMarkRead(id)', () => {
    const onMarkRead = vi.fn();
    const { log } = renderRow({ log: makeLog({ read_at: null }), onMarkRead });
    expect(
      screen.queryByRole('button', { name: /mark as unread/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark as read/i }));
    expect(onMarkRead).toHaveBeenCalledWith(log.id);
  });

  it('shows "Mark as unread" only while read and wired, firing onMarkUnread(id)', () => {
    const onMarkUnread = vi.fn();
    const { log } = renderRow({
      log: makeLog({ read_at: CREATED_AT }),
      onMarkUnread,
    });
    expect(screen.queryByRole('button', { name: /mark as read/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark as unread/i }));
    expect(onMarkUnread).toHaveBeenCalledWith(log.id);
  });

  it('shows "Archive" only when not archived, firing onArchive(id)', () => {
    const onArchive = vi.fn();
    const { log } = renderRow({ log: makeLog({ archived_at: null }), onArchive });
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith(log.id);
  });

  it('shows "Restore" only when archived, firing onUnarchive(id)', () => {
    const onUnarchive = vi.fn();
    const { log } = renderRow({
      log: makeLog({ archived_at: CREATED_AT }),
      onUnarchive,
    });
    expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(onUnarchive).toHaveBeenCalledWith(log.id);
  });

  it('omits the quick-action buttons entirely when no handlers are supplied', () => {
    // Unread + not archived, but the inbox wired no per-row actions.
    renderRow({ log: makeLog({ read_at: null, archived_at: null }) });
    expect(screen.queryByRole('button', { name: /mark as read/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it('drills through to the mapped context page for a known rule signal', () => {
    renderRow();
    const link = screen.getByRole('link', { name: /view context/i });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/tire-pressure');
    expect(href).toContain('signal=TpmsPressureFl');
    expect(href).toContain('vehicle_id=1');
  });

  it('hides the drill-through link and rule chip when there is no rule', () => {
    renderRow({ rule: undefined });
    expect(screen.queryByRole('link', { name: /view context/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tire pressure Low/)).not.toBeInTheDocument();
    // The persisted severity remains visible even without a rule.
    expect(screen.getByText('Warn')).toBeInTheDocument();
  });

  it('hides the vehicle chip when the row has no vehicle', () => {
    renderRow({ vehicle: undefined });
    expect(screen.queryByText(/Model 3/)).not.toBeInTheDocument();
    // Title + message still render — the row never collapses.
    expect(screen.getByText('Tire pressure low')).toBeInTheDocument();
  });

  it('degrades a blank title to an em-dash without dropping the message', () => {
    renderRow({ log: makeLog({ title: '', message: 'Body still shows' }) });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Body still shows')).toBeInTheDocument();
  });

  it('keeps persisted critical severity authoritative when the current rule is info', () => {
    const log = makeLog({ severity: 'critical' });
    renderRow({ log, rule: { ...RULE, severity: 'info' } });
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.queryByText('Info')).not.toBeInTheDocument();
    expect(log.severity).toBe('critical');
    expect(screen.getByText('Critical').parentElement).toHaveClass('text-[var(--semantic-danger)]');
  });

  it.each([undefined, null, '', 'vendor.Raw/Severity', 'constructor'])(
    'renders persisted unknown severity %s neutrally without borrowing current rule severity',
    severity => {
      const log = { ...makeLog(), severity } as unknown as NotificationLog;
      renderRow({ log, rule: { ...RULE, severity: 'critical' } });
      const badge = screen.getByText(severity || '—');
      expect(badge).toHaveClass('text-[var(--text-secondary)]');
      expect(screen.queryByText('Critical')).not.toBeInTheDocument();
      expect(screen.queryByText('Info')).not.toBeInTheDocument();
      expect(log.severity).toBe(severity);
    },
  );

  it.each([
    ['info', 'info', 'Information'],
    ['warn', 'warn', 'Avertissement'],
    ['warning', 'warn', 'Avertissement'],
    ['critical', 'critical', 'Critique'],
  ])('translates persisted %s through the existing %s severity key', (severity, key, label) => {
    fixtures.translations[`notifications.inbox.filter.severity.${key}`] = label;
    renderRow({ log: makeLog({ severity }) });
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(fixtures.translate).toHaveBeenCalledWith(`notifications.inbox.filter.severity.${key}`);
    expect(screen.queryByText(severity)).not.toBeInTheDocument();
  });

  it('uses and discloses one user timezone instead of borrowing selected or row vehicle identity', () => {
    fixtures.userZone = 'America/New_York';
    const { container } = renderRow({
      vehicle: { ...VEHICLE, timezone: 'America/Los_Angeles' },
    });
    expect(fixtures.timezone).toHaveBeenCalledWith('user');
    expect(fixtures.timezone).not.toHaveBeenCalledWith('vehicle');
    expect(container.querySelector('[title="2024-01-02T03:04:05.000Z (America/New_York)"]'))
      .toHaveTextContent('EST');
  });

  it('keeps retained row timestamps stable across unrelated workspace selection changes', () => {
    fixtures.userZone = 'America/New_York';
    const { container, rerender } = renderRow();
    const before = container.querySelector('[title$="(America/New_York)"]')?.textContent;
    fixtures.selectedZone = 'Pacific/Auckland';
    rerender(
      <MemoryRouter>
        <NotificationRow log={makeLog()} rule={RULE} vehicle={VEHICLE} selected={false} onSelectionChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[title$="(America/New_York)"]')?.textContent).toBe(before);
    expect(fixtures.timezone).not.toHaveBeenCalledWith('vehicle');
  });

  it.each([undefined, '', 'UTC', 'Invalid/VehicleZone'])(
    'keeps the disclosed user zone when row timezone is %s',
    timezone => {
      fixtures.userZone = 'America/New_York';
      const { container } = renderRow({ vehicle: { ...VEHICLE, timezone } });
      expect(container.querySelector('[title$="(America/New_York)"]')).toBeInTheDocument();
      expect(fixtures.timezone).not.toHaveBeenCalledWith('vehicle');
    },
  );

  it.each([null, '', 'not-a-date'])('preserves invalid or absent timestamps %s without dropping row content', created_at => {
    renderRow({ log: { ...makeLog(), created_at } as unknown as NotificationLog, vehicle: undefined });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Tire pressure low')).toBeInTheDocument();
    expect(screen.getByText('Front-left tire below 30 PSI')).toBeInTheDocument();
  });

  it('keeps unread meaning explicit without relying on color and removes it when read', () => {
    const { rerender } = renderRow();
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tire pressure low' })).toHaveClass('border-l-2');
    rerender(
      <MemoryRouter>
        <NotificationRow log={makeLog({ read_at: CREATED_AT })} selected={false} onSelectionChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
    expect(screen.getByText('Tire pressure low')).toBeInTheDocument();
  });

  it('uses existing semantic chrome and keeps quick actions isolated from activation', () => {
    const onActivate = vi.fn();
    const onArchive = vi.fn();
    const onMarkRead = vi.fn();
    renderRow({ onActivate, onArchive, onMarkRead });
    expect(screen.getByRole('group', { name: 'Tire pressure low' })).toHaveClass('border-[var(--border-default)]');
    const link = screen.getByRole('link', { name: /view context/i });
    expect(link).toHaveClass('focus-visible:outline-[var(--focus-ring)]');
    expect(link).toHaveClass('hover:bg-[var(--control-bg-hover)]');
    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark as read/i }));
    expect(onArchive).toHaveBeenCalledWith(42);
    expect(onMarkRead).toHaveBeenCalledWith(42);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
