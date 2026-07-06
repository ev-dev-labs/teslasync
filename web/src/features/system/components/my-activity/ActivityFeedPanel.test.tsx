// ActivityFeedPanel unit tests.
//
// ActivityFeedPanel is the full-width detail band on MyActivityPage. It wraps
// the shared RecentActivityFeed timeline in a titled GlassPanel and owns three
// mutually-exclusive branches: loading, error, and content (the content branch
// delegates its own empty state to RecentActivityFeed).
//
// Facets covered:
//   1. Title + panel chrome always render (heading role, decorative icon).
//   2. Loading branch exposes an accessible busy status + the skeleton
//      placeholders, and suppresses the feed.
//   3. Empty content branch surfaces the friendly empty message.
//   4. Populated content branch renders each entry, including a click-through
//      link for entries that map to a routable entity.
//   5. Null / undefined `entries` fall back to the empty state (null safety).
//   6. Error branch renders QueryError with a working Retry that invokes the
//      onRetry callback.
//   7. Hardening: `isError` with a missing error object still renders an error
//      region + Retry (never a blank panel body).
//   8. Branch precedence: loading wins over error and content.
//   9. `className` is forwarded to the outer panel.

import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// Deterministic i18n: return the English fallback so assertions read the copy
// users actually see. importActual preserves every other react-i18next export
// (Trans, initReactI18next, …) that transitive components might touch.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
    }),
  };
});

import { ActivityFeedPanel, type ActivityFeedPanelProps } from './ActivityFeedPanel';
import type { UserActivityEntry } from '@/types/admin';

function makeEntry(overrides: Partial<UserActivityEntry> = {}): UserActivityEntry {
  return {
    id: 1,
    ts: new Date().toISOString(),
    action: 'auth.login',
    entity_type: null,
    entity_id: null,
    detail: null,
    ip: null,
    user_agent: null,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<ActivityFeedPanelProps> = {}) {
  const props: ActivityFeedPanelProps = {
    entries: [],
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <ActivityFeedPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

describe('ActivityFeedPanel', () => {
  it('renders the panel heading with its decorative icon and the empty message', () => {
    renderPanel({ entries: [] });

    const heading = screen.getByRole('heading', { level: 3, name: 'Activity feed' });
    expect(heading).toBeInTheDocument();
    // The leading history glyph is decorative and stays out of the a11y tree.
    expect(heading.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('No recent activity in this window.')).toBeInTheDocument();
  });

  it('shows an accessible busy status with skeleton placeholders while loading', () => {
    renderPanel({ isLoading: true });

    const status = screen.getByRole('status', { name: 'Loading activity feed' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    // Six skeleton rows stand in for the pending feed.
    expect(status.querySelectorAll('.animate-pulse')).toHaveLength(6);
    // The feed itself (and its empty copy) must not render underneath.
    expect(screen.queryByText('No recent activity in this window.')).toBeNull();
  });

  it('renders each entry, with a click-through link for routable entities', () => {
    renderPanel({
      entries: [
        makeEntry({ id: 1, action: 'auth.login' }),
        makeEntry({
          id: 2,
          action: 'vehicle.command.wake',
          entity_type: 'vehicle',
          entity_id: '7',
          detail: 'woke up',
        }),
      ],
    });

    // Plain (non-routable) entry renders its translated label as text.
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    // Routable entry renders a link to the entity detail route.
    const link = screen.getByRole('link', { name: 'Wake vehicle' });
    expect(link).toHaveAttribute('href', '/vehicles/7');
    // Content branch — the empty placeholder is gone.
    expect(screen.queryByText('No recent activity in this window.')).toBeNull();
  });

  it('falls back to the empty state when entries is undefined (null safety)', () => {
    // The prop is typed as an array, but real callers can hand us undefined
    // before the query resolves — this must not throw on `.map`/`.length`.
    renderPanel({ entries: undefined as unknown as UserActivityEntry[] });

    expect(screen.getByText('No recent activity in this window.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Activity feed' })).toBeInTheDocument();
  });

  it('renders an error region and calls onRetry when the user clicks Retry', () => {
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: new Error('network down'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Error branch replaces the feed, so the empty copy is absent.
    expect(screen.queryByText('No recent activity in this window.')).toBeNull();
  });

  it('never renders a blank body when isError is set without an error object', () => {
    // Regression guard: QueryError returns null for a falsy error, which would
    // otherwise leave the panel empty below the title. The panel synthesises a
    // fallback error so the failure branch always shows something actionable.
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: undefined, onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the loading branch over error and content', () => {
    renderPanel({
      isLoading: true,
      isError: true,
      error: new Error('ignored while loading'),
      entries: [makeEntry({ action: 'auth.login' })],
    });

    expect(screen.getByRole('status', { name: 'Loading activity feed' })).toBeInTheDocument();
    // Neither the error CTA nor the feed content leak through.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText('Signed in')).toBeNull();
  });

  it('forwards a custom className to the outer glass panel', () => {
    const { container } = renderPanel({ className: 'custom-feed-panel' });

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('custom-feed-panel');
  });
});
