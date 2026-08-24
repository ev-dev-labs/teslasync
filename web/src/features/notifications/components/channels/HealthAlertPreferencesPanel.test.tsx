import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  mutate: vi.fn(),
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
  hooks.mutate.mockReset();
  hooks.eventRefetch.mockReset();
  hooks.preferenceRefetch.mockReset();
  hooks.eventTypes.mockReset().mockReturnValue(eventQuery());
  hooks.preferences.mockReset().mockReturnValue(preferenceQuery());
  hooks.update.mockReset().mockReturnValue({ mutate: hooks.mutate });
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

  it('updates the selected channel with the stable snake_case event type', () => {
    renderPanel([CHANNEL]);

    fireEvent.click(screen.getByRole('switch', { name: 'Fleet Telemetry outage' }));
    expect(hooks.mutate).toHaveBeenCalledWith({
      channel_id: 7,
      event_type: 'system.telemetry.outage',
      enabled: false,
    });
  });
});
