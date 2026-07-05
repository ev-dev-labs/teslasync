// RecentActivityFeed unit tests.
//
// RecentActivityFeed turns a list of `UserActivityEntry` audit rows into a
// Timeline: each row resolves an accent-tinted icon + translated title via the
// activityIcons registry, composes a subtitle from entity_type/entity_id/detail,
// renders a relative timestamp, and — for entity types that map to a route —
// wraps the title in a click-through <Link>. When the list is empty (or the
// caller hands us `undefined` before the query resolves) it renders an
// EmptyState instead of a blank panel.
//
// Facets covered:
//   1. entityHref routing table (exercised through the rendered links): every
//      routable entity_type -> its href, plus the non-routable fallbacks
//      (unknown type, missing entity_id) which render plain text.
//   2. URL-encoding of entity ids with reserved characters.
//   3. Empty / null-safety branches: [], undefined, null all show EmptyState;
//      custom emptyMessage overrides the default copy.
//   4. Title resolution: known action -> its label, unknown -> generic fallback.
//   5. Subtitle composition across all four shapes (type+id+detail, type only,
//      detail only, neither).
//   6. Relative time rendering, including the "—" placeholder for bad input.
//   7. a11y + the accent-colour fix: icons are aria-hidden and carry the
//      registry's Tailwind accent class.
//   8. className is forwarded to both the populated (Timeline) and empty
//      (EmptyState) roots.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Deterministic i18n: return the English fallback so assertions read the copy
// users actually see. importActual keeps every other react-i18next export
// (Trans, initReactI18next, …) intact for transitive components.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
    }),
  };
});

import { RecentActivityFeed, type RecentActivityFeedProps } from './RecentActivityFeed';
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

function renderFeed(props: RecentActivityFeedProps) {
  return render(
    <MemoryRouter>
      <RecentActivityFeed {...props} />
    </MemoryRouter>,
  );
}

describe('RecentActivityFeed — routable entities (entityHref table)', () => {
  // [action, entity_type, entity_id, expected href]
  const ROUTES: Array<[string, string, string, string]> = [
    ['vehicle.command.wake', 'vehicle', '7', '/vehicles/7'],
    ['drive.view', 'drive', '42', '/drives/42'],
    ['charge.view', 'charging_session', '9', '/charging/9'],
    ['charge.view', 'charge', '3', '/charging/3'],
    ['alert.rule.create', 'alert_rule', '5', '/notifications/alerts'],
    ['automation.create', 'automation', '2', '/automations'],
    ['geofence.create', 'geofence', '1', '/geofences'],
    ['data_export.create', 'data_export', '8', '/data-export'],
    ['data_export.create', 'export', '8', '/data-export'],
    ['api_key.create', 'api_key', '4', '/api-keys'],
  ];

  it.each(ROUTES)(
    'renders a click-through link for %s/%s -> %s',
    (action, entityType, entityId, expected) => {
      renderFeed({
        entries: [makeEntry({ action, entity_type: entityType, entity_id: entityId })],
      });
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expected);
    },
  );

  it('URL-encodes entity ids that contain reserved characters', () => {
    renderFeed({
      entries: [makeEntry({ action: 'vehicle.command', entity_type: 'vehicle', entity_id: 'a/b c' })],
    });
    expect(screen.getByRole('link')).toHaveAttribute('href', '/vehicles/a%2Fb%20c');
  });

  it('renders the title as plain text (no link) for an unknown entity_type', () => {
    renderFeed({
      entries: [makeEntry({ action: 'auth.login', entity_type: 'mystery', entity_id: '1' })],
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
  });

  it('renders plain text when entity_id is missing even for a routable type', () => {
    renderFeed({
      entries: [makeEntry({ action: 'auth.login', entity_type: 'vehicle', entity_id: null })],
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
  });
});

describe('RecentActivityFeed — empty / null-safety branches', () => {
  it('renders the default empty state for an empty list', () => {
    renderFeed({ entries: [] });
    expect(screen.getByText('No recent activity in this window.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('prefers a caller-supplied emptyMessage over the default', () => {
    renderFeed({ entries: [], emptyMessage: 'Nothing here yet' });
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText('No recent activity in this window.')).toBeNull();
  });

  it('does not throw and shows the empty state when entries is undefined', () => {
    // The prop is typed as an array, but a query can hand us undefined before it
    // resolves — this must not blow up on `.length` / `.map`.
    expect(() =>
      renderFeed({ entries: undefined as unknown as UserActivityEntry[] }),
    ).not.toThrow();
    expect(screen.getByText('No recent activity in this window.')).toBeInTheDocument();
  });

  it('does not throw and shows the empty state when entries is null', () => {
    expect(() => renderFeed({ entries: null as unknown as UserActivityEntry[] })).not.toThrow();
    expect(screen.getByText('No recent activity in this window.')).toBeInTheDocument();
  });
});

describe('RecentActivityFeed — title resolution', () => {
  it('renders the registry label for a known action', () => {
    renderFeed({ entries: [makeEntry({ action: 'vehicle.command.lock' })] });
    expect(screen.getByText('Lock vehicle')).toBeInTheDocument();
  });

  it('falls back to the generic label for an unknown action', () => {
    renderFeed({ entries: [makeEntry({ action: 'totally.unknown.thing' })] });
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });

  it('renders one row per entry', () => {
    renderFeed({
      entries: [
        makeEntry({ id: 1, action: 'auth.login' }),
        makeEntry({ id: 2, action: 'auth.logout' }),
        makeEntry({ id: 3, action: 'settings.update' }),
      ],
    });
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText('Signed out')).toBeInTheDocument();
    expect(screen.getByText('Settings updated')).toBeInTheDocument();
  });
});

describe('RecentActivityFeed — subtitle composition', () => {
  it('combines entity_type, entity_id and detail with the middot/dash separators', () => {
    const { container } = renderFeed({
      entries: [
        makeEntry({
          action: 'vehicle.command.wake',
          entity_type: 'vehicle',
          entity_id: '7',
          detail: 'woke up',
        }),
      ],
    });
    expect(container).toHaveTextContent('vehicle · 7 — woke up');
  });

  it('shows the entity_type alone when there is no id', () => {
    const { container } = renderFeed({
      entries: [makeEntry({ action: 'auth.login', entity_type: 'session', entity_id: null })],
    });
    expect(container).toHaveTextContent('session');
    expect(container).not.toHaveTextContent('—');
  });

  it('shows only the detail when entity_type is absent', () => {
    const { container } = renderFeed({
      entries: [makeEntry({ action: 'auth.login', entity_type: null, detail: 'via passkey' })],
    });
    expect(container).toHaveTextContent('via passkey');
  });

  it('renders no subtitle paragraph when neither entity nor detail exist', () => {
    const { container } = renderFeed({
      entries: [makeEntry({ action: 'auth.login', entity_type: null, entity_id: null, detail: null })],
    });
    // The only <p> Timeline emits is the subtitle; there must be none here.
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('RecentActivityFeed — timestamp', () => {
  it('renders a relative timestamp for a recent entry', () => {
    const { container } = renderFeed({
      entries: [makeEntry({ action: 'auth.login', ts: new Date(Date.now() - 5 * 60_000).toISOString() })],
    });
    expect(container).toHaveTextContent('5m ago');
  });

  it('renders the "—" placeholder for an unparseable timestamp', () => {
    const { container } = renderFeed({
      entries: [makeEntry({ action: 'auth.login', ts: 'not-a-real-date' })],
    });
    expect(container).toHaveTextContent('—');
  });
});

describe('RecentActivityFeed — accessibility + accent colour', () => {
  it('marks the row icon as decorative (aria-hidden)', () => {
    const { container } = renderFeed({ entries: [makeEntry({ action: 'auth.login' })] });
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it("tints the icon with the action's registry accent colour", () => {
    // auth.login -> text-emerald-300; vehicle.command.wake -> text-amber-300.
    const emerald = renderFeed({ entries: [makeEntry({ action: 'auth.login' })] });
    expect(emerald.container.querySelector('svg')?.classList.contains('text-emerald-300')).toBe(true);
    emerald.unmount();

    const amber = renderFeed({ entries: [makeEntry({ action: 'vehicle.command.wake' })] });
    expect(amber.container.querySelector('svg')?.classList.contains('text-amber-300')).toBe(true);
  });

  it('exposes the click-through link with an accessible name matching its title', () => {
    renderFeed({
      entries: [makeEntry({ action: 'vehicle.command.wake', entity_type: 'vehicle', entity_id: '7' })],
    });
    const link = screen.getByRole('link', { name: 'Wake vehicle' });
    expect(link).toHaveAttribute('href', '/vehicles/7');
  });
});

describe('RecentActivityFeed — className forwarding', () => {
  it('forwards className to the Timeline root when populated', () => {
    const { container } = renderFeed({
      entries: [makeEntry({ action: 'auth.login' })],
      className: 'custom-feed',
    });
    expect(container.firstChild).toHaveClass('custom-feed');
  });

  it('forwards className to the EmptyState root when empty', () => {
    renderFeed({ entries: [], className: 'custom-empty' });
    expect(screen.getByRole('status')).toHaveClass('custom-empty');
  });
});
