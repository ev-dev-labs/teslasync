/**
 * NotificationGroupRow tests — Phase-46 / Prompt 27.
 *
 * Covers the 4 contracts from the prompt:
 *   1. 3 alerts with same group_key → 1 row, +N similar chip shows N=count-1
 *   2. Expanding the row fetches members and renders them inline
 *   3. Mark-group-read POSTs { group_key } and toasts success
 *   4. Singleton notifications render without grouping chrome (no chip)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';

import { NotificationGroupRow } from './NotificationGroupRow';
import type {
  NotificationLog,
  NotificationLogGroup,
  AlertRule,
  Vehicle,
} from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const { children, ...rest } = props as { children?: React.ReactNode };
        return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

// Module-level mocks for the two hooks the component depends on. The test
// suite swaps their return values per scenario via `mockImplementation`.
const useGroupMembersMock = vi.fn();
const bulkMarkReadMutateAsync = vi.fn(async (_vars: unknown) => ({ updated: 0 }));
const useBulkMarkReadMock = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: bulkMarkReadMutateAsync,
  isPending: false,
}));

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return {
    ...actual,
    useGroupMembers: (
      groupKey: string | null | undefined,
      filters: unknown,
      options?: { enabled?: boolean },
    ) => useGroupMembersMock(groupKey, filters, options),
    useBulkMarkRead: () => useBulkMarkReadMock(),
  };
});

const VEHICLES: Record<number, Vehicle> = {
  1: {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-A',
    display_name: 'Model 3',
  } as unknown as Vehicle,
};

const RULES: Record<number, AlertRule> = {
  10: {
    id: 10,
    name: 'Tire Pressure Low',
    enabled: true,
    severity: 'warn',
    vehicle_id: 1,
    signal: 'tire_pressure_front_left',
    operator: '<',
    value: 30,
    cooldown_seconds: 0,
    notification_channels: [],
  } as unknown as AlertRule,
};

const NOW = new Date();
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
const THREE_HOURS_AGO = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();

function makeLog(overrides: Partial<NotificationLog>): NotificationLog {
  return {
    id: 100,
    channel_id: 1,
    alert_id: 10,
    title: 'Tire pressure low',
    message: 'Front-left tire below 30 PSI',
    status: 'sent',
    severity: 'warn',
    error: '',
    created_at: ONE_HOUR_AGO,
    sent_at: ONE_HOUR_AGO,
    read_at: null,
    archived_at: null,
    ...overrides,
  };
}

const VALID_GROUP_KEY = 'a'.repeat(64);

function renderRow(group: NotificationLogGroup) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SelectedVehicleProvider>
          <ToastProvider>
            <NotificationGroupRow
              group={group}
              ruleMap={RULES}
              vehicleMap={VEHICLES}
              filters={{}}
              archived={false}
            />
          </ToastProvider>
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationGroupRow', () => {
  beforeEach(() => {
    useGroupMembersMock.mockReset();
    useGroupMembersMock.mockImplementation(() => ({
      data: [],
      isLoading: false,
      error: null,
    }));
    bulkMarkReadMutateAsync.mockReset();
    bulkMarkReadMutateAsync.mockImplementation(async () => ({ updated: 0 }));
  });

  // Contract 1 — three alerts in one thread render as a single row plus a
  // "+N similar" chip that shows the additional-member count.
  it('renders one row with a "+N similar" chip when count > 1', () => {
    const group: NotificationLogGroup = {
      group_key: VALID_GROUP_KEY,
      latest: makeLog({ id: 300, created_at: ONE_HOUR_AGO }),
      count: 3,
      unread_count: 2,
      vehicle_ids: [1],
    };
    renderRow(group);
    // The latest member always renders.
    expect(screen.getByText('Tire pressure low')).toBeInTheDocument();
    // The chip surfaces count - 1 = 2 additional siblings.
    expect(screen.getByTestId('group-expand-toggle')).toHaveTextContent('+2 similar');
    // Members are NOT fetched until expand → confirm the hook was called
    // with enabled: false on initial render.
    expect(useGroupMembersMock).toHaveBeenCalled();
    const lastCall = useGroupMembersMock.mock.calls.at(-1)!;
    expect(lastCall[2]).toMatchObject({ enabled: false });
  });

  // Contract 2 — clicking the chip toggles the expanded region, which
  // requests members from the API and inlines them under the latest row.
  it('expanding the row fetches and renders sibling members', async () => {
    const sibling1 = makeLog({ id: 301, title: 'Tire pressure low (1h ago)', created_at: TWO_HOURS_AGO });
    const sibling2 = makeLog({ id: 302, title: 'Tire pressure low (2h ago)', created_at: THREE_HOURS_AGO });
    const latest = makeLog({ id: 300, title: 'Tire pressure low (latest)', created_at: ONE_HOUR_AGO });
    const group: NotificationLogGroup = {
      group_key: VALID_GROUP_KEY,
      latest,
      count: 3,
      unread_count: 1,
      vehicle_ids: [1],
    };
    // First render → enabled false → empty data. After expand, the hook
    // is re-called with enabled true → return all 3 members. The component
    // filters out the latest from the otherMembers list so we should see
    // only the two siblings inlined.
    useGroupMembersMock.mockImplementation((_gk, _f, opts) => ({
      data: opts?.enabled ? [latest, sibling1, sibling2] : [],
      isLoading: false,
      error: null,
    }));

    renderRow(group);
    fireEvent.click(screen.getByTestId('group-expand-toggle'));

    await waitFor(() => {
      expect(screen.getByText('Tire pressure low (1h ago)')).toBeInTheDocument();
    });
    expect(screen.getByText('Tire pressure low (2h ago)')).toBeInTheDocument();
    // Latest must NOT render twice.
    const latestMatches = screen.getAllByText('Tire pressure low (latest)');
    expect(latestMatches).toHaveLength(1);
    // The expanded region carries an aria-controls target.
    expect(screen.getByTestId('group-members-region')).toBeInTheDocument();
  });

  // Contract 3 — Mark group read fires useBulkMarkRead with the correct
  // group_key payload (NOT an ids array) and surfaces a success toast.
  it('clicking "Mark group read" calls useBulkMarkRead with { group_key }', async () => {
    bulkMarkReadMutateAsync.mockResolvedValue({ updated: 3 });
    const group: NotificationLogGroup = {
      group_key: VALID_GROUP_KEY,
      latest: makeLog({ id: 300 }),
      count: 3,
      unread_count: 3,
      vehicle_ids: [1],
    };
    renderRow(group);
    const btn = screen.getByTestId('group-mark-read');
    fireEvent.click(btn);
    await waitFor(() => expect(bulkMarkReadMutateAsync).toHaveBeenCalledTimes(1));
    expect(bulkMarkReadMutateAsync).toHaveBeenCalledWith({ group_key: VALID_GROUP_KEY });
    // Success toast surfaces with the updated count.
    await waitFor(() =>
      expect(screen.getByText(/Marked 3 thread members as read/i)).toBeInTheDocument(),
    );
  });

  // Contract 3 (continued) — Mark group read button is hidden when the
  // group has no unread members. Avoids "Mark X read" pretending to do
  // anything when there's nothing left to mark.
  it('hides "Mark group read" when unread_count is 0', () => {
    const group: NotificationLogGroup = {
      group_key: VALID_GROUP_KEY,
      latest: makeLog({ id: 300, read_at: ONE_HOUR_AGO }),
      count: 3,
      unread_count: 0,
      vehicle_ids: [1],
    };
    renderRow(group);
    expect(screen.queryByTestId('group-mark-read')).not.toBeInTheDocument();
  });

  // Contract 4 — singleton groups (group_key === null) render as a plain
  // row with NO grouping chrome (no chip, no expand toggle, no mark
  // group read). The user should see the same UX as flat view.
  it('renders singleton groups without grouping chrome', () => {
    const group: NotificationLogGroup = {
      group_key: null,
      latest: makeLog({ id: 999, title: 'One-off info ping', alert_id: null }),
      count: 1,
      unread_count: 0,
      vehicle_ids: [],
    };
    renderRow(group);
    expect(screen.getByText('One-off info ping')).toBeInTheDocument();
    expect(screen.queryByTestId('group-expand-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-mark-read')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-vehicle-count')).not.toBeInTheDocument();
  });

  // Members error path surfaces an inline error message in the expanded
  // region without breaking the rest of the row.
  it('shows an inline error when fetching members fails', async () => {
    useGroupMembersMock.mockImplementation((_gk, _f, opts) => ({
      data: [],
      isLoading: false,
      error: opts?.enabled ? new Error('boom') : null,
    }));
    const group: NotificationLogGroup = {
      group_key: VALID_GROUP_KEY,
      latest: makeLog({ id: 300 }),
      count: 5,
      unread_count: 2,
      vehicle_ids: [1],
    };
    renderRow(group);
    fireEvent.click(screen.getByTestId('group-expand-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('group-members-error')).toBeInTheDocument();
    });
  });

  // The +N affordance is a button with proper aria-expanded semantics so
  // assistive tech announces the disclosure state correctly.
  it('toggle has aria-expanded that flips on click', () => {
    const group: NotificationLogGroup = {
      group_key: VALID_GROUP_KEY,
      latest: makeLog({ id: 300 }),
      count: 2,
      unread_count: 1,
      vehicle_ids: [1],
    };
    renderRow(group);
    const btn = screen.getByTestId('group-expand-toggle');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});
