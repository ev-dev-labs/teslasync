/**
 * ChannelsPage — comprehensive orchestration coverage.
 *
 * ChannelsPage is a pure composition/orchestration surface: it fans two
 * notification queries out to four presentational children and owns the
 * create/edit modal state machine. These tests pin THAT logic — the parts
 * that actually live in this file — while the heavy children
 * (ChannelStatsBand / ChannelsGrid / ChannelProvidersPanel /
 * ChannelFormModal / BrowserPushChannelCard) are replaced with tiny doubles
 * that echo the props they receive and expose the callbacks they are handed.
 *
 * Coverage facets:
 *   1. Structure — title/subtitle, all four surfaces, and the channel-count
 *      badge threshold (shown iff channels exist).
 *   2. Prop wiring — the configured channels reach the grid + providers panel;
 *      stats + loading flags reach the stats band.
 *   3. loading / error / empty — the surface is never blank, the grid gets the
 *      error object, and retry is wired to refetch.
 *   4. Modal state machine — closed by default; add-from-header and
 *      add-from-grid both open in create mode; edit opens in edit mode for the
 *      chosen channel; onClose / onSaved both dismiss; and the editing target
 *      is reset when switching from edit back to add.
 *   5. Header actions & a11y — refresh fans out to BOTH refetches, and the
 *      icon-only refresh / add controls carry accessible names.
 *
 * The two page hooks are replaced with controllable doubles; the network is
 * never touched. The real PageContainer is rendered so the header actions,
 * copy-link, and freshness chip are exercised end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { NotificationChannel, NotificationStats } from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';
import { Button } from '@/components/ui';
import ChannelsPage from './ChannelsPage';

// <FadeIn> → framer-motion's useReducedMotion reads matchMedia, which jsdom
// does not implement. Install a minimal stub before any consuming module runs.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
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

// Query result shapes, pulled from the real hooks so the doubles stay in sync
// with any future signature change.
type ChannelsQuery = ReturnType<
  typeof import('@/api/hooks/useNotifications')['useNotificationChannels']
>;
type StatsQuery = ReturnType<typeof import('@/api/hooks/useNotifications')['useNotificationStats']>;

// Shared, hoisted doubles so the mock factories and the specs reach the same
// instances.
const H = vi.hoisted(() => ({
  channels: { current: null as unknown as ChannelsQuery },
  stats: { current: null as unknown as StatsQuery },
  channelsRefetch: vi.fn(),
  statsRefetch: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating {{vars}}. Supports
// both the `t(key, 'Default', { vars })` and `t(key, { defaultValue })` styles.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    let template = key;
    let vars: Record<string, unknown> | undefined;
    if (typeof second === 'string') {
      template = second;
      if (third && typeof third === 'object') vars = third as Record<string, unknown>;
    } else if (second && typeof second === 'object') {
      vars = second as Record<string, unknown>;
      if (typeof (second as { defaultValue?: unknown }).defaultValue === 'string') {
        template = (second as { defaultValue: string }).defaultValue;
      }
    }
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars! ? String(vars![name]) : `{{${name}}}`,
    );
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return {
    ...actual,
    useNotificationChannels: () => H.channels.current,
    useNotificationStats: () => H.stats.current,
  };
});

// ── Child doubles — echo received props, surface the callbacks ────────────────
vi.mock('../components/channels/ChannelStatsBand', () => ({
  ChannelStatsBand: function ChannelStatsBandMock({
    stats,
    isLoading,
  }: {
    stats?: NotificationStats;
    isLoading: boolean;
  }) {
    return (
      <div data-testid="stats-band" data-loading={String(isLoading)}>
        {stats ? `sent:${stats.sent}` : 'no-stats'}
      </div>
    );
  },
}));

vi.mock('../components/channels/ChannelsGrid', () => ({
  ChannelsGrid: function ChannelsGridMock(props: {
    channels: NotificationChannel[];
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    onRetry: () => void;
    onEdit: (channel: NotificationChannel) => void;
    onAdd: () => void;
  }) {
    const { channels, isLoading, isError, error, onRetry, onEdit, onAdd } = props;
    const errMsg = error instanceof Error ? error.message : error ? String(error) : '';
    return (
      <div
        data-testid="channels-grid"
        data-loading={String(isLoading)}
        data-error={String(isError)}
        data-errmsg={errMsg}
        data-count={String(channels.length)}
      >
        <button type="button" onClick={onAdd}>
          grid-add
        </button>
        <button type="button" onClick={onRetry}>
          grid-retry
        </button>
        {channels.map((c) => (
          <button type="button" key={c.id} onClick={() => onEdit(c)}>
            edit-{c.name}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('../components/channels/ChannelProvidersPanel', () => ({
  ChannelProvidersPanel: function ChannelProvidersPanelMock({
    channels,
  }: {
    channels: NotificationChannel[];
  }) {
    return <div data-testid="providers-panel" data-count={String(channels.length)} />;
  },
}));

vi.mock('../components/channels/HealthAlertPreferencesPanel', () => ({
  HealthAlertPreferencesPanel: function HealthAlertPreferencesPanelMock({
    channels,
    onAddChannel,
  }: {
    channels: NotificationChannel[];
    onAddChannel: () => void;
  }) {
    return (
      <div data-testid="health-alert-preferences" data-count={String(channels.length)}>
        <Button onClick={onAddChannel}>health-add</Button>
      </div>
    );
  },
}));

vi.mock('../components/BrowserPushChannelCard', () => ({
  BrowserPushChannelCard: function BrowserPushChannelCardMock({
    className,
  }: {
    className?: string;
  }) {
    return <div data-testid="browser-push" data-classname={className ?? ''} />;
  },
}));

vi.mock('../components/channels/ChannelFormModal', () => ({
  ChannelFormModal: function ChannelFormModalMock({
    channel,
    onClose,
    onSaved,
  }: {
    channel: NotificationChannel | null;
    onClose: () => void;
    onSaved: () => void;
  }) {
    return (
      <div role="dialog" aria-label="Channel form">
        <span data-testid="modal-mode">{channel ? `edit:${channel.name}` : 'add'}</span>
        <button type="button" onClick={onClose}>
          modal-close
        </button>
        <button type="button" onClick={onSaved}>
          modal-save
        </button>
      </div>
    );
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const DISCORD: NotificationChannel = {
  id: 1,
  name: 'Team Discord',
  kind: 'discord',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  webhook_url: 'https://discord.com/api/webhooks/abc',
  username: null,
  avatar_url: null,
};

const SLACK: NotificationChannel = {
  id: 2,
  name: 'Ops Slack',
  kind: 'slack',
  enabled: false,
  created_at: '2024-01-02T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  webhook_url: 'https://hooks.slack.com/services/xyz',
  channel: null,
  username: null,
};

const STATS: NotificationStats = {
  total_sent: 100,
  sent: 95,
  failed: 3,
  pending: 2,
  total_channels: 2,
  enabled_channels: 1,
};

interface FakeQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isStale: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

function makeChannelsQuery(overrides: Partial<FakeQuery<NotificationChannel[]>> = {}): ChannelsQuery {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: H.channelsRefetch,
    ...overrides,
  } as unknown as ChannelsQuery;
}

function makeStatsQuery(overrides: Partial<FakeQuery<NotificationStats>> = {}): StatsQuery {
  return {
    data: STATS,
    isLoading: false,
    isError: false,
    error: null,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: H.statsRefetch,
    ...overrides,
  } as unknown as StatsQuery;
}

function setChannels(overrides: Partial<FakeQuery<NotificationChannel[]>>) {
  H.channels.current = makeChannelsQuery(overrides);
}

function setStats(overrides: Partial<FakeQuery<NotificationStats>>) {
  H.stats.current = makeStatsQuery(overrides);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/notifications/channels']}>
          <ChannelsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The page's Refresh/Add cluster — scoped so the freshness-chip's own
 * "Refresh" affordance (a sibling `role="button"` span) is never matched. */
function actionsCluster(): HTMLElement {
  return screen.getByRole('button', { name: 'Add Channel' }).parentElement as HTMLElement;
}

beforeEach(() => {
  H.channelsRefetch.mockReset().mockResolvedValue(undefined);
  H.statsRefetch.mockReset().mockResolvedValue(undefined);
  setChannels({ data: [DISCORD, SLACK] });
  setStats({ data: STATS });
});

// ── 1. Structure & prop wiring ────────────────────────────────────────────────
describe('ChannelsPage — structure', () => {
  it('renders the page title, subtitle, and all five content surfaces', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Notification channels' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Where to send notifications/)).toBeInTheDocument();
    expect(screen.getByTestId('stats-band')).toBeInTheDocument();
    expect(screen.getByTestId('channels-grid')).toBeInTheDocument();
    expect(screen.getByTestId('providers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('browser-push')).toBeInTheDocument();
    expect(screen.getByTestId('health-alert-preferences')).toBeInTheDocument();
  });

  it('passes the configured channels to both the grid and the providers panel', () => {
    renderPage();
    expect(screen.getByTestId('channels-grid')).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('providers-panel')).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('health-alert-preferences')).toHaveAttribute('data-count', '2');
  });

  it('feeds the stats query and its loading flag into the stats band', () => {
    renderPage();
    const band = screen.getByTestId('stats-band');
    expect(band).toHaveTextContent('sent:95');
    expect(band).toHaveAttribute('data-loading', 'false');
  });

  it('shows the channel-count badge only when channels exist', () => {
    renderPage();
    const region = screen.getByRole('region', { name: 'Delivery channels' });
    expect(within(region).getByText('2')).toBeInTheDocument();
  });

  it('hides the count badge and reports zero when no channels are configured', () => {
    setChannels({ data: [] });
    renderPage();
    const region = screen.getByRole('region', { name: 'Delivery channels' });
    expect(within(region).queryByText('0')).toBeNull();
    expect(screen.getByTestId('channels-grid')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('providers-panel')).toHaveAttribute('data-count', '0');
  });
});

// ── 2. loading / error / empty ────────────────────────────────────────────────
describe('ChannelsPage — loading / error / empty', () => {
  it('propagates loading flags while keeping every section heading visible', () => {
    setChannels({ data: undefined, isLoading: true });
    setStats({ data: undefined, isLoading: true });
    renderPage();

    expect(screen.getByTestId('channels-grid')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('channels-grid')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('stats-band')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('stats-band')).toHaveTextContent('no-stats');
    // The surface is never blank — both section headings still render.
    expect(screen.getByRole('heading', { name: 'Delivery channels' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Devices & providers' })).toBeInTheDocument();
  });

  it('forwards the error to the grid and wires retry to the channels refetch', () => {
    const err = new Error('Network unreachable');
    setChannels({ data: undefined, isError: true, error: err });
    renderPage();

    const grid = screen.getByTestId('channels-grid');
    expect(grid).toHaveAttribute('data-error', 'true');
    expect(grid).toHaveAttribute('data-errmsg', 'Network unreachable');

    fireEvent.click(screen.getByRole('button', { name: 'grid-retry' }));
    expect(H.channelsRefetch).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Modal state machine ────────────────────────────────────────────────────
describe('ChannelsPage — create/edit modal', () => {
  it('does not render the form modal on first paint', () => {
    renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the modal in create mode from the header Add action', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('modal-mode')).toHaveTextContent('add');
  });

  it('opens the modal in create mode from the grid add callback', () => {
    setChannels({ data: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'grid-add' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('modal-mode')).toHaveTextContent('add');
  });

  it('opens the modal in edit mode for the specific channel chosen', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'edit-Ops Slack' }));
    expect(screen.getByTestId('modal-mode')).toHaveTextContent('edit:Ops Slack');
  });

  it('dismisses the modal when the child calls onClose', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'modal-close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses the modal when the child calls onSaved', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'modal-save' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears the editing target when switching from edit back to add', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'edit-Team Discord' }));
    expect(screen.getByTestId('modal-mode')).toHaveTextContent('edit:Team Discord');

    fireEvent.click(screen.getByRole('button', { name: 'modal-close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
    expect(screen.getByTestId('modal-mode')).toHaveTextContent('add');
  });
});

// ── 4. Header actions & accessibility ─────────────────────────────────────────
describe('ChannelsPage — header actions & a11y', () => {
  it('fans the refresh action out to both the channels and stats refetches', () => {
    renderPage();
    fireEvent.click(within(actionsCluster()).getByRole('button', { name: 'Refresh' }));
    expect(H.channelsRefetch).toHaveBeenCalledTimes(1);
    expect(H.statsRefetch).toHaveBeenCalledTimes(1);
  });

  it('gives the icon-only refresh control an accessible name', () => {
    renderPage();
    expect(within(actionsCluster()).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('labels the add-channel action', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Add Channel' })).toBeInTheDocument();
  });
});
