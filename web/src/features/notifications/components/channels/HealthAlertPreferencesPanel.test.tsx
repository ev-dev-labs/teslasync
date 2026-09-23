import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type {
  NotificationChannel,
  NotificationEventType,
  NotificationPreference,
} from '@/api/types';
import { HealthAlertPreferencesPanel } from './HealthAlertPreferencesPanel';

const hooks = vi.hoisted(() => ({
  eventTypes: vi.fn(),
  preferences: vi.fn(),
  update: vi.fn(),
  mutateAsync: vi.fn(),
  eventRefetch: vi.fn(),
  preferenceRefetch: vi.fn(),
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationEventTypes: () => hooks.eventTypes(),
  useNotificationPreferences: (channelId: number | null) => hooks.preferences(channelId),
  useUpdateNotificationPreference: () => hooks.update(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      Object.entries(vars ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

const CHANNEL: NotificationChannel = {
  id: 7,
  name: 'Ops Discord',
  kind: 'discord',
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  webhook_url: 'https://discord.example/webhook',
  username: null,
  avatar_url: null,
};

const EVENTS: NotificationEventType[] = [
  {
    event_type: 'system.telemetry.outage',
    component: 'telemetry',
    transition: 'outage',
    default_enabled: true,
    description: 'Telemetry stopped.',
  },
  {
    event_type: 'system.telemetry.recovery',
    component: 'telemetry',
    transition: 'recovery',
    default_enabled: false,
    description: 'Telemetry recovered.',
  },
  {
    event_type: 'system.database.outage',
    component: 'database',
    transition: 'outage',
    default_enabled: true,
    description: 'Database stopped.',
  },
];

interface QueryState<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
}

function eventQuery(overrides: Partial<QueryState<NotificationEventType[]>> = {}) {
  return {
    data: EVENTS,
    isLoading: false,
    isError: false,
    error: null,
    refetch: hooks.eventRefetch,
    ...overrides,
  };
}

function preferenceQuery(overrides: Partial<QueryState<NotificationPreference[]>> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: hooks.preferenceRefetch,
    ...overrides,
  };
}

function renderPanel(channels: NotificationChannel[], onAddChannel = vi.fn()) {
  return render(
    <MemoryRouter>
      <HealthAlertPreferencesPanel channels={channels} onAddChannel={onAddChannel} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  hooks.mutateAsync.mockReset().mockResolvedValue(undefined);
  hooks.eventRefetch.mockReset();
  hooks.preferenceRefetch.mockReset();
  hooks.eventTypes.mockReset().mockReturnValue(eventQuery());
  hooks.preferences.mockReset().mockReturnValue(preferenceQuery());
  hooks.update.mockReset().mockReturnValue({ mutateAsync: hooks.mutateAsync });
});

describe('HealthAlertPreferencesPanel', () => {
  it('shows an actionable empty state when no delivery channel exists', () => {
    const onAdd = vi.fn();
    renderPanel([], onAdd);

    expect(screen.getByText('Add a delivery channel first')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add notification channel' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(hooks.preferences).toHaveBeenCalledWith(null);
  });

  it('shows loading placeholders while the catalog or preferences load', () => {
    hooks.eventTypes.mockReturnValue(eventQuery({ data: undefined, isLoading: true }));
    renderPanel([CHANNEL]);

    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('surfaces query failures and retries both data sources', () => {
    hooks.eventTypes.mockReturnValue(eventQuery({
      isError: true,
      error: new Error('catalog unavailable'),
    }));
    renderPanel([CHANNEL]);

    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(hooks.eventRefetch).toHaveBeenCalledTimes(1);
    expect(hooks.preferenceRefetch).toHaveBeenCalledTimes(1);
  });

  it('uses catalog defaults only when no explicit preference exists', () => {
    hooks.preferences.mockReturnValue(preferenceQuery({
      data: [{
        id: 1,
        channel_id: 7,
        event_type: 'system.telemetry.outage',
        enabled: false,
      }],
    }));
    renderPanel([CHANNEL]);

    expect(screen.getByRole('switch', { name: 'Fleet Telemetry outage' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Fleet Telemetry recovery' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Database outage' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('updates the selected channel with the stable snake_case event type', async () => {
    renderPanel([CHANNEL]);

    fireEvent.click(screen.getByRole('switch', { name: 'Fleet Telemetry outage' }));
    expect(hooks.mutateAsync).toHaveBeenCalledWith({
      channel_id: 7,
      event_type: 'system.telemetry.outage',
      enabled: false,
    });
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  });

  it('scopes settings and counts to the chosen channel', async () => {
    const disabledChannel = { ...CHANNEL, id: 8, name: 'Disabled Slack', enabled: false };
    hooks.preferences.mockImplementation((channelId: number) => preferenceQuery({
      data: channelId === 8
        ? [{ id: 2, channel_id: 8, event_type: 'system.database.outage', enabled: false }]
        : [],
    }));
    renderPanel([CHANNEL, disabledChannel]);
    fireEvent.change(screen.getByLabelText('Delivery channel'), { target: { value: '8' } });

    expect(hooks.preferences).toHaveBeenLastCalledWith(8);
    expect(screen.getByText(/this channel is disabled/i)).toBeInTheDocument();
    expect(screen.getByText('1 of 3 events enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Database outage' }));
    expect(hooks.mutateAsync).toHaveBeenCalledWith({
      channel_id: 8, event_type: 'system.database.outage', enabled: true,
    });
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  });

  it('filters the live catalog without changing stored preferences', async () => {
    renderPanel([CHANNEL]);
    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'Database' } });
    expect(screen.getByRole('region', { name: 'Component health alerts' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Component health alerts' })
      .querySelectorAll('section[aria-label="Database"]')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Fleet Telemetry outage' })).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'disabled' } });
    expect(screen.getByText('No components match your search or filter.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('switch', { name: 'Fleet Telemetry outage' })).toBeInTheDocument();
    expect(hooks.mutateAsync).not.toHaveBeenCalled();
  });

  it('prevents duplicate writes while saving and shows a retryable failure', async () => {
    let rejectSave: (error: Error) => void = () => {};
    hooks.mutateAsync.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));
    renderPanel([CHANNEL]);
    fireEvent.click(screen.getByRole('switch', { name: 'Fleet Telemetry outage' }));
    expect(screen.getByRole('switch', { name: 'Fleet Telemetry outage' })).toBeDisabled();
    expect(screen.getByLabelText('Delivery channel')).toBeDisabled();
    rejectSave(new Error('connection lost'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this choice');
    expect(screen.getByRole('switch', { name: 'Fleet Telemetry outage' })).not.toBeDisabled();
    expect(hooks.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
