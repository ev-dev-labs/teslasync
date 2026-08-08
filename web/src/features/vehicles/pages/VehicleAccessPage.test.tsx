/**
 * VehicleAccessPage — behaviour + hardening coverage.
 *
 * The page has a single default export orchestrating two data queries
 * (drivers + invitations) and five mutations (refresh drivers / refresh
 * invitations / remove driver / create invitation / revoke invitation). This
 * suite drives it through every meaningful branch by mocking its data + mutation
 * hooks and `useVehicle`, then asserting on the rendered DOM and on the exact
 * mutation payloads. The route `:id` param is provided via a real `<Routes>` so
 * `useParams()` resolves the vehicle id the hooks and mutations are keyed on.
 * Network is never touched.
 *
 * Facets covered:
 *   - populated: the four-tile KPI band (drivers / invitations / pending /
 *     expiring-soon) derives its numbers from the same hook data as the tables;
 *     the drivers table renders names/emails/role and only shows a Remove
 *     button for drivers with a `share_user_id`; the invitations table renders
 *     status badges, a Copy button only when an invite_url exists, and a Revoke
 *     button only for pending rows; the Access Overview visualises the status
 *     and role composition.
 *   - the "expiring soon" derive: only PENDING invitations whose `expires_at`
 *     is in the future AND within 7 days are counted (a 30-day-out pending, a
 *     null-expiry pending, an accepted, and an already-expired revoked are all
 *     excluded).
 *   - loading: every data panel stands in a skeleton (no table, no empty copy)
 *     while the KPI band shows zeros.
 *   - empty: each panel surfaces its own empty state rather than a blank panel.
 *   - error: a failed drivers query surfaces QueryError with a working Retry
 *     wired to refetch; the same holds for a failed invitations query.
 *   - interactions: Remove opens a ConfirmDialog and fires the DELETE mutation
 *     with `{ vehicleId, shareUserId }` on confirm (and closes on settle);
 *     Cancel closes without mutating; Revoke fires with `{ vehicleId,
 *     invitationId }`; the header Refresh / Invite buttons fire their mutations
 *     with the route vehicle id.
 *   - regression: a driver whose `share_user_id` is the falsy-but-valid `0` is
 *     still removable — the confirm handler predicate matches the button's
 *     render predicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { VehicleDriver, VehicleInvitation } from '@/api/types';

// ── i18n stub: resolve a string fallback (or the options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ────────
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.* + AnimatePresence so
//    FadeIn / MetricBar render deterministic inert nodes in jsdom. ────────────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              [
                'animate', 'initial', 'exit', 'transition', 'whileHover',
                'whileTap', 'whileInView', 'viewport', 'variants', 'layout',
              ].includes(k)
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── Data + mutation hooks, driven per test. ──
vi.mock('@/api/hooks/useVehicleAccess', () => ({
  useVehicleDrivers: vi.fn(),
  useVehicleInvitations: vi.fn(),
  useRefreshVehicleDrivers: vi.fn(),
  useRefreshVehicleInvitations: vi.fn(),
  useRemoveVehicleDriver: vi.fn(),
  useCreateVehicleInvitation: vi.fn(),
  useRevokeVehicleInvitation: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicle: vi.fn() }));

import {
  useVehicleDrivers,
  useVehicleInvitations,
  useRefreshVehicleDrivers,
  useRefreshVehicleInvitations,
  useRemoveVehicleDriver,
  useCreateVehicleInvitation,
  useRevokeVehicleInvitation,
} from '@/api/hooks/useVehicleAccess';
import { useVehicle } from '@/api/hooks/useVehicles';
import VehicleAccessPage from './VehicleAccessPage';

const mockDrivers = useVehicleDrivers as unknown as ReturnType<typeof vi.fn>;
const mockInvitations = useVehicleInvitations as unknown as ReturnType<typeof vi.fn>;
const mockRefreshDrivers = useRefreshVehicleDrivers as unknown as ReturnType<typeof vi.fn>;
const mockRefreshInvitations = useRefreshVehicleInvitations as unknown as ReturnType<typeof vi.fn>;
const mockRemoveDriver = useRemoveVehicleDriver as unknown as ReturnType<typeof vi.fn>;
const mockCreateInvitation = useCreateVehicleInvitation as unknown as ReturnType<typeof vi.fn>;
const mockRevokeInvitation = useRevokeVehicleInvitation as unknown as ReturnType<typeof vi.fn>;
const mockVehicle = useVehicle as unknown as ReturnType<typeof vi.fn>;

 
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

 
function makeMutation(over: Record<string, unknown> = {}): any {
  return { mutate: vi.fn(), isPending: false, ...over };
}

function makeDriver(over: Partial<VehicleDriver> = {}): VehicleDriver {
  return {
    id: 1,
    vehicle_id: 7,
    share_user_id: 1001,
    driver_email: 'ada@example.com',
    driver_name: 'Ada Lovelace',
    role: 'driver',
    fetched_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeInvite(over: Partial<VehicleInvitation> = {}): VehicleInvitation {
  return {
    id: 1,
    vehicle_id: 7,
    invitation_id: 'inv-1',
    invite_url: null,
    status: 'pending',
    expires_at: null,
    created_by: 'Fleet Admin',
    fetched_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

// Fresh mutation doubles per test so `.mutate` call history never leaks.
let refreshDriversM: ReturnType<typeof makeMutation>;
let refreshInvitationsM: ReturnType<typeof makeMutation>;
let removeDriverM: ReturnType<typeof makeMutation>;
let createInvitationM: ReturnType<typeof makeMutation>;
let revokeInvitationM: ReturnType<typeof makeMutation>;

beforeEach(() => {
  vi.clearAllMocks();

  refreshDriversM = makeMutation();
  refreshInvitationsM = makeMutation();
  removeDriverM = makeMutation();
  createInvitationM = makeMutation();
  revokeInvitationM = makeMutation();

  mockRefreshDrivers.mockReturnValue(refreshDriversM);
  mockRefreshInvitations.mockReturnValue(refreshInvitationsM);
  mockRemoveDriver.mockReturnValue(removeDriverM);
  mockCreateInvitation.mockReturnValue(createInvitationM);
  mockRevokeInvitation.mockReturnValue(revokeInvitationM);

  mockVehicle.mockReturnValue(makeQuery({ data: { id: 7, display_name: 'My Model 3' } }));

  // Default: both queries resolved but empty. Tests override as needed.
  mockDrivers.mockReturnValue(makeQuery({ data: [] }));
  mockInvitations.mockReturnValue(makeQuery({ data: [] }));
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter initialEntries={['/vehicles/7/access']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/vehicles/:id/access" element={<VehicleAccessPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The KPI band is the sole ARIA region — scope numeric assertions to it so
 *  metric values don't collide with counts elsewhere on the page. */
const kpiRegion = () => screen.getByRole('region', { name: 'Access summary' });

const populatedDrivers: VehicleDriver[] = [
  makeDriver({ id: 1, share_user_id: 1001, driver_name: 'Ada Lovelace', driver_email: 'ada@example.com', role: 'driver' }),
  makeDriver({ id: 2, share_user_id: null, driver_name: 'Bob', driver_email: 'bob@example.com', role: 'owner' }),
];

const populatedInvites: VehicleInvitation[] = [
  makeInvite({ id: 1, invitation_id: 'inv-1', status: 'pending', expires_at: isoIn(3), invite_url: 'https://tesla.test/invite/abc' }),
  makeInvite({ id: 2, invitation_id: 'inv-2', status: 'pending', expires_at: isoIn(30), invite_url: null }),
  makeInvite({ id: 3, invitation_id: 'inv-3', status: 'pending', expires_at: null, invite_url: null }),
  makeInvite({ id: 4, invitation_id: 'inv-4', status: 'accepted', expires_at: isoIn(10), invite_url: null }),
  makeInvite({ id: 5, invitation_id: 'inv-5', status: 'revoked', expires_at: isoIn(-2), invite_url: null }),
];

function renderPopulated() {
  mockDrivers.mockReturnValue(makeQuery({ data: populatedDrivers }));
  mockInvitations.mockReturnValue(makeQuery({ data: populatedInvites }));
  return renderPage();
}

describe('VehicleAccessPage — populated KPIs', () => {
  it('derives each KPI from the hook data (drivers, invitations, pending, expiring-soon)', () => {
    renderPopulated();
    const kpi = kpiRegion();
    // 2 drivers, 5 invitations, 3 pending (inv-1/2/3), 1 expiring-soon (inv-1).
    expect(within(kpi).getByText('2')).toBeInTheDocument();
    expect(within(kpi).getByText('5')).toBeInTheDocument();
    expect(within(kpi).getByText('3')).toBeInTheDocument();
    expect(within(kpi).getByText('1')).toBeInTheDocument();
    // Labels are present so the numbers are legible without colour alone.
    expect(within(kpi).getByText('Expiring Soon')).toBeInTheDocument();
  });
});

describe('VehicleAccessPage — populated tables + overview', () => {
  it('renders drivers, gating the Remove button on share_user_id', () => {
    renderPopulated();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Only Ada has a share_user_id → exactly one Remove button (Bob's is null).
    expect(screen.getAllByRole('button', { name: 'Remove driver' })).toHaveLength(1);
  });

  it('renders invitations, gating Copy on invite_url and Revoke on pending status', () => {
    renderPopulated();
    // Only inv-1 carries a URL → one Copy button.
    expect(screen.getAllByRole('button', { name: 'Copy invite link' })).toHaveLength(1);
    // Three pending rows → three Revoke buttons (accepted + revoked excluded).
    expect(screen.getAllByRole('button', { name: 'Revoke invitation' })).toHaveLength(3);
    // status badges use the raw status; created_by is surfaced per row.
    expect(screen.getAllByText('pending')).toHaveLength(3);
    expect(screen.getAllByText('Fleet Admin').length).toBeGreaterThan(0);
  });

  it('summarises status + role composition in the Access Overview', () => {
    renderPopulated();
    // Status distribution bars (title-cased, distinct from the raw-status table).
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    // Driver-role chips (title-cased).
    expect(screen.getByText('Driver')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });
});

describe('VehicleAccessPage — loading', () => {
  it('shows skeletons (no tables/empty copy) and a zeroed KPI band', () => {
    mockDrivers.mockReturnValue(makeQuery({ data: undefined, isLoading: true, isFetching: true }));
    mockInvitations.mockReturnValue(makeQuery({ data: undefined, isLoading: true, isFetching: true }));

    renderPage();

    expect(within(kpiRegion()).getAllByText('0')).toHaveLength(4);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('No drivers found. Refresh to sync from Tesla.')).toBeNull();
  });
});

describe('VehicleAccessPage — empty', () => {
  it('surfaces a dedicated empty state for every panel', () => {
    renderPage(); // beforeEach default = both empty
    expect(
      screen.getByText('No drivers found. Refresh to sync from Tesla.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No invitations yet. Create one to share vehicle access.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No access data to summarize yet.')).toBeInTheDocument();
    expect(within(kpiRegion()).getAllByText('0')).toHaveLength(4);
  });
});

describe('VehicleAccessPage — error handling', () => {
  it('renders a working Retry when the drivers query fails', () => {
    const refetchDrivers = vi.fn();
    mockDrivers.mockReturnValue(
      makeQuery({ isError: true, error: new Error('boom'), refetch: refetchDrivers }),
    );

    renderPage();

    const retry = screen.getAllByRole('button', { name: 'Retry' });
    expect(retry.length).toBeGreaterThan(0);
    // The drivers table must NOT paint through the error.
    expect(screen.queryByText('No drivers found. Refresh to sync from Tesla.')).toBeNull();

    fireEvent.click(retry[0]);
    expect(refetchDrivers).toHaveBeenCalled();
  });

  it('renders a working Retry when the invitations query fails', () => {
    const refetchInvitations = vi.fn();
    mockInvitations.mockReturnValue(
      makeQuery({ isError: true, error: new Error('kaboom'), refetch: refetchInvitations }),
    );

    renderPage();

    const retry = screen.getAllByRole('button', { name: 'Retry' });
    expect(retry.length).toBeGreaterThan(0);
    fireEvent.click(retry[retry.length - 1]);
    expect(refetchInvitations).toHaveBeenCalled();
  });
});

describe('VehicleAccessPage — remove driver', () => {
  it('confirms then fires the DELETE mutation and closes on settle', async () => {
    mockDrivers.mockReturnValue(
      makeQuery({ data: [makeDriver({ id: 1, share_user_id: 1001 })] }),
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove driver' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove Driver')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(removeDriverM.mutate).toHaveBeenCalledTimes(1);
    const [payload, opts] = removeDriverM.mutate.mock.calls[0];
    expect(payload).toEqual({ vehicleId: '7', shareUserId: 1001 });
    expect(typeof opts.onSettled).toBe('function');

    // Settling closes the dialog (parent keeps it open during the mutation).
    act(() => opts.onSettled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancels without mutating', async () => {
    mockDrivers.mockReturnValue(
      makeQuery({ data: [makeDriver({ id: 1, share_user_id: 1001 })] }),
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove driver' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(removeDriverM.mutate).not.toHaveBeenCalled();
  });

  it('keeps a driver whose share_user_id is the falsy-but-valid 0 removable', async () => {
    mockDrivers.mockReturnValue(
      makeQuery({ data: [makeDriver({ id: 9, share_user_id: 0 })] }),
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove driver' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(removeDriverM.mutate).toHaveBeenCalledTimes(1);
    expect(removeDriverM.mutate.mock.calls[0][0]).toEqual({ vehicleId: '7', shareUserId: 0 });
  });
});

describe('VehicleAccessPage — revoke invitation', () => {
  it('confirms then fires the revoke mutation with the invitation id', async () => {
    mockInvitations.mockReturnValue(
      makeQuery({ data: [makeInvite({ id: 1, invitation_id: 'inv-42', status: 'pending' })] }),
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revoke Invitation')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(revokeInvitationM.mutate).toHaveBeenCalledTimes(1);
    expect(revokeInvitationM.mutate.mock.calls[0][0]).toEqual({
      vehicleId: '7',
      invitationId: 'inv-42',
    });
  });
});

describe('VehicleAccessPage — header actions', () => {
  it('fires refresh + create mutations keyed on the route vehicle id', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh drivers' }));
    expect(refreshDriversM.mutate).toHaveBeenCalledWith('7');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh invitations' }));
    expect(refreshInvitationsM.mutate).toHaveBeenCalledWith('7');

    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(createInvitationM.mutate).toHaveBeenCalledWith('7');
  });
});
