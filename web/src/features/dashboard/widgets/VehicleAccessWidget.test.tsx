/**
 * VehicleAccessWidget — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "Vehicle Access" widget.
 *
 * The widget resolves a vehicle (from the `vehicleId` prop, else the first
 * vehicle, else `undefined` → the three per-vehicle queries stay disabled),
 * then reads THREE independent sources — `useVehicleDrivers`,
 * `useVehicleInvitations` (both `@/api/hooks/useVehicleAccess`) and
 * `useVehicleMobileEnabled` (`@/api/hooks/useVehicles`) — and folds their
 * loading / fetching / stale / error / updatedAt flags together. It renders one
 * of two layouts driven by `size.cols`:
 *   • compact (cols ≤ 1): a driver count + an icon-only mobile-access status dot
 *     (enabled → emerald, disabled → red, unknown → surface);
 *   • standard (cols ≥ 2): a "Mobile Access" Enabled/Disabled/Unknown badge, an
 *     "Authorized Drivers" list (Owner/Driver role badges) and a "Pending
 *     Invitations" list (Pending/Accepted/Expired status badges) shown only when
 *     invitations exist.
 *
 * What this file pins:
 *   - the ERROR fix (the point of this pass): an errored INITIAL load with
 *     nothing cached across all three sources now surfaces an error panel
 *     instead of the misleading "No access data available" empty state, while a
 *     background-refetch error over cached data keeps the panel on screen
 *     (mirrors the sibling widgets);
 *   - the LOADING fold — the *vehicle list itself* loading (before any vehicle
 *     resolves and while the per-vehicle queries are therefore disabled/not
 *     "loading") shows a skeleton, never an empty-state flash;
 *   - the LAYOUT SWITCH (compact vs standard) and each layout's distinguishing
 *     output;
 *   - every MOBILE-ACCESS branch (enabled / disabled / unknown) in both the
 *     standard badge and the compact status dot;
 *   - the DRIVER role branch (owner → "Owner", else "Driver") and null-safe
 *     label fallback, and the INVITATION status branch
 *     (pending / accepted / expired);
 *   - the EMPTY state (never a blank panel) when every source resolves empty;
 *   - the a11y HARDENING — the icon-only mobile dot now carries a `role="img"`
 *     + descriptive `aria-label`;
 *   - the VEHICLE-ID resolution ladder (prop → first vehicle → undefined) and
 *     that every hook is subscribed with the resolved STRING id;
 *   - the REFRESH control wiring (accessible chip → all three `refetch`s) and
 *     the title a11y.
 *
 * Strategy: the three data hooks + `useVehicles` are the network boundary and
 * are fully controllable via hoisted mocks. `react-i18next` echoes each
 * `t(key, fallback)` fallback so assertions read against English copy. The
 * header freshness chip's display hooks (`useDateFormat` / `useMotionPreference`)
 * are stubbed so `WidgetShell` renders synchronously without a Settings
 * provider. A `<MemoryRouter>` wraps every render because the error panel
 * (`QueryError`) calls `useNavigate` and `EmptyState` can render a `<Link>`. The
 * repo does not ship `@testing-library/user-event`, so interactions use
 * `fireEvent` — the established convention across the sibling widget tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { VehicleDriver, VehicleInvitation } from '@/api/types';
import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { vehiclesMock, driversMock, invitationsMock, mobileMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  driversMock: vi.fn(),
  invitationsMock: vi.fn(),
  mobileMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicleAccess', () => ({
  useVehicleDrivers: (...args: unknown[]) => driversMock(...args),
  useVehicleInvitations: (...args: unknown[]) => invitationsMock(...args),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleMobileEnabled: (...args: unknown[]) => mobileMock(...args),
}));

// i18n → echo the developer fallback, interpolating `{{var}}` placeholders so
// copy reads as English regardless of namespace.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interp = (tpl: string, opts?: Record<string, unknown>) =>
    opts ? tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string, opts?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interp(fallback, opts) : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Freshness chip display hooks — stubbed so the WidgetShell header renders
// deterministically without a Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import VehicleAccessWidget from './VehicleAccessWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function makeDriver(over: Partial<VehicleDriver> = {}): VehicleDriver {
  return {
    id: 1,
    vehicle_id: 7,
    share_user_id: 10,
    driver_email: 'alice@example.com',
    driver_name: 'Alice',
    role: 'owner',
    fetched_at: NOW,
    ...over,
  };
}

function makeInvitation(over: Partial<VehicleInvitation> = {}): VehicleInvitation {
  return {
    id: 1,
    vehicle_id: 7,
    invitation_id: 'inv-1',
    invite_url: null,
    status: 'pending',
    expires_at: null,
    created_by: 'Bob',
    fetched_at: NOW,
    created_at: NOW,
    ...over,
  };
}

interface MobileEnvelope {
  data: { enabled: boolean } | null;
  fetched_at: string | null;
}

/** `enabled === null` models a source that resolved with no payload. */
function makeMobileEnvelope(enabled: boolean | null): MobileEnvelope {
  return { data: enabled === null ? null : { enabled }, fetched_at: NOW };
}

interface QueryOverrides<T> {
  data?: T;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeQuery<T>(over: QueryOverrides<T> = {}) {
  return {
    data: undefined as T | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW_MS,
    refetch: vi.fn(),
    ...over,
  };
}

function setDrivers(over: QueryOverrides<VehicleDriver[]> = {}) {
  const q = makeQuery(over);
  driversMock.mockReturnValue(q);
  return q;
}

function setInvitations(over: QueryOverrides<VehicleInvitation[]> = {}) {
  const q = makeQuery(over);
  invitationsMock.mockReturnValue(q);
  return q;
}

function setMobile(over: QueryOverrides<MobileEnvelope> = {}) {
  const q = makeQuery(over);
  mobileMock.mockReturnValue(q);
  return q;
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <VehicleAccessWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }], isLoading: false });
  // Default: mobile access resolves "enabled" (so hasAnyData is true and the
  // standard layout renders content), with no drivers or invitations.
  setDrivers({ data: [] });
  setInvitations({ data: [] });
  setMobile({ data: makeMobileEnvelope(true) });
});

// ── Loading / error / empty states ──────────────────────────────────────────────

describe('VehicleAccessWidget — loading / error / empty states', () => {
  it('renders only a skeleton (no title or content) while a source is loading', () => {
    setDrivers({ isLoading: true, data: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /Vehicle Access/i })).toBeNull();
    expect(screen.queryByText('No access data available')).toBeNull();
  });

  it('folds the vehicle-list load into the skeleton (no empty-state flash before a vehicle resolves)', () => {
    // Bug pin: with no vehicleId prop the widget resolves its vehicle from the
    // list; while that list loads the per-vehicle queries are disabled and thus
    // not "loading", so without folding in `vehiclesLoading` the widget would
    // flash "No access data available".
    vehiclesMock.mockReturnValue({ data: undefined, isLoading: true });
    setDrivers({ data: undefined });
    setInvitations({ data: undefined });
    setMobile({ data: undefined });
    const { container } = renderWidget(FULL, undefined);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No access data available')).toBeNull();
  });

  it('surfaces an error panel (not the empty state) when the initial load fails with no data', () => {
    setDrivers({ isError: true, data: undefined });
    setInvitations({ data: [] });
    setMobile({ data: makeMobileEnvelope(null) });
    renderWidget(FULL);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No access data available')).toBeNull();
  });

  it('keeps cached content visible (no error panel) when a background refetch errors', () => {
    // Mobile access already resolved → a transient error on refetch must not
    // blank the widget; the freshness dot flags the error instead.
    setDrivers({ data: [] });
    setInvitations({ data: [] });
    setMobile({ isError: true, data: makeMobileEnvelope(true) });
    renderWidget(FULL);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.getByText('Mobile Access')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows the empty state (not an error) when every source resolves empty', () => {
    setDrivers({ data: [] });
    setInvitations({ data: [] });
    setMobile({ data: makeMobileEnvelope(null) });
    renderWidget(FULL);

    expect(screen.getByText('No access data available')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ── Standard layout ─────────────────────────────────────────────────────────────

describe('VehicleAccessWidget — standard layout', () => {
  it('renders the mobile-access status, authorized drivers and their role badges', () => {
    setMobile({ data: makeMobileEnvelope(true) });
    setDrivers({
      data: [
        makeDriver({ id: 1, driver_name: 'Alice', role: 'owner' }),
        makeDriver({ id: 2, driver_name: 'Bob', role: 'driver' }),
      ],
    });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Vehicle Access/i })).toBeInTheDocument();
    expect(screen.getByText('Mobile Access')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Authorized Drivers')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Driver')).toBeInTheDocument();
  });

  it('maps a disabled mobile-access source to a "Disabled" badge and shows the drivers empty state', () => {
    setMobile({ data: makeMobileEnvelope(false) });
    setDrivers({ data: [] });
    renderWidget(FULL);

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('No authorized drivers')).toBeInTheDocument();
  });

  it('maps an unknown mobile-access source to an "Unknown" badge', () => {
    // mobile null on its own would be the empty state, so pin the Unknown badge
    // via a snapshot that still has a driver (hasAnyData stays true).
    setMobile({ data: makeMobileEnvelope(null) });
    setDrivers({ data: [makeDriver({ driver_name: 'Alice' })] });
    renderWidget(FULL);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('falls back to the driver email, then "—", when the display name is missing', () => {
    setDrivers({
      data: [
        makeDriver({ id: 1, driver_name: null, driver_email: 'no-name@example.com' }),
        makeDriver({ id: 2, driver_name: null, driver_email: null }),
      ],
    });
    renderWidget(FULL);

    expect(screen.getByText('no-name@example.com')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the pending-invitations section with per-status badges', () => {
    setDrivers({ data: [] });
    setInvitations({
      data: [
        makeInvitation({ id: 1, created_by: 'Bob', status: 'pending' }),
        makeInvitation({ id: 2, created_by: 'Carol', status: 'accepted' }),
        makeInvitation({ id: 3, created_by: 'Dave', status: 'expired' }),
      ],
    });
    renderWidget(FULL);

    expect(screen.getByText('Pending Invitations')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.getByText('Dave')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('hides the pending-invitations section when there are no invitations', () => {
    setDrivers({ data: [makeDriver({ driver_name: 'Alice' })] });
    setInvitations({ data: [] });
    setMobile({ data: makeMobileEnvelope(null) });
    renderWidget(FULL);

    expect(screen.queryByText('Pending Invitations')).toBeNull();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

// ── Compact layout ──────────────────────────────────────────────────────────────

describe('VehicleAccessWidget — compact layout', () => {
  it('renders the driver count and an accessible enabled mobile-status indicator', () => {
    setMobile({ data: makeMobileEnvelope(true) });
    setDrivers({ data: [makeDriver({ id: 1 }), makeDriver({ id: 2 })] });
    const { container } = renderWidget(COMPACT);

    expect(container.textContent).toContain('2 Drivers');
    expect(screen.getByRole('img', { name: 'Mobile access enabled' })).toBeInTheDocument();
    // The standard-layout scaffolding must not leak into the compact view.
    expect(screen.queryByText('Authorized Drivers')).toBeNull();
  });

  it('labels the mobile-status dot "disabled" when mobile access is off', () => {
    setMobile({ data: makeMobileEnvelope(false) });
    setDrivers({ data: [makeDriver()] });
    renderWidget(COMPACT);

    expect(screen.getByRole('img', { name: 'Mobile access disabled' })).toBeInTheDocument();
  });

  it('labels the mobile-status dot "unknown" when mobile access has not resolved', () => {
    setMobile({ data: makeMobileEnvelope(null) });
    setDrivers({ data: [makeDriver()] });
    renderWidget(COMPACT);

    expect(screen.getByRole('img', { name: 'Mobile access unknown' })).toBeInTheDocument();
  });
});

// ── Vehicle-id resolution ───────────────────────────────────────────────────────

describe('VehicleAccessWidget — vehicle-id resolution', () => {
  it('subscribes every hook with the explicit vehicleId prop as a string', () => {
    renderWidget(FULL, 5);

    expect(driversMock).toHaveBeenCalledWith('5');
    expect(invitationsMock).toHaveBeenCalledWith('5');
    expect(mobileMock).toHaveBeenCalledWith('5');
  });

  it('falls back to the first vehicle id when no prop is supplied', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 42, display_name: 'Other' }], isLoading: false });
    renderWidget(FULL, undefined);

    expect(driversMock).toHaveBeenCalledWith('42');
    expect(invitationsMock).toHaveBeenCalledWith('42');
    expect(mobileMock).toHaveBeenCalledWith('42');
  });

  it('subscribes with undefined (disabled) when no vehicle can be resolved', () => {
    vehiclesMock.mockReturnValue({ data: [], isLoading: false });
    setDrivers({ data: undefined });
    setInvitations({ data: undefined });
    setMobile({ data: undefined });
    renderWidget(FULL, undefined);

    expect(driversMock).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('No access data available')).toBeInTheDocument();
  });
});

// ── Interactions & accessibility ────────────────────────────────────────────────

describe('VehicleAccessWidget — interactions & a11y', () => {
  it('invokes every source refetch when the accessible refresh control is activated', () => {
    const dq = setDrivers({ data: [] });
    const iq = setInvitations({ data: [] });
    const mq = setMobile({ data: makeMobileEnvelope(true) });
    renderWidget(FULL);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(dq.refetch).toHaveBeenCalledTimes(1);
    expect(iq.refetch).toHaveBeenCalledTimes(1);
    expect(mq.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading', () => {
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Vehicle Access/i })).toBeInTheDocument();
  });
});
