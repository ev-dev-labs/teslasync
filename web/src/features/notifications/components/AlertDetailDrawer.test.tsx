import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';
import type { Alert, AlertDetail } from '@/api/types';
import {
  AlertDetailDrawer,
  getAlertRemediationKind,
} from './AlertDetailDrawer';

const CREATED_AT = '2026-05-02T10:00:00Z';

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
  detail?: AlertDetail;
  isLoading?: boolean;
  error?: unknown;
} = {}) {
  const baseAlert = overrides.alert ?? alert();
  const detail = overrides.detail ?? {
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

describe('AlertDetailDrawer', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
