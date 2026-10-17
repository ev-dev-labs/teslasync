/**
 * NotificationGroupRow tests: grouping, member expansion, mark-group-read,
 * and singleton rendering without grouping chrome.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
import { setGlobalLocale } from '@/lib/numberFormat';
import type { NotificationFilters } from '@/api/hooks/useNotifications';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: requestMock,
}));

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

function renderRow(group: NotificationLogGroup, filters: NotificationFilters = {}) {
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
              filters={filters}
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
      refetch: vi.fn(),
    }));
    requestMock.mockReset();
    setGlobalLocale('en-US');
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
    const lastCall = useGroupMembersMock.mock.calls[useGroupMembersMock.mock.calls.length - 1]!;
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
      data: undefined,
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

  it('keeps siblings and offers only the failed member source retry on refresh failure', () => {
    const retry = vi.fn();
    const latest = makeLog({ id: 300 });
    const sibling = makeLog({ id: 301, title: 'Retained sibling' });
    useGroupMembersMock.mockReturnValue({
      data: [latest, sibling], error: new Error('refresh failed'),
      isError: true, isFetching: false, fetchStatus: 'idle', refetch: retry,
      dataUpdatedAt: Date.now(),
    });
    renderRow({ group_key: VALID_GROUP_KEY, latest, count: 2, unread_count: 1, vehicle_ids: [1] });
    fireEvent.click(screen.getByTestId('group-expand-toggle'));
    expect(screen.getByText('Retained sibling')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('group-members-error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(bulkMarkReadMutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['fetching', 'Loading thread members…'],
    ['paused', 'Refresh paused'],
    ['idle', 'Unknown'],
  ] as const)('does not claim empty members during initial %s', (fetchStatus, message) => {
    useGroupMembersMock.mockReturnValue({
      data: undefined, error: null, isPending: true, isLoading: fetchStatus === 'fetching',
      isFetching: fetchStatus === 'fetching', fetchStatus, refetch: vi.fn(),
    });
    renderRow({ group_key: VALID_GROUP_KEY, latest: makeLog({}), count: 2, unread_count: 1, vehicle_ids: [] });
    fireEvent.click(screen.getByTestId('group-expand-toggle'));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('No thread members found')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('offers member-specific retry after initial failure and keeps the latest row', () => {
    const retry = vi.fn();
    useGroupMembersMock.mockReturnValue({ data: undefined, error: new Error('first load'), refetch: retry });
    renderRow({ group_key: VALID_GROUP_KEY, latest: makeLog({}), count: 2, unread_count: 1, vehicle_ids: [] });
    fireEvent.click(screen.getByTestId('group-expand-toggle'));
    expect(screen.getByText('Tire pressure low')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('formats all group counts using the saved locale and neutral semantic chrome', () => {
    setGlobalLocale('de-DE');
    renderRow({
      group_key: VALID_GROUP_KEY, latest: makeLog({}), count: 1235,
      unread_count: 1234, vehicle_ids: Array.from({ length: 1234 }, (_, i) => i),
    });
    expect(screen.getByTestId('group-expand-toggle')).toHaveTextContent('+1.234 similar');
    expect(screen.getByTestId('group-expand-toggle')).toHaveAccessibleName('Show 1.234 similar');
    expect(screen.getByTestId('group-unread-count')).toHaveTextContent('1.234');
    expect(screen.getByTestId('group-unread-count')).toHaveTextContent('1.234 unread thread members');
    expect(screen.getByTestId('group-vehicle-count')).toHaveTextContent('1.234 vehicles affected');
    expect(screen.getByTestId('group-expand-toggle').className).not.toMatch(/cyan|neon|white\//);
    expect(screen.getByTestId('group-unread-count').className).not.toMatch(/amber|neon|white\//);
    act(() => setGlobalLocale('en-US'));
    expect(screen.getByTestId('group-expand-toggle')).toHaveTextContent('+1,234 similar');
  });
});

describe('real group-member hook contract in the granted row fixture', () => {
  // Block body: an implicit return would register the mock itself as a
  // Vitest hook cleanup and invoke request() with zero arguments.
  beforeEach(() => { requestMock.mockReset(); });

  async function renderMembers(filters: NotificationFilters = {}, enabled = true) {
    const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>('@/api/hooks/useNotifications');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ...renderHook(() => actual.useGroupMembers(VALID_GROUP_KEY, filters, { enabled }), { wrapper }) };
  }

  it('drops inherited thread pagination while preserving every filter, both bounds and cancellation', async () => {
    requestMock.mockResolvedValue([]);
    const filters: NotificationFilters = {
      limit: 50, offset: 150, severity: ['warn', 'critical'], vehicle_id: [1, 2],
      rule_id: [10, 11], source: 'rule', from: '2026-10-01T00:00:00Z',
      to_exclusive: '2026-10-02T00:00:00Z', read: false, archived: true, q: 'tire pressure',
      group_key: 'b'.repeat(64),
    };
    const { result } = await renderMembers(filters);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [path, options] = requestMock.mock.calls[0]!;
    const url = new URL(path, 'https://fixture.invalid');
    expect(url.pathname).toBe('/notifications/logs');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '1000', offset: '0', group_key: VALID_GROUP_KEY,
      severity: 'warn,critical', vehicle_id: '1,2', rule_id: '10,11', source: 'rule',
      from: filters.from, to_exclusive: filters.to_exclusive, read: 'false', archived: 'true', q: 'tire pressure',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(filters).toMatchObject({ limit: 50, offset: 150, group_key: 'b'.repeat(64) });
  });

  it('reads beyond a full server member page with the established created_at/id cursor', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => makeLog({ id: 2000 - i, created_at: TWO_HOURS_AGO }));
    const last = page[999]!;
    const tail = makeLog({ id: 1000, created_at: THREE_HOURS_AGO });
    requestMock.mockResolvedValueOnce(page).mockResolvedValueOnce([tail]);
    const { result } = await renderMembers({ limit: 1, offset: 900 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1001);
    expect(result.current.data?.[1000]).toEqual(tail);
    const second = new URL(requestMock.mock.calls[1]![0], 'https://fixture.invalid');
    expect(second.searchParams.get('before_created_at')).toBe(last.created_at);
    expect(second.searchParams.get('before_id')).toBe(String(last.id));
    expect(second.searchParams.get('offset')).toBe('0');
    expect(requestMock.mock.calls[1]![1].signal).toBe(requestMock.mock.calls[0]![1].signal);
  });

  it('retains the previous complete array when a later refresh member page fails', async () => {
    const sibling = makeLog({ id: 301 });
    requestMock.mockResolvedValueOnce([sibling]);
    const { result } = await renderMembers();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    requestMock.mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => makeLog({ id: 2000 - i })));
    requestMock.mockRejectedValueOnce(new Error('second page unavailable'));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'second page unavailable' });
    expect(result.current.data).toEqual([sibling]);
  });

  it('rejects non-array responses instead of advertising authoritative empty', async () => {
    requestMock.mockResolvedValue(null);
    const { result } = await renderMembers();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('rejects a non-advancing member cursor rather than looping', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => makeLog({ id: 2000 - i }));
    requestMock.mockResolvedValue(page);
    const { result } = await renderMembers();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBeUndefined();
  });

  it('does not request members while the group is collapsed', async () => {
    const { result } = await renderMembers({}, false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('isolates complete member results from paginated flat-list cache entries', async () => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>('@/api/hooks/useNotifications');
    const sibling = makeLog({ id: 301 });
    requestMock.mockResolvedValue([sibling]);
    const { client, result } = await renderMembers({ limit: 50, offset: 100 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const flatKey = actual.notificationKeys.logsFiltered({
      group_key: VALID_GROUP_KEY, limit: 1000, offset: 0,
    });
    expect(client.getQueryData(flatKey)).toBeUndefined();
    expect(client.getQueryData(actual.notificationKeys.groupMembers({
      group_key: VALID_GROUP_KEY, limit: 1000, offset: 0,
    }))).toEqual([sibling]);
  });

  it('aborts the current member request when its observer unmounts', async () => {
    requestMock.mockImplementation((_path: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      }));
    const { unmount } = await renderMembers();
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const signal = requestMock.mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
