import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';

import NotificationsPage from './NotificationsPage';
import type { NotificationLog, AlertRule } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';

// Stub framer-motion so FadeIn renders eagerly.
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

const VEHICLES: Vehicle[] = [
  {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-A',
    display_name: 'Roadster',
    model: 'roadster',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  },
];

const RULES: AlertRule[] = [
  {
    id: 10,
    name: 'Battery Low',
    enabled: true,
    severity: 'warn',
    vehicle_id: 1,
    signal: 'battery_level',
    operator: '<',
    value: 20,
    cooldown_seconds: 0,
    notification_channels: [],
    created_at: '',
    updated_at: '',
  } as unknown as AlertRule,
];

const NOW = new Date();
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();

const LOGS: NotificationLog[] = [
  {
    id: 100,
    alert_id: 10,
    channel_id: 1,
    status: 'sent',
    message: 'Battery dropped below 20%',
    metadata: null,
    sent_at: ONE_HOUR_AGO,
    created_at: ONE_HOUR_AGO,
    read_at: null,
    archived_at: null,
  } as unknown as NotificationLog,
];

const markReadMutate = vi.fn();
const archiveMutate = vi.fn();
const unarchiveMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: VEHICLES }),
}));

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return {
    ...actual,
    useAlertRules: () => ({ data: RULES }),
    useNotificationLogs: (filters: { archived?: boolean }) => ({
      data: filters?.archived ? [] : LOGS,
      isLoading: false,
      error: null,
    }),
    useMarkNotificationsRead: () => ({ mutate: markReadMutate, isPending: false }),
    useMarkNotificationsUnread: () => ({ mutate: vi.fn(), isPending: false }),
    useArchiveNotifications: () => ({ mutate: archiveMutate, isPending: false }),
    useUnarchiveNotifications: () => ({ mutate: unarchiveMutate, isPending: false }),
    useDeleteNotifications: () => ({ mutate: deleteMutate, isPending: false }),
    useNotificationChannels: () => ({ data: [] }),
    useNotificationStats: () => ({ data: { total_sent: 0, total_failed: 0, total_pending: 0, active_channels: 0 } }),
    useTestChannel: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
    useToggleChannel: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteChannel: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveChannel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications']}>
        <SelectedVehicleProvider>
          <NotificationsPage />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    markReadMutate.mockReset();
    archiveMutate.mockReset();
    unarchiveMutate.mockReset();
    deleteMutate.mockReset();
    window.localStorage.clear();
  });

  it('renders the three tabs (Inbox, Archived, Channels)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archived/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Channels/i })).toBeInTheDocument();
  });

  it('renders inbox rows by default with the alert message visible', () => {
    renderPage();
    expect(screen.getByText(/Battery dropped below 20%/i)).toBeInTheDocument();
  });

  it('auto-marks unread visible rows as read on mount when prefs allow', async () => {
    renderPage();
    await waitFor(() => expect(markReadMutate).toHaveBeenCalledTimes(1));
    expect(markReadMutate).toHaveBeenCalledWith([100]);
  });

  it('does not auto-mark when the user opted out via localStorage', async () => {
    window.localStorage.setItem('teslasync.notifications.markOnOpen', 'false');
    renderPage();
    // Give effects a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(markReadMutate).not.toHaveBeenCalled();
  });

  it('switches to the Archived tab and shows the empty state', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Archived/i }));
    await waitFor(() =>
      expect(screen.getByText(/No archived notifications/i)).toBeInTheDocument(),
    );
  });

  it('selects all visible rows and exposes the bulk Archive action', async () => {
    renderPage();
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is the "select all visible" header checkbox.
    fireEvent.click(checkboxes[0]);
    // The bulk bar appears as a region containing "1 selected" plus the bulk
    // action buttons. Wait for it, then scope the Archive lookup to that bar
    // (the per-row Archive button uses aria-label, the bulk bar uses text).
    const bulkBar = await screen.findByText(/1 selected/i);
    const archiveBtn = Array.from(
      bulkBar.parentElement?.querySelectorAll('button') ?? [],
    ).find((b) => b.textContent?.trim() === 'Archive');
    expect(archiveBtn).toBeTruthy();
    fireEvent.click(archiveBtn!);
    await waitFor(() => expect(archiveMutate).toHaveBeenCalledTimes(1));
    const ids = (archiveMutate.mock.calls[0] as [number[]])[0];
    expect(ids).toContain(100);
  });
});
