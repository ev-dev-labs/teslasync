/**
 * TeslaAccountPage — co-located contract + hardening tests.
 *
 * TeslaAccountPage is the `/tesla-account` route: a read-only view of the
 * Tesla account profile synced from the Fleet API, plus a "Refresh from
 * Tesla" action. Its only network inputs are the `useTeslaUserProfile`
 * query and the `useRefreshTeslaProfile` mutation. Everything else is
 * derived, so these tests drive both hooks directly and assert the page's
 * own behaviour:
 *
 *   - the page shell (h1 + subtitle) and the canonical document-title write;
 *   - the four-card KPI band (sync status, account id, member-since,
 *     last-updated) with real date formatting;
 *   - the profile hero (avatar image / initials / glyph fallback, name
 *     fallback, email, account-id badge, sync StatusPill);
 *   - the sync centre (relative + absolute last-synced, refresh button);
 *   - the account-details KVList (name/email/id/image/fetched-at) including
 *     the "Available" / "Not set" image branch;
 *   - the activity timeline (linked / updated / synced entries);
 *   - EVERY per-section loading / error / empty branch — no panel is gated
 *     away when data is missing;
 *   - the refresh interaction (header button + sync button + empty-state CTA
 *     all fire the mutation) and the error retry (fires refetch);
 *   - null-safety when a profile row is missing its numeric id;
 *   - a11y: the KPI landmark region, the icon-button accessible name, and
 *     that decorative icons are aria-hidden.
 *
 * Strategy mirrors the sibling VehicleCostPage / HelpPage suites: render the
 * REAL page + REAL shared subtree (PageContainer, MetricCard, KVList, Avatar,
 * Timeline, QueryError, EmptyState). Only the two data hooks, `usePageTitle`,
 * and react-i18next are mocked. Network is never touched. The clock is pinned
 * so the relative-time helpers are deterministic, and every date assertion is
 * computed via the SAME `@/lib/dateFormat` helpers the page uses, so the
 * suite is immune to the runner's locale / timezone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) and PageContainer's
// <DataFreshness> chip read it at module load. Install before any import
// evaluates so the mount doesn't throw.
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

const { profileMock, refreshMock } = vi.hoisted(() => ({
  profileMock: vi.fn(),
  refreshMock: vi.fn(),
}));

// Drive the two data hooks deterministically; keep every other export
// (userKeys, TeslaUserProfile type, sibling hooks) real so nothing else in
// the tree that might transitively import from this module breaks.
vi.mock('@/api/hooks/useUser', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useUser')>('@/api/hooks/useUser');
  return {
    ...actual,
    useTeslaUserProfile: () => profileMock(),
    useRefreshTeslaProfile: () => refreshMock(),
  };
});

// usePageTitle is a side-effect hook; mock it so the canonical-title write can
// be asserted without depending on a real DOM <head>.
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}` so
// assertions read real sentences instead of raw keys.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import TeslaAccountPage from './TeslaAccountPage';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ApiError } from '@/lib/resilience';
import { formatDate, formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { TeslaUserProfile } from '@/api/hooks/useUser';

const mockUsePageTitle = usePageTitle as unknown as ReturnType<typeof vi.fn>;

// ── Test doubles for the query + mutation results ─────────────────────────────

interface ProfileEnvelope {
  profile: TeslaUserProfile | null;
  fetched_at: string | null;
}

interface FakeQuery {
  data?: ProfileEnvelope;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface FakeMutation {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
}

function makeMutation(overrides: Partial<FakeMutation> = {}): FakeMutation {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

// Clock is pinned in beforeEach; these fixtures are chosen so the relative
// helpers resolve to distinct, deterministic strings:
//   fetched_at → "2d ago"   updated_at → "3d ago"   created_at → far past (date)
const FETCHED_AT = '2026-07-02T00:00:00Z';
const PROFILE: TeslaUserProfile = {
  id: 42,
  email: 'driver@example.com',
  full_name: 'Ada Lovelace',
  profile_image_url: 'https://tesla.example/ada.jpg',
  fetched_at: FETCHED_AT,
  created_at: '2020-01-15T08:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

function envelope(
  profile: TeslaUserProfile | null,
  fetched: string | null = FETCHED_AT,
): ProfileEnvelope {
  return { profile, fetched_at: fetched };
}

function setup(query: FakeQuery, mutation: FakeMutation = makeMutation()) {
  profileMock.mockReturnValue(query);
  refreshMock.mockReturnValue(mutation);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TeslaAccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Scope helper: every section body lives inside a <GlassPanel> (which carries a
// stable `data-print-card` attribute) whose first child is the section heading.
function panel(headingName: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: headingName });
  const root = heading.closest('[data-print-card]');
  if (!root) throw new Error(`panel not found for heading "${headingName}"`);
  return root as HTMLElement;
}

function kpiBand(): HTMLElement {
  return screen.getByRole('region', { name: 'Account summary' });
}

function refreshButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: 'Refresh from Tesla' });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-04T06:11:43Z'));
  profileMock.mockReset();
  refreshMock.mockReset();
  mockUsePageTitle.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TeslaAccountPage — shell', () => {
  it('renders the h1 + subtitle and writes the canonical document title', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tesla Account' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your Tesla account profile synced from the Fleet API'),
    ).toBeInTheDocument();
    expect(mockUsePageTitle).toHaveBeenCalledWith('Tesla Account');
  });
});

describe('TeslaAccountPage — populated', () => {
  it('renders the four-card KPI band with real date formatting', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const band = kpiBand();

    // Sync status + account id.
    expect(within(band).getByText('Synced')).toBeInTheDocument();
    expect(within(band).getByText('#42')).toBeInTheDocument();
    // Sync-status subtitle = relative fetched_at; last-updated value = relative
    // updated_at. Distinct, deterministic strings under the pinned clock.
    expect(within(band).getByText(formatRelative(FETCHED_AT))).toBeInTheDocument();
    expect(
      within(band).getByText(formatRelative(PROFILE.updated_at)),
    ).toBeInTheDocument();
    // Member-since value uses absolute date; assert at least one occurrence
    // (value + subtitle collapse to the same string for a far-past date).
    expect(
      within(band).getAllByText(formatDate(PROFILE.created_at)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders the profile hero: avatar image, name, email, id badge, sync pill', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const hero = panel('Profile');

    expect(
      within(hero).getByRole('img', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
    expect(within(hero).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(hero).getByText('driver@example.com')).toBeInTheDocument();
    expect(within(hero).getByText('#42')).toBeInTheDocument();
    expect(within(hero).getByText('Synced')).toBeInTheDocument();
  });

  it('renders the sync centre with relative + absolute last-synced', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const sync = panel('Sync');

    expect(within(sync).getByText(formatRelative(FETCHED_AT))).toBeInTheDocument();
    expect(within(sync).getByText(formatDateTime(FETCHED_AT))).toBeInTheDocument();
    expect(
      within(sync).getByText(
        'Fetches your latest account profile from the Tesla Fleet API.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the account-details KVList including the "Available" image branch', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const details = panel('Account Details');

    expect(within(details).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(details).getByText('driver@example.com')).toBeInTheDocument();
    expect(within(details).getByText('#42')).toBeInTheDocument();
    expect(within(details).getByText('Available')).toBeInTheDocument();
    expect(within(details).getByText(formatDateTime(FETCHED_AT))).toBeInTheDocument();
  });

  it('renders the activity timeline with linked / updated / synced entries', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const activity = panel('Activity');

    expect(within(activity).getByText('Account linked')).toBeInTheDocument();
    expect(within(activity).getByText('Profile updated')).toBeInTheDocument();
    expect(within(activity).getByText('Last synced from Tesla')).toBeInTheDocument();
    expect(
      within(activity).getByText('Tesla account connected to TeslaSync'),
    ).toBeInTheDocument();
    // The three entry timestamps map to the three source dates.
    expect(
      within(activity).getByText(formatDateTime(PROFILE.created_at)),
    ).toBeInTheDocument();
    expect(
      within(activity).getByText(formatDateTime(PROFILE.updated_at)),
    ).toBeInTheDocument();
  });

  it('falls back to initials when no profile image is set and shows "Not set"', () => {
    setup(makeQuery({ data: envelope({ ...PROFILE, profile_image_url: null }) }));

    // No <img>; avatar renders deterministic initials instead.
    expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar-initials')).toHaveTextContent('AL');
    expect(within(panel('Account Details')).getByText('Not set')).toBeInTheDocument();
  });

  it('falls back to the generic "Tesla Driver" label for an unnamed profile', () => {
    setup(
      makeQuery({
        data: envelope({ ...PROFILE, full_name: '', profile_image_url: null }),
      }),
    );

    expect(within(panel('Profile')).getByText('Tesla Driver')).toBeInTheDocument();
    // With no name and no image the avatar renders the generic glyph.
    expect(screen.getByTestId('avatar-glyph')).toBeInTheDocument();
    // The details "Name" row shows the em-dash placeholder, not a blank cell.
    expect(within(panel('Account Details')).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('TeslaAccountPage — refresh + retry interactions', () => {
  it('fires the mutation from both the header and the sync-centre buttons', () => {
    const mutation = makeMutation();
    setup(makeQuery({ data: envelope(PROFILE) }), mutation);

    const buttons = refreshButtons();
    expect(buttons).toHaveLength(2); // header action + sync-centre CTA

    expect(mutation.mutate).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]);
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]);
    expect(mutation.mutate).toHaveBeenCalledTimes(2);
  });

  it('disables the refresh controls and marks them busy while the mutation is pending', () => {
    setup(makeQuery({ data: envelope(PROFILE) }), makeMutation({ isPending: true }));

    const buttons = refreshButtons();
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('aria-busy', 'true');
    }
  });

  it('fires the empty-state CTA mutation when there is no profile yet', () => {
    const mutation = makeMutation();
    setup(makeQuery({ data: envelope(null, null) }), mutation);

    // Empty profile panel renders its own "Refresh from Tesla" CTA.
    const cta = within(panel('Profile')).getByRole('button', {
      name: 'Refresh from Tesla',
    });
    fireEvent.click(cta);
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a per-section error and retries via the query on a 5xx', () => {
    const query = makeQuery({
      isError: true,
      error: new ApiError('boom', 500),
      dataUpdatedAt: 0,
    });
    setup(query);

    // One QueryError per data-backed section: KPI band, profile, details, activity.
    expect(screen.getAllByText('Server error')).toHaveLength(4);

    const retry = screen.getAllByRole('button', { name: 'Retry' });
    expect(retry.length).toBeGreaterThanOrEqual(1);
    expect(query.refetch).not.toHaveBeenCalled();
    fireEvent.click(retry[0]);
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('TeslaAccountPage — loading + empty branches', () => {
  it('shows skeletons (not data) for every section while the first fetch is in flight', () => {
    setup(makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }));

    // KPI band renders its stat-grid skeleton, not metric cards.
    expect(within(kpiBand()).getByTestId('stat-grid-skeleton')).toBeInTheDocument();
    // No profile data has leaked into the DOM.
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByText('#42')).not.toBeInTheDocument();
    expect(screen.queryByTestId('avatar')).not.toBeInTheDocument();
    // The panel scaffolding (headings) still renders — no gutted page.
    expect(panel('Profile')).toBeInTheDocument();
    expect(panel('Activity')).toBeInTheDocument();
  });

  it('renders calm empty states + placeholders when there is no profile', () => {
    setup(makeQuery({ data: envelope(null, null) }));
    const band = kpiBand();

    // KPI band shows the "never synced" copy and em-dash placeholders — never blank.
    expect(within(band).getByText('Never synced')).toBeInTheDocument();
    expect(within(band).getAllByText('—').length).toBeGreaterThanOrEqual(3);

    // Every section keeps a visible empty state.
    expect(within(panel('Profile')).getByText('No profile synced yet')).toBeInTheDocument();
    expect(
      within(panel('Account Details')).getByText(/No account details yet/i),
    ).toBeInTheDocument();
    expect(
      within(panel('Activity')).getByText('No account activity to show yet.'),
    ).toBeInTheDocument();
  });
});

describe('TeslaAccountPage — null-safety + a11y', () => {
  it('renders resiliently when a profile row is missing its numeric id', () => {
    setup(
      makeQuery({
        data: envelope({ ...PROFILE, id: null as unknown as number }),
      }),
    );

    // Account id collapses to the placeholder rather than "#null" or a crash.
    expect(within(kpiBand()).getByText('—')).toBeInTheDocument();
    expect(within(panel('Account Details')).getByText('—')).toBeInTheDocument();
    // The rest of the page still renders.
    expect(within(panel('Profile')).getByText('driver@example.com')).toBeInTheDocument();
  });

  it('exposes the KPI landmark, an accessible refresh control, and aria-hidden icons', () => {
    const { container } = setup(makeQuery({ data: envelope(PROFILE) }));

    expect(kpiBand()).toBeInTheDocument();
    expect(refreshButtons().length).toBeGreaterThanOrEqual(1);
    // Decorative icons must be hidden from assistive tech — the visible text
    // carries the meaning.
    expect(
      container.querySelectorAll('svg[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(6);
  });
});
