import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';
import type { Alert, AlertDetail } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';
import { useSettings } from '@/hooks/useSettings';
import { useTimezone } from '@/lib/timezone';
import {
  AlertDetailDrawer,
  getAlertRemediationKind,
} from './AlertDetailDrawer';

const CREATED_AT = '2026-05-02T10:00:00Z';

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return { ...actual, useSettings: vi.fn() };
});
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return { ...actual, useTimezone: vi.fn() };
});
beforeEach(() => {
  vi.mocked(useSettings).mockReturnValue({
    settings: { tz_display_default: 'user' },
    locale: 'en-US',
  } as ReturnType<typeof useSettings>);
  vi.mocked(useTimezone).mockReturnValue('UTC');
});

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 41,
    vehicle_id: 7,
    type: 'battery_low',
    severity: 'critical',
    title: 'Battery critically low',
    message: 'Pack is below the configured threshold',
    is_read: false,
    created_at: CREATED_AT,
    rule_signal: 'BatteryLevel',
    ...overrides,
  };
}

function renderDrawer(overrides: {
  alert?: Alert;
  detail?: AlertDetail | null;
  isLoading?: boolean;
  error?: unknown;
} = {}) {
  const baseAlert = overrides.alert ?? alert();
  const detail = overrides.detail === null ? undefined : overrides.detail ?? {
    ...baseAlert,
    acknowledged_at: '2026-05-02T10:15:00Z',
    acknowledged_by: 'fleet.operator',
    acknowledgement_note: 'Charging scheduled',
    events: [
      { id: 0, kind: 'created', occurred_at: CREATED_AT },
      {
        id: 1,
        kind: 'acknowledged',
        occurred_at: '2026-05-02T10:15:00Z',
        actor: 'fleet.operator',
        note: 'Charging scheduled',
      },
    ],
  };
  const onClose = vi.fn();
  const onAcknowledge = vi.fn();
  const onReopen = vi.fn();
  const onRetry = vi.fn();

  render(
    <MemoryRouter>
      <AlertDetailDrawer
        alert={baseAlert}
        detail={detail}
        isLoading={overrides.isLoading ?? false}
        error={overrides.error ?? null}
        vehicleName="Model Y"
        onClose={onClose}
        onAcknowledge={onAcknowledge}
        onReopen={onReopen}
        onRetry={onRetry}
      />
    </MemoryRouter>,
  );
  return { onClose, onAcknowledge, onReopen, onRetry };
}

describe('getAlertRemediationKind', () => {
  it.each([
    ['BatteryLevel', 'custom', 'battery'],
    ['TpmsPressureFl', 'custom', 'tire'],
    ['ChargeState', 'custom', 'charging'],
    ['Locked', 'custom', 'security'],
    [null, 'system_mqtt', 'system'],
    [null, 'unknown_alert', 'general'],
  ])('classifies signal %s and type %s as %s', (rule_signal, type, expected) => {
    expect(getAlertRemediationKind(alert({ rule_signal, type }))).toBe(expected);
  });
});

function fieldRow(label: string): HTMLElement {
  const term = screen.getByText(label).closest('dt');
  if (!term?.parentElement) throw new Error('Field row was not rendered');
  return term.parentElement;
}

describe('AlertDetailDrawer', () => {
  it.each([
    [false, null],
    [true, null],
    [false, new Error('Initial detail failure')],
  ])('keeps unresolved lifecycle and owner unknown without writes (loading=%s)', (isLoading, error) => {
    const { onAcknowledge, onReopen, onRetry } = renderDrawer({ detail: null, isLoading, error });
    expect(fieldRow('Resolution state')).toHaveTextContent('Unknown');
    expect(fieldRow('Owner')).toHaveTextContent('Unknown');
    expect(screen.queryByText('Awaiting acknowledgement')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge alert' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen alert' })).not.toBeInTheDocument();
    expect(screen.getByText('Recommended response')).toBeInTheDocument();
    expect(screen.getByText('Audit timeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Investigate signal' })).toBeEnabled();
    if (!isLoading) {
      fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
      expect(onRetry).toHaveBeenCalledOnce();
    }
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(onReopen).not.toHaveBeenCalled();
  });

  it('ignores another alert detail instead of leaking its lifecycle or audit history', () => {
    renderDrawer({ detail: { ...alert({ id: 99, title: 'Other alert', acknowledged_at: CREATED_AT, acknowledged_by: 'other.owner' }), events: [] } });
    expect(screen.getByRole('dialog', { name: 'Battery critically low' })).toBeInTheDocument();
    expect(screen.queryByText('other.owner')).not.toBeInTheDocument();
    expect(fieldRow('Resolution state')).toHaveTextContent('Unknown');
    expect(screen.queryByRole('button', { name: 'Reopen alert' })).not.toBeInTheDocument();
  });

  it('does not invent Open when a detail omits acknowledgement evidence', () => {
    renderDrawer({ detail: { ...alert(), events: [] } });
    expect(fieldRow('Resolution state')).toHaveTextContent('Unknown');
    expect(screen.queryByRole('button', { name: 'Acknowledge alert' })).not.toBeInTheDocument();
  });

  it('permits acknowledgement only for explicit server-confirmed open lifecycle', () => {
    const { onAcknowledge } = renderDrawer({ detail: { ...alert(), acknowledged_at: null, events: [] } });
    expect(fieldRow('Resolution state')).toHaveTextContent('Open');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge alert' }));
    expect(onAcknowledge).toHaveBeenCalledWith(41);
  });

  it('blocks lifecycle writes during a retained detail refresh', () => {
    renderDrawer({ isLoading: true });
    expect(screen.getByText('Acknowledged by fleet.operator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen alert' })).not.toBeInTheDocument();
  });

  it.each([
    ['utc', 'UTC', '2026-05-02'],
    ['user', 'America/Los_Angeles', '2026-05-01'],
    ['vehicle', 'Asia/Tokyo', '2026-05-02'],
  ] as const)('uses the saved %s display zone for trigger, audit, and related-context day', (mode, tz, day) => {
    vi.mocked(useSettings).mockReturnValue({
      settings: { tz_display_default: mode },
      locale: 'de-DE',
    } as ReturnType<typeof useSettings>);
    vi.mocked(useTimezone).mockImplementation((requestedMode) =>
      requestedMode === 'utc' ? 'UTC' :
      requestedMode === 'vehicle' ? 'Asia/Tokyo' : 'America/Los_Angeles',
    );
    const created_at = '2026-05-02T01:00:00Z';
    const sourceAlert = alert({ created_at });
    renderDrawer({ alert: sourceAlert });
    expect(fieldRow('Triggered')).toHaveTextContent(
      formatDateTime(created_at, { locale: 'de-DE', tz }),
    );
    expect(screen.getByRole('list', { name: 'Timeline' })).toHaveTextContent(
      formatDateTime(CREATED_AT, { locale: 'de-DE', tz }),
    );
    expect(vi.mocked(useTimezone)).toHaveBeenCalledWith(mode);
    for (const [name, path] of [
      ['Drive history', '/drives'],
      ['Charging sessions', '/charging'],
      ['Visited locations', '/locations'],
      ['Telemetry evidence', '/signals'],
    ]) {
      const suffix = path === '/signals' ? '&signals=BatteryLevel' : '';
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', `${path}?from=${day}&to=${day}${suffix}`);
    }
    expect(sourceAlert.created_at).toBe(created_at);
  });

  it('shows lifecycle, owner, signal evidence, response guidance, note, and audit history', () => {
    const { onClose, onReopen } = renderDrawer();

    expect(screen.getByRole('dialog', { name: 'Battery critically low' })).toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
    expect(screen.getAllByText('fleet.operator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Charging scheduled')).toHaveLength(2);
    expect(
      screen.getByText(/Confirm the current state of charge and charging access/),
    ).toBeInTheDocument();
    expect(screen.getByText('Acknowledged by fleet.operator')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vehicle' }))
      .toHaveAttribute('href', '/vehicles/7');
    expect(screen.getByRole('link', { name: 'Drive history' }))
      .toHaveAttribute('href', '/drives?from=2026-05-02&to=2026-05-02');
    expect(screen.getByRole('link', { name: 'Charging sessions' }))
      .toHaveAttribute('href', '/charging?from=2026-05-02&to=2026-05-02');
    expect(screen.getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute(
        'href',
        '/signals?from=2026-05-02&to=2026-05-02&signals=BatteryLevel',
      );

    fireEvent.click(screen.getByRole('button', { name: 'Reopen alert' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReopen).toHaveBeenCalledWith(41);
  });

  it('keeps cached audit evidence visible when a background refresh fails', () => {
    const { onRetry } = renderDrawer({ error: new Error('refresh failed') });

    expect(screen.getByText('Acknowledged by fleet.operator')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The latest refresh failed. Showing the most recent cached audit trail.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen alert' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
