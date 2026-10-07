/**
 * AuditLogWidget — behaviour + hardening coverage.
 *
 * The widget merges two data sources (system audit logs + per-vehicle security
 * events) into one severity-ranked feed, with a compact 24h summary variant.
 * This suite exercises every branch through the single public export (the
 * default component):
 *   - feed view: audit + security rows, severity → colour mapping
 *     (`inferAuditSeverity` / `inferSecuritySeverity`), and the security-title
 *     builder (`buildSecurityTitle`) for each state branch + the fallback.
 *   - compact view: worst-severity badge (Critical/Warning/Info), the 24h
 *     recency filter (old events must NOT colour the badge), and the empty
 *     state.
 *   - loading / empty / error states — including the honesty fix this suite
 *     locks in: a genuine initial-load failure now renders a real error panel
 *     instead of the misleading "No audit events" empty state.
 *   - refresh interaction (both sources refetched) + accessible control name.
 *   - vehicle-id resolution (prop wins, else first vehicle).
 *
 * Network is never touched: the three hooks the widget calls are mocked and
 * driven per-test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditLogEntry, SecurityEvent } from '@/types/admin';
import type { WidgetProps } from './types';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── The data hooks — driven per test ──
vi.mock('@/api/hooks/useAdmin', () => ({
  useAuditLogs: vi.fn(),
  useSecurityEvents: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));

import { useAuditLogs, useSecurityEvents } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';
import AuditLogWidget from './AuditLogWidget';

const mockUseAuditLogs = useAuditLogs as unknown as ReturnType<typeof vi.fn>;
const mockUseSecurityEvents = useSecurityEvents as unknown as ReturnType<typeof vi.fn>;
const mockUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function recentIso(minsAgo = 5): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
}

function auditEntry(over: Partial<AuditLogEntry> & { id: string }): AuditLogEntry {
  return { action: '', resource: '', details: '', createdAt: recentIso(), ...over };
}

function secEvent(over: Partial<SecurityEvent> & { id: string }): SecurityEvent {
  return {
    locked: null,
    sentryMode: null,
    doorState: null,
    fdWindow: null,
    fpWindow: null,
    rdWindow: null,
    rpWindow: null,
    homelinkNearby: null,
    guestMode: null,
    homelinkDeviceCount: null,
    guestModeMobileAccessState: null,
    driverSeatOccupied: null,
    centerDisplay: null,
    speedLimitMode: null,
    valetModeEnabled: null,
    serviceMode: null,
    pairedPhoneKeyCount: null,
    lightsHazardsActive: null,
    lightsHighBeams: null,
    lightsTurnSignal: null,
    driverSeatBelt: null,
    passengerSeatBelt: null,
    createdAt: recentIso(),
    ...over,
  };
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuditLogWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Inline colour style of the timeline dot for a given row title — proves the
// severity → SEVERITY_COLOR mapping without depending on icon internals.
function rowStyle(title: string): string {
  const row = screen.getByText(title).closest('.flex.gap-3');
  return row?.querySelector('[style]')?.getAttribute('style') ?? '';
}

beforeEach(() => {
  mockUseAuditLogs.mockReset();
  mockUseSecurityEvents.mockReset();
  mockUseVehicles.mockReset();
  mockUseAuditLogs.mockReturnValue(makeQuery({ data: [] }));
  mockUseSecurityEvents.mockReturnValue(makeQuery({ data: [] }));
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] });
});

describe('AuditLogWidget — feed view (wide)', () => {
  it('maps each audit action to the right severity colour and joins resource · details', () => {
    mockUseAuditLogs.mockReturnValue(
      makeQuery({
        data: [
          auditEntry({ id: 'a1', action: 'vehicle.delete', resource: 'vehicle', details: 'vin 5YJ' }),
          auditEntry({ id: 'a2', action: 'settings.update', resource: 'settings' }),
          auditEntry({ id: 'a3', action: 'user.login' }),
        ],
      }),
    );
    renderWidget({ size: { cols: 3, rows: 2 } });

    // Titles = action strings.
    expect(screen.getByText('vehicle.delete')).toBeInTheDocument();
    expect(screen.getByText('settings.update')).toBeInTheDocument();
    expect(screen.getByText('user.login')).toBeInTheDocument();

    // Subtitle joins truthy resource + details with " · "; empties collapse to "—".
    expect(screen.getByText('vehicle · vin 5YJ')).toBeInTheDocument();

    // Severity → colour: delete=critical, update=warning, login=info.
    expect(rowStyle('vehicle.delete')).toContain('rgb(239, 68, 68)');
    expect(rowStyle('settings.update')).toContain('rgb(245, 158, 11)');
    expect(rowStyle('user.login')).toContain('rgb(59, 130, 246)');
  });

  it('renders a distinct security title for each state branch with matching severity colour', () => {
    mockUseSecurityEvents.mockReturnValue(
      makeQuery({
        data: [
          secEvent({ id: 's-lock', locked: true }),
          secEvent({ id: 's-unlock', locked: false }),
          secEvent({ id: 's-sentry', sentryMode: 'active' }),
          secEvent({ id: 's-door', doorState: 'open' }),
          secEvent({ id: 's-guest', guestMode: true }),
          secEvent({ id: 's-valet', valetModeEnabled: true }),
        ],
      }),
    );
    renderWidget({ size: { cols: 3, rows: 3 } });

    expect(screen.getByText('Vehicle locked')).toBeInTheDocument();
    expect(screen.getByText('Vehicle unlocked')).toBeInTheDocument();
    expect(screen.getByText('Sentry: active')).toBeInTheDocument();
    expect(screen.getByText('Door: open')).toBeInTheDocument();
    expect(screen.getByText('Guest mode on')).toBeInTheDocument();
    expect(screen.getByText('Valet mode on')).toBeInTheDocument();

    // inferSecuritySeverity: unlocked=critical, sentry active=warning, locked=info.
    expect(rowStyle('Vehicle unlocked')).toContain('rgb(239, 68, 68)');
    expect(rowStyle('Sentry: active')).toContain('rgb(245, 158, 11)');
    expect(rowStyle('Vehicle locked')).toContain('rgb(59, 130, 246)');
  });

  it('falls back to the generic "Security event" title when no state field is set', () => {
    mockUseSecurityEvents.mockReturnValue(
      makeQuery({ data: [secEvent({ id: 's-empty' })] }),
    );
    renderWidget({ size: { cols: 3, rows: 2 } });

    // Fallback title + the always-present subtitle both read "Security event".
    expect(screen.getAllByText('Security event')).toHaveLength(2);
  });

  it('shows the empty state (not a blank panel) when both sources are empty', () => {
    renderWidget({ size: { cols: 3, rows: 2 } });
    expect(screen.getByText('No audit events')).toBeInTheDocument();
    // Refresh affordance is still present and accessible in the empty state.
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });
});

describe('AuditLogWidget — compact view (1 col)', () => {
  it('summarises recent events with a Critical badge when a critical event is in the last 24h', () => {
    mockUseAuditLogs.mockReturnValue(
      makeQuery({
        data: [
          auditEntry({ id: 'a1', action: 'token.revoke' }),
          auditEntry({ id: 'a2', action: 'user.login' }),
        ],
      }),
    );
    renderWidget({ size: { cols: 1, rows: 2 } });

    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Events (24h)')).toBeInTheDocument();
    // Not the feed layout: individual row titles are absent in compact mode.
    expect(screen.queryByText('token.revoke')).not.toBeInTheDocument();
  });

  it('shows a Warning badge when the worst recent severity is a warning', () => {
    mockUseAuditLogs.mockReturnValue(
      makeQuery({ data: [auditEntry({ id: 'a1', action: 'config.change' })] }),
    );
    renderWidget({ size: { cols: 1, rows: 2 } });
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
  });

  it('excludes events older than 24h from the badge severity (Info, not Critical)', () => {
    mockUseAuditLogs.mockReturnValue(
      makeQuery({
        // Critical action, but timestamped days ago → must not colour the badge.
        data: [auditEntry({ id: 'a1', action: 'vehicle.delete', createdAt: daysAgoIso(3) })],
      }),
    );
    renderWidget({ size: { cols: 1, rows: 2 } });

    // Feed is non-empty (1 item) so the summary renders, but the recent count
    // is 0 → worst severity defaults to Info.
    expect(screen.getByText('Info')).toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
  });

  it('shows the compact empty state when there are no events at all', () => {
    renderWidget({ size: { cols: 1, rows: 2 } });
    expect(screen.getByText('No audit events')).toBeInTheDocument();
    expect(screen.queryByText('Events (24h)')).not.toBeInTheDocument();
  });
});

describe('AuditLogWidget — loading / error / refresh', () => {
  it('renders a skeleton (no content, no refresh) while either source is loading', () => {
    mockUseAuditLogs.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).not.toBeInTheDocument();
  });

  it('surfaces a genuine load error as an error panel instead of a misleading empty state', () => {
    mockUseAuditLogs.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget();

    // Honest error panel from WidgetShell (QueryError), not "No audit events".
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No audit events')).not.toBeInTheDocument();
  });

  it('refetches BOTH audit logs and security events when the refresh control is used', () => {
    const auditRefetch = vi.fn();
    const secRefetch = vi.fn();
    mockUseAuditLogs.mockReturnValue(
      makeQuery({ data: [auditEntry({ id: 'a1', action: 'user.login' })], refetch: auditRefetch }),
    );
    mockUseSecurityEvents.mockReturnValue(makeQuery({ data: [], refetch: secRefetch }));
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(auditRefetch).toHaveBeenCalledTimes(1);
    expect(secRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('AuditLogWidget — vehicle resolution', () => {
  it('queries security events for the vehicleId prop when provided', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockUseSecurityEvents).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockUseSecurityEvents).toHaveBeenCalledWith('42');
  });

  it('passes an empty id (disabling the query) when no vehicle is available', () => {
    mockUseVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockUseSecurityEvents).toHaveBeenCalledWith('');
  });
});
