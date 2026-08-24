/**
 * ConnectionSegment behaviour tests.
 *
 * Drives every branch of the footer API-health segment by stubbing the polled
 * `useApiHealth` hook (network is never touched):
 *   - ok       → emerald accent, latency chip, "Online" aria-label + tooltip
 *   - degraded → amber accent, latency still shown, "Degraded"
 *   - offline  → rose accent, latency suppressed, "Offline" spelled out
 *   - unknown  → muted accent, no suffix, "Connecting…"
 *   - iconOnly → label + latency hidden, aria-label + decorative dot preserved
 *   - defensive fallback for an out-of-contract status (must not crash)
 *   - ok reading with no measured latency omits the latency chip
 *
 * The segment always links to /system-status and exposes an accessible
 * name + role="tooltip" description regardless of state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiHealthState, ApiHealthStatus } from '@/api/hooks/useApiHealth';
import '../../../i18n';

// Controllable stand-in for the /healthz poll so we can exercise each status
// branch synchronously without any real fetch.
let healthMock: ApiHealthState;
let rbacMock: {
  data?: {
    mode: 'session';
    my_roles: string[];
    effective_for_me: Record<string, boolean>;
  };
};
let diagnosticsMock: {
  data?: {
    status: string;
    components: Record<string, Record<string, unknown>>;
  };
  isError: boolean;
};

vi.mock('@/api/hooks/useApiHealth', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useApiHealth')>(
    '@/api/hooks/useApiHealth',
  );
  return { ...actual, useApiHealth: () => healthMock };
});

vi.mock('@/api/hooks/useRbacMatrix', () => ({
  useRbacMatrix: () => rbacMock,
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useExtendedSystemHealth: () => diagnosticsMock,
}));

// Imported AFTER the mock so the component binds the stubbed hook.
import { ConnectionSegment } from './ConnectionSegment';

const AT = '2026-07-05T00:00:00.000Z';

function renderSegment(
  state: ApiHealthState,
  props: { iconOnly?: boolean; enableAdminDiagnostics?: boolean } = {},
) {
  healthMock = state;
  return render(
    <MemoryRouter>
      <ConnectionSegment {...props} />
    </MemoryRouter>,
  );
}

/** The decorative status dot is the only `rounded-full` span inside the link. */
function getDot(link: HTMLElement): HTMLElement {
  const dot = link.querySelector<HTMLElement>('span.rounded-full');
  if (!dot) throw new Error('status dot not found');
  return dot;
}

describe('ConnectionSegment', () => {
  beforeEach(() => {
    cleanup();
    rbacMock = { data: undefined };
    diagnosticsMock = { data: undefined, isError: false };
  });

  it('renders the online state with latency, emerald accent, and a link to system status', () => {
    renderSegment({ status: 'ok', latencyMs: 42, lastCheckedAt: AT });
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('href', '/system-status');
    expect(link).toHaveAttribute('aria-label', 'API connection status: Online (42ms)');
    expect(link.className).toContain('text-emerald-300');
    expect(getDot(link).className).toContain('bg-emerald-400');
    expect(getDot(link)).toHaveAttribute('aria-hidden');
    // Visible pill shows the short label and the measured latency.
    expect(link).toHaveTextContent('API');
    expect(link).toHaveTextContent('42ms');
  });

  it('exposes an accessible role="tooltip" describing the connection and latency', () => {
    renderSegment({ status: 'ok', latencyMs: 42, lastCheckedAt: AT });
    const tip = screen.getByRole('tooltip');

    expect(tip).toHaveTextContent('API connection');
    expect(tip).toHaveTextContent('Online');
    expect(tip).toHaveTextContent('42ms');
  });

  it('renders the degraded state with amber accent and still surfaces latency', () => {
    renderSegment({ status: 'degraded', latencyMs: 640, lastCheckedAt: AT });
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('aria-label', 'API connection status: Degraded (640ms)');
    expect(link.className).toContain('text-amber-300');
    expect(getDot(link).className).toContain('bg-amber-400');
    expect(link).toHaveTextContent('640ms');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Degraded');
  });

  it('renders the offline state without latency and spells out "Offline"', () => {
    renderSegment({ status: 'offline', latencyMs: 1200, lastCheckedAt: AT });
    const link = screen.getByRole('link');

    // Latency is deliberately hidden while offline (a stale reading is
    // meaningless) — the aria-label and pill drop it entirely.
    expect(link).toHaveAttribute('aria-label', 'API connection status: Offline');
    expect(link.className).toContain('text-rose-300');
    expect(getDot(link).className).toContain('bg-rose-400');
    expect(link).toHaveTextContent('Offline');
    expect(link).not.toHaveTextContent('1200ms');

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Offline');
    expect(tip).not.toHaveTextContent('1200ms');
  });

  it('renders the unknown/connecting state muted with no latency suffix', () => {
    renderSegment({ status: 'unknown', latencyMs: null, lastCheckedAt: null });
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('aria-label', 'API connection status: Connecting…');
    expect(link.className).toContain('var(--text-muted)');
    expect(getDot(link).className).toContain('var(--surface-2)');
    // No latency and not offline → the only visible text is the short label.
    expect(link.textContent).toBe('API');
  });

  it('hides the label and latency suffix in iconOnly mode but keeps the aria-label', () => {
    renderSegment({ status: 'ok', latencyMs: 42, lastCheckedAt: AT }, { iconOnly: true });
    const link = screen.getByRole('link');

    // Only the decorative dot + icon render — no visible text at all.
    expect(link.textContent).toBe('');
    expect(link).toHaveAttribute('aria-label', 'API connection status: Online (42ms)');
    // The dot is still present but hidden from assistive tech.
    expect(getDot(link)).toHaveAttribute('aria-hidden');
  });

  it('falls back to the neutral unknown variant for an out-of-contract status', () => {
    // A bad cast or a future union member must degrade gracefully rather than
    // throw on `cfg[status].icon`.
    renderSegment({
      status: 'bogus' as ApiHealthStatus,
      latencyMs: null,
      lastCheckedAt: null,
    });
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('aria-label', 'API connection status: Connecting…');
    expect(link.className).toContain('var(--text-muted)');
    expect(link.textContent).toBe('API');
  });

  it('omits the latency chip when an ok reading has no measured latency', () => {
    renderSegment({ status: 'ok', latencyMs: null, lastCheckedAt: AT });
    const link = screen.getByRole('link');

    // aria-label carries no "(…ms)" suffix when latency is unavailable.
    expect(link).toHaveAttribute('aria-label', 'API connection status: Online');
    expect(link.className).toContain('text-emerald-300');
    expect(link.textContent).toBe('API');
  });

  it('keeps direct system-status navigation for non-admin users', () => {
    rbacMock = {
      data: {
        mode: 'session',
        my_roles: ['user'],
        effective_for_me: { 'fleet.read': true },
      },
    };
    renderSegment(
      { status: 'ok', latencyMs: 42, lastCheckedAt: AT },
      { enableAdminDiagnostics: true },
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/system-status');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens existing health diagnostics only for admins', () => {
    rbacMock = {
      data: {
        mode: 'session',
        my_roles: ['admin'],
        effective_for_me: { 'admin.audit': true },
      },
    };
    diagnosticsMock = {
      data: {
        status: 'healthy',
        components: {
          database: { status: 'healthy', latency_ms: 8 },
          database_pool: { acquired_conns: 4 },
          telemetry_buffers: { drive_buffered: 2, charge_buffered: 3 },
          fleet_telemetry: { status: 'healthy' },
        },
      },
      isError: false,
    };
    renderSegment(
      { status: 'ok', latencyMs: 42, lastCheckedAt: AT },
      { enableAdminDiagnostics: true },
    );

    const trigger = screen.getByRole('button', {
      name: /open connection diagnostics/i,
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', {
      name: 'Connection diagnostics',
    });
    expect(dialog).toHaveTextContent('Database latency');
    expect(dialog).toHaveTextContent('8ms');
    expect(dialog).toHaveTextContent('Active DB connections');
    expect(dialog).toHaveTextContent('4');
    expect(dialog).toHaveTextContent('Buffered events');
    expect(dialog).toHaveTextContent('5');
    expect(within(dialog).getByRole('link')).toHaveAttribute(
      'href',
      '/system-status',
    );
  });
});
