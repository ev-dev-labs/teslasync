import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import {
  CHECKLIST_CHANGED_EVENT,
  CHECKLIST_COMPLETED_AT_KEY,
  CHECKLIST_DISMISSED_KEY,
  CP_DISCOVERED_KEY,
  CUSTOMIZE_DASHBOARD_KEY,
} from '@/features/onboarding/checklist';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetSize } from './types';
import OnboardingChecklistWidget from './OnboardingChecklistWidget';

type PrerequisiteQuery = DataStateSource<{ id: number }[]> & { refetch: () => void };
const { queries, refresh } = vi.hoisted(() => ({
  queries: {
    vehicles: vi.fn<() => PrerequisiteQuery>(),
    rules: vi.fn<() => PrerequisiteQuery>(),
    channels: vi.fn<() => PrerequisiteQuery>(),
  },
  refresh: { vehicles: vi.fn(), rules: vi.fn(), channels: vi.fn() },
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => queries.vehicles() }));
vi.mock('@/api/hooks/useNotifications', () => ({
  useAlertRules: () => queries.rules(),
  useNotificationChannels: () => queries.channels(),
}));

const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const sizes = [
  { cols: 1, rows: 1 },
  { cols: 2, rows: 3 },
] as const satisfies readonly WidgetSize[];
const flagKeys = [
  CHECKLIST_DISMISSED_KEY, CHECKLIST_COMPLETED_AT_KEY,
  CP_DISCOVERED_KEY, CUSTOMIZE_DASHBOARD_KEY,
];
const taskTitles = [
  'Connect your Tesla', 'Pick a theme', 'Create your first alert rule',
  'Add a notification channel', 'Try the command palette',
  'Enable web push notifications', 'Customize your dashboard',
];

function query(refetch: () => void, overrides: Partial<PrerequisiteQuery> = {}): PrerequisiteQuery {
  return {
    data: [], dataUpdatedAt: Date.now(), isPending: false, isLoading: false,
    isFetching: false, isError: false, isStale: false, error: null,
    fetchStatus: 'idle', refetch, ...overrides,
  };
}

function LocationEvidence() {
  const { pathname, hash } = useLocation();
  return <output data-testid="checklist-location">{pathname}{hash}</output>;
}

function renderWidget(packId: string, size: WidgetSize = sizes[1]) {
  const tree = (requestedPackId: string) => (
    <MemoryRouter initialEntries={['/dashboard']}>
      <PackBoundary requestedPackId={requestedPackId}>
        <OnboardingChecklistWidget size={size} />
      </PackBoundary>
      <LocationEvidence />
    </MemoryRouter>
  );
  const result = render(tree(packId));
  return { ...result, selectPack: (id: string) => result.rerender(tree(id)) };
}

async function presentation(container: HTMLElement, appearance: string) {
  const selector = `[data-widget-family="empty"][data-widget-appearance="${appearance}"]`;
  await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
  return within(container.querySelector<HTMLElement>(selector)!);
}

beforeEach(() => {
  vi.clearAllMocks();
  flagKeys.forEach(key => localStorage.removeItem(key));
  vi.stubGlobal('Notification', undefined);
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  queries.vehicles.mockReturnValue(query(refresh.vehicles, { data: [{ id: 7 }] }));
  queries.rules.mockReturnValue(query(refresh.rules));
  queries.channels.mockReturnValue(query(refresh.channels));
});

afterEach(() => {
  cleanup();
  flagKeys.forEach(key => localStorage.removeItem(key));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(packs)('Setup checklist %s (%s)', (packId, appearance) => {
  it.each(sizes)('preserves the hidden state and real restart, navigation and dismiss actions at $cols × $rows', async size => {
    localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1');
    const { container } = renderWidget(packId, size);
    const hidden = await presentation(container, appearance);
    expect(hidden.getByText('Setup checklist hidden')).toBeInTheDocument();
    expect(hidden.getByText(/Remove this widget from your dashboard or restart/)).toBeInTheDocument();
    expect(hidden.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(hidden.queryByRole('meter')).not.toBeInTheDocument();
    expect(hidden.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
    expect(container.querySelector('.lucide-sparkles')).not.toBeNull();

    fireEvent.click(hidden.getByRole('button', { name: 'Restart checklist' }));
    const active = await presentation(container, appearance);
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBeNull();
    expect(active.getByText('1 of 7 done')).toBeInTheDocument();
    taskTitles.forEach(title => expect(active.getByText(title)).toBeInTheDocument());
    expect(within(active.getByTestId('onboarding-checklist')).getAllByRole('listitem')).toHaveLength(7);
    expect(active.getByTestId('checklist-task-connect-vehicle')).toHaveAttribute('data-complete', 'true');
    expect(active.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    const progress = active.getByRole(packId === 'v7' ? 'meter' : 'progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '7');
    expect(container.querySelector('.lucide-rocket')).not.toBeNull();

    fireEvent.click(active.getByRole('button', { name: 'Create' }));
    expect(screen.getByTestId('checklist-location')).toHaveTextContent('/notifications/inbox');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBe('1');
    expect(screen.getByText('Setup checklist hidden')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
  });

  it('keeps unresolved and failed prerequisites unknown without hiding local tasks or their navigation', async () => {
    queries.vehicles.mockReturnValue(query(refresh.vehicles, { data: undefined, dataUpdatedAt: 0, isPending: true }));
    queries.rules.mockReturnValue(query(refresh.rules, {
      data: undefined, dataUpdatedAt: 0, isError: true, error: new Error('Rules unavailable'),
    }));
    queries.channels.mockReturnValue(query(refresh.channels, {
      data: undefined, dataUpdatedAt: 0, fetchStatus: 'paused',
    }));
    const { container } = renderWidget(packId);
    const view = await presentation(container, appearance);
    expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(view.getAllByText('Unknown')).toHaveLength(3);
    taskTitles.forEach(title => expect(view.getByText(title)).toBeInTheDocument());
    for (const id of ['connect-vehicle', 'first-alert', 'notification-channel']) {
      expect(view.getByTestId(`checklist-task-${id}`)).toHaveAttribute('data-complete', 'false');
    }
    fireEvent.click(view.getByRole('button', { name: 'Connect' }));
    expect(screen.getByTestId('checklist-location')).toHaveTextContent('/tesla-account');
  });
});

it('retains Classic and unknown-pack recovery with the original meter, rows, hidden footprint and restart', () => {
  const { container, selectPack } = renderWidget('classic');
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.getByText('1 of 7 done')).toBeInTheDocument();
  const progress = screen.getByRole('progressbar');
  expect(progress).toHaveAttribute('aria-valuenow', '1');
  expect((progress.firstElementChild as HTMLElement).style.width).toBe('14%');
  taskTitles.forEach(title => expect(screen.getByText(title)).toBeInTheDocument());
  selectPack('retired-checklist-pack');
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.getByText('Setup checklist hidden')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restart checklist' }));
  expect(screen.getByText('1 of 7 done')).toBeInTheDocument();
});

it('switches all seven packs on one real checklist subscription and preserves palette and refresh actions', async () => {
  const subscriptions = vi.spyOn(window, 'addEventListener');
  const palette = vi.fn();
  window.addEventListener('toggle-command-palette', palette);
  const { container, selectPack } = renderWidget('classic');
  const refreshControl = screen.getByRole('button', { name: /^Refresh data/i });
  refreshControl.focus();
  for (const [packId, appearance] of packs) {
    selectPack(packId);
    const view = await presentation(container, appearance);
    expect(view.getByText('1 of 7 done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toBe(refreshControl);
    expect(refreshControl).toHaveFocus();
  }
  expect(subscriptions.mock.calls.filter(([name]) => name === CHECKLIST_CHANGED_EVENT)).toHaveLength(1);
  fireEvent.click(within(screen.getByTestId('checklist-task-try-command-palette')).getByRole('button', { name: 'Open' }));
  expect(palette).toHaveBeenCalledOnce();
  expect(screen.getByTestId('checklist-location')).toHaveTextContent('/dashboard');
  fireEvent.click(refreshControl);
  Object.values(refresh).forEach(refetch => expect(refetch).toHaveBeenCalledOnce());
  selectPack('classic');
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.getByText('1 of 7 done')).toBeInTheDocument();
  window.removeEventListener('toggle-command-palette', palette);
});

it('retains completed remote evidence and recovery after refresh failures', async () => {
  const oldest = Date.now() - 60_000;
  queries.vehicles.mockReturnValue(query(refresh.vehicles, {
    data: [{ id: 7 }], dataUpdatedAt: oldest, isError: true, error: new Error('Refresh failed'),
  }));
  queries.rules.mockReturnValue(query(refresh.rules, { data: [{ id: 3 }], dataUpdatedAt: oldest + 10_000 }));
  const { container } = renderWidget('v6');
  const view = await presentation(container, 'expressive');
  expect(view.getByText('2 of 7 done')).toBeInTheDocument();
  expect(view.getByTestId('checklist-task-connect-vehicle')).toHaveAttribute('data-complete', 'true');
  expect(view.getByTestId('checklist-task-first-alert')).toHaveAttribute('data-complete', 'true');
  expect(view.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  expect(view.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
  Object.values(refresh).forEach(refetch => expect(refetch).toHaveBeenCalledOnce());
});

it('distinguishes confirmed empty configuration from unknown prerequisites and never claims setup is complete', async () => {
  queries.vehicles.mockReturnValue(query(refresh.vehicles));
  const { container } = renderWidget('v4');
  const view = await presentation(container, 'owner');
  expect(view.getByText('0 of 7 done')).toBeInTheDocument();
  expect(view.queryByText('Unknown')).not.toBeInTheDocument();
  expect(view.queryByText("You're all set! 🎉")).not.toBeInTheDocument();
  expect(view.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  expect(view.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});
