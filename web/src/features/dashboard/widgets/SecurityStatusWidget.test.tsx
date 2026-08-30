/**
 * SecurityStatusWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's security tile. It reads the latest security
 * snapshot (`useSecurityLatest`) and folds it into a 2×2 status grid — Lock,
 * Sentry, Doors, Windows — each carrying a tri-state (ok / warning|error /
 * inactive / unknown) plus a human-readable value. Its surface under test:
 *
 *   1. The four cells in their nominal states: secured (locked + sentry +
 *      all-closed) → every cell "ok"; unsecured (unlocked → red `error`,
 *      sentry off → `inactive`).
 *   2. The null tri-state hardening (regression guards): `locked` and
 *      `sentry_mode` are `boolean | null`. A `null` reading used to be coerced
 *      to a definite state — `locked: null` in particular rendered as a
 *      FALSE-ALARM red "Unlocked". It now renders `unknown` + an em-dash.
 *   3. The door/window "known" hardening: door/window fields are optional. When
 *      they are entirely absent the widget used to claim a green "All Closed"
 *      (a false safety signal); it now renders `unknown` + em-dash.
 *   4. Open counting: a comma-separated `door_state` with "open" tokens and
 *      per-window enums produce "N Open" + a warning (amber) status; a native
 *      boolean `door_state: true` counts as one open door.
 *   5. Loading / error / empty branches (never a blank panel), including the
 *      hardening that (a) surfaces the shared error panel only when a failure
 *      leaves NO data to show — otherwise it keeps the last snapshot visible —
 *      and (b) keeps the skeleton up while the default vehicle is still
 *      resolving from `useVehicles` (rather than flashing "No security data").
 *   6. Freshness-control refresh → refetch.
 *   7. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used; both feed `useSecurityLatest(id, 5s)`.
 *
 * Strategy (mirrors DrivetrainHealthWidget.test.tsx + AnalyticsSummaryWidget.test.tsx):
 *   - The data hooks are mocked with hoisted vi.fn()s so the network is never
 *     touched and every render is deterministic. The widget keeps the REAL
 *     type guards, REAL WidgetStatusGrid and REAL WidgetShell, so the status
 *     mapping + grid markup are genuinely rendered.
 *   - react-i18next resolves the developer fallback string.
 *   - matchMedia is shimmed so framer-motion (via the freshness chip) settles.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls useNavigate.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { securityMock, vehiclesMock } = vi.hoisted(() => ({
  securityMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return {
    ...actual,
    useVehicles: () => vehiclesMock(),
    useSecurityLatest: (...args: unknown[]) => securityMock(...args),
  };
});

import SecurityStatusWidget from './SecurityStatusWidget';
import type { WidgetSize } from './types';
import type { SecurityEvent } from '@/api/types';

/* ── Fixtures ─────────────────────────────────────────────────────── */

/** A fully-secured snapshot: locked, sentry armed, all doors + windows closed. */
function makeSecurity(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 7,
    ts: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: true,
    user_present: null,
    detail: null,
    source: 'telemetry',
    door_state: 'all_closed',
    fd_window: 'Closed',
    fp_window: 'Closed',
    rd_window: 'Closed',
    rp_window: 'Closed',
    ...overrides,
  };
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(vehicleId?: number, size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <SecurityStatusWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  securityMock.mockReset();
  vehiclesMock.mockReset();

  securityMock.mockReturnValue(makeQuery({ data: makeSecurity() }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }], isLoading: false });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('SecurityStatusWidget', () => {
  it('renders the titled shell and four "ok" cells when fully secured', () => {
    const { container } = renderWidget();

    expect(screen.getByText('Security')).toBeInTheDocument();

    // Labels for every cell.
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Sentry')).toBeInTheDocument();
    expect(screen.getByText('Doors')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();

    // Values: secured state.
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Doors + Windows both closed → two "All Closed" values.
    expect(screen.getAllByText('All Closed')).toHaveLength(2);

    // Every cell is "ok" → four emerald status dots, no alarm colours.
    expect(container.querySelectorAll('.bg-emerald-500')).toHaveLength(4);
    expect(container.querySelector('.bg-red-500')).toBeNull();
    expect(container.querySelector('.bg-amber-500')).toBeNull();
  });

  it('maps an unlocked car to a red "error" lock cell and sentry-off to "inactive"', () => {
    securityMock.mockReturnValue(
      makeQuery({ data: makeSecurity({ locked: false, sentry_mode: false }) }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();

    // Unlocked → red error dot.
    expect(container.querySelector('.bg-red-500')).toBeInTheDocument();
    // Sentry "Off" is inactive (neutral), not an alarm.
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('regression: null lock/sentry render as unknown "—", never a false red "Unlocked"', () => {
    securityMock.mockReturnValue(
      makeQuery({ data: makeSecurity({ locked: null, sentry_mode: null }) }),
    );
    const { container } = renderWidget();

    // Both unknown cells collapse to the em-dash placeholder.
    expect(screen.getAllByText('—')).toHaveLength(2);

    // Crucially, a null lock is NOT reported as a red "Unlocked" alarm.
    expect(screen.queryByText('Unlocked')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-500')).toBeNull();
  });

  it('regression: absent door/window data renders unknown "—", not a false "All Closed"', () => {
    securityMock.mockReturnValue(
      makeQuery({
        data: makeSecurity({
          door_state: undefined,
          fd_window: undefined,
          fp_window: undefined,
          rd_window: undefined,
          rp_window: undefined,
        }),
      }),
    );
    renderWidget();

    // Lock + Sentry are still known.
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    // Doors + Windows are unknown → two em-dashes, and NOT a green "All Closed".
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('All Closed')).not.toBeInTheDocument();
  });

  it('counts open doors + windows and flags them with a warning status', () => {
    securityMock.mockReturnValue(
      makeQuery({
        data: makeSecurity({
          door_state: 'driver-front-open, passenger-rear-open',
          fd_window: 'Open',
          fp_window: 'Closed',
          rd_window: 'Closed',
          rp_window: 'Closed',
        }),
      }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('2 Open')).toBeInTheDocument();
    expect(screen.getByText('1 Open')).toBeInTheDocument();
    // Two warning cells → amber dots present.
    expect(container.querySelectorAll('.bg-amber-500').length).toBeGreaterThanOrEqual(2);
  });

  it('treats a native boolean door_state=true as one open door', () => {
    securityMock.mockReturnValue(
      makeQuery({ data: makeSecurity({ door_state: true }) }),
    );
    renderWidget();

    expect(screen.getByText('1 Open')).toBeInTheDocument();
  });

  it('is null-safe against a garbage payload without throwing', () => {
    // Runtime values from the untyped backend can be the wrong kind entirely.
    securityMock.mockReturnValue(
      makeQuery({
        data: makeSecurity({
          locked: 'yes' as unknown as SecurityEvent['locked'],
          door_state: 42 as unknown as SecurityEvent['door_state'],
          fd_window: 42 as unknown as SecurityEvent['fd_window'],
          fp_window: null,
          rd_window: null,
          rp_window: null,
        }),
      }),
    );

    expect(() => renderWidget()).not.toThrow();
    // A non-boolean "locked" and all-non-string windows collapse to unknown.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the empty state (keeping the titled shell) when there is no snapshot', () => {
    securityMock.mockReturnValue(makeQuery({ data: null }));
    renderWidget();

    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('No security data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // No cells while empty.
    expect(screen.queryByText('Lock')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the snapshot query is loading', () => {
    securityMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No header/cells while loading.
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
    expect(screen.queryByText('Lock')).not.toBeInTheDocument();
  });

  it('surfaces the shared error panel when a failure leaves no data to show', () => {
    securityMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // The error panel replaces the empty-state + header (distinguishing a
    // failure from a genuine "no data yet").
    expect(screen.queryByText('No security data')).not.toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('keeps the last snapshot visible on a background error instead of the error panel', () => {
    securityMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: makeSecurity() }),
    );
    renderWidget();

    // Data is still shown — no hard error panel over stale-but-present data.
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it('keeps the skeleton up while the default vehicle is still resolving', () => {
    // No vehicleId prop + vehicles still loading: the security query is disabled
    // (id === 0, no data) so without the vehicles-loading gate the widget would
    // flash "No security data".
    vehiclesMock.mockReturnValue({ data: undefined, isLoading: true });
    securityMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('No security data')).not.toBeInTheDocument();
  });

  it('refetches when the freshness refresh control is activated', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    securityMock.mockReturnValue(
      makeQuery({ data: makeSecurity(), refetch, dataUpdatedAt: Date.now() }),
    );
    renderWidget();

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 9 }], isLoading: false });
    renderWidget();

    expect(securityMock).toHaveBeenCalledWith(9, 5_000);
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget(42);

    expect(securityMock).toHaveBeenCalledWith(42, 5_000);
  });
});
