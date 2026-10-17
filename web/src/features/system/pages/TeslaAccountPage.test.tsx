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
 * and react-i18next are mocked. Write-affordance cases use the real mode
 * provider; GET recovery uses the real query/client with mocked fetch only.
 * No real network is touched. The clock is pinned
 * so the relative-time helpers are deterministic, and every date assertion is
 * computed via the SAME `@/lib/dateFormat` helpers the page uses, so the
 * suite is immune to the runner's locale / timezone.
 */
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) and PageContainer's
// <FreshnessDot> chip read it at module load. Install before any import
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
const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
const connection = vi.hoisted(() => ({ online: true }));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => connection.online,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
      currency_symbol: '$', decimal_precision: 2, locale: datePreferences.locale,
      tz_display_default: 'user', timezone_user: datePreferences.tz },
    locale: datePreferences.locale, decimals: 2, isMiles: false,
    isFahrenheit: false, isPSI: false, density: 'comfortable',
  }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => datePreferences.tz,
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
import { OperationalModeProvider } from '@/hooks/useOperationalMode';
import { createQueryClient } from '@/api/queryClient';

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
  isPending: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
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
    isPending: false,
    fetchStatus: 'idle',
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

function setup(
  query: FakeQuery | null,
  mutation: FakeMutation = makeMutation(),
  route = '/tesla-account',
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  if (query) profileMock.mockReturnValue(query);
  refreshMock.mockReturnValue(mutation);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <OperationalModeProvider>
          <TeslaAccountPage />
        </OperationalModeProvider>
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
  const band = screen.getAllByRole('region', { name: 'Account summary' })
    .find(region => region.hasAttribute('data-operational-brief'));
  if (!band) throw new Error('OperationalBrief account summary region not found');
  return band;
}

function refreshButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: 'Refresh from Tesla' });
}

// Open the summary drawer's real Review-details dialog, run group/detail
// assertions against it, then close it again.
function withDrawer(strip: HTMLElement, assert: (dialog: HTMLElement) => void): void {
  expect(screen.queryByRole('dialog'), 'Finish any open interaction before inspecting evidence').not.toBeInTheDocument();
  fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    assert(dialog);
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-04T06:11:43Z'));
  profileMock.mockReset();
  refreshMock.mockReset();
  mockUsePageTitle.mockReset();
  datePreferences.locale = 'en-US';
  datePreferences.tz = 'UTC';
  connection.online = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TeslaAccountPage — shell', () => {
  it('renders the h1 + subtitle and writes the canonical document title', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tesla account' }),
    ).toBeInTheDocument();
    // The subtitle renders once in the page header; the summary brief keeps
    // the same sentence as its drawer description, not a second face copy.
    expect(
      screen.getAllByText('Your Tesla account profile synced from the Fleet API'),
    ).toHaveLength(1);
    withDrawer(screen.getByTestId('tesla-account-summary'), (dialog) => {
      // The header description keeps the sentence (the narrative section
      // repeats it as "what changed", so scope to the header).
      const header = dialog.querySelector('[data-drawer-header]');
      expect(header).not.toBeNull();
      expect(within(header as HTMLElement).getByText('Your Tesla account profile synced from the Fleet API')).toBeInTheDocument();
    });
    expect(mockUsePageTitle).toHaveBeenCalledWith('Tesla account');
  });
});

describe('TeslaAccountPage — populated', () => {
  it('uses one canonical summary and retains source ID, date contexts and all non-summary sections', () => {
    const { container } = setup(makeQuery({ data: envelope(PROFILE) }));
    const strip = screen.getByTestId('tesla-account-summary');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    assertOperationalBriefDisclosure(strip, 'Fleet API profile snapshot');
    assertOperationalBriefDisclosure(strip, `Source fetched at ${formatDateTime(FETCHED_AT, datePreferences)}`, { contains: true });
    const tiles = [...strip.querySelectorAll('[data-operational-metric]')];
    expect(tiles.map(tile => tile.getAttribute('data-operational-metric'))).toEqual(['sync-status', 'account-id', 'member-since', 'last-updated']);
    expect(tiles[1]?.querySelector('[data-operational-value]')).toHaveTextContent('#42');
    // Metric context lives in the drawer groups, not on the value-only face.
    withDrawer(strip, (dialog) => {
      expect(within(dialog).getByRole('group', { name: 'Account ID' })).toHaveTextContent('Fleet API identity');
      expect(within(dialog).getByRole('group', { name: 'Sync status' })).toHaveTextContent(formatDateTime(FETCHED_AT, datePreferences));
      expect(within(dialog).getByRole('group', { name: 'Member since' })).toHaveTextContent(formatDateTime(PROFILE.created_at, datePreferences));
      expect(within(dialog).getByRole('group', { name: 'Last updated' })).toHaveTextContent(formatDateTime(PROFILE.updated_at, datePreferences));
    });
    for (const heading of ['Profile', 'Sync', 'Account details', 'Activity']) {
      expect(panel(heading)).toBeInTheDocument();
    }
    expect(refreshButtons()).toHaveLength(2);
  });

  it('does not replace a real source account ID zero with an unknown placeholder', () => {
    setup(makeQuery({ data: envelope({ ...PROFILE, id: 0 }) }));
    const idTile = kpiBand().querySelectorAll('[data-operational-metric]')[1]!;
    expect(idTile).toHaveAttribute('data-value-state', 'value');
    expect(idTile.querySelector('[data-operational-value]')).toHaveTextContent('#0');
    expect(within(panel('Account details')).getByText('#0')).toBeInTheDocument();
  });

  it('keeps profile details, causal activity rows and refresh actions during a failed refresh', () => {
    setup(makeQuery({ data: envelope(PROFILE), isError: true, error: new Error('refresh failed') }));
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(within(panel('Account details')).getByText('Ada Lovelace')).toBeInTheDocument();
    const list = within(panel('Activity')).getByRole('list', { name: 'Activity' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Account linked'),
      expect.stringContaining('Profile updated'),
      expect.stringContaining('Last synced from Tesla'),
    ]);
    expect(refreshButtons()).toHaveLength(2);
    expect(refreshButtons().every((button) => !button.hasAttribute('disabled'))).toBe(true);
    assertOperationalBriefDisclosure(screen.getByTestId('tesla-account-summary'), 'Retained source data', { contains: true });
    assertOperationalBriefDisclosure(screen.getByTestId('tesla-account-summary'), 'Showing retained measurements', { contains: true });
    expect([...screen.getByTestId('tesla-account-summary').querySelectorAll('[data-operational-metric]')]
      .every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
  });

  it('renders the four-card KPI band with real date formatting', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const band = kpiBand();

    // Sync status + account id.
    expect(within(band.querySelector('[data-operational-metric="sync-status"]') as HTMLElement).getByText('Synced')).toBeInTheDocument();
    expect(within(band).getByText('#42')).toBeInTheDocument();
    // Sync-status context = relative fetched_at (drawer group); last-updated
    // value = relative updated_at (face). Distinct, deterministic strings
    // under the pinned clock.
    withDrawer(band, (dialog) => {
      expect(within(dialog).getByRole('group', { name: 'Sync status' })).toHaveTextContent(formatRelative(FETCHED_AT));
    });
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

    expect(within(sync).getByText(formatRelative(FETCHED_AT, datePreferences))).toBeInTheDocument();
    expect(within(sync).getByText(formatDateTime(FETCHED_AT, datePreferences))).toBeInTheDocument();
    expect(
      within(sync).getByText(
        'Fetches your latest account profile from the Tesla Fleet API.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the account-details KVList including the "Available" image branch', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    const details = panel('Account details');

    expect(within(details).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(details).getByText('driver@example.com')).toBeInTheDocument();
    expect(within(details).getByText('#42')).toBeInTheDocument();
    expect(within(details).getByText('Available')).toBeInTheDocument();
    expect(within(details).getByText(formatDateTime(FETCHED_AT, datePreferences))).toBeInTheDocument();
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
      within(activity).getByText(formatDateTime(PROFILE.created_at, datePreferences)),
    ).toBeInTheDocument();
    expect(
      within(activity).getByText(formatDateTime(PROFILE.updated_at, datePreferences)),
    ).toBeInTheDocument();
  });

  it('falls back to initials when no profile image is set and shows "Not set"', () => {
    setup(makeQuery({ data: envelope({ ...PROFILE, profile_image_url: null }) }));

    // No <img>; avatar renders deterministic initials instead.
    expect(screen.queryByAltText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar-initials')).toHaveTextContent('AL');
    expect(within(panel('Account details')).getByText('Not set')).toBeInTheDocument();
  });

  it('falls back to the generic "Tesla Driver" label for an unnamed profile', () => {
    setup(
      makeQuery({
        data: envelope({ ...PROFILE, full_name: '', profile_image_url: null }),
      }),
    );

    expect(within(panel('Profile')).getByText('Tesla driver')).toBeInTheDocument();
    // With no name and no image the avatar renders the generic glyph.
    expect(screen.getByTestId('avatar-glyph')).toBeInTheDocument();
    // The details "Name" row shows the em-dash placeholder, not a blank cell.
    expect(within(panel('Account details')).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('TeslaAccountPage — refresh + retry interactions', () => {
  it('fires the mutation from both the header and the sync-centre buttons', () => {
    const mutation = makeMutation();
    mutation.mutate.mockImplementation((_variables, options?: { onSettled?: () => void }) => {
      options?.onSettled?.();
    });
    setup(makeQuery({ data: envelope(PROFILE) }), mutation);

    const buttons = refreshButtons();
    expect(buttons).toHaveLength(2); // header action + sync-centre CTA

    expect(mutation.mutate).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]);
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]);
    expect(mutation.mutate).toHaveBeenCalledTimes(2);
  });

  describe('TeslaAccountPage — write affordance', () => {
    it.each([
      { mode: 'live', online: true, asOf: null, reason: null },
      { mode: 'historical', online: true, asOf: FETCHED_AT, reason: 'Return to live mode before making operational changes.' },
      { mode: 'cached', online: false, asOf: null, reason: 'Reconnect before making operational changes.' },
      { mode: 'cached historical', online: false, asOf: FETCHED_AT, reason: 'Return to live mode before making operational changes.' },
    ])('$mode preserves every empty-profile action and gates only writes', ({ online, asOf, reason }) => {
      connection.online = online;
      const mutation = makeMutation();
      mutation.mutate.mockImplementation((_variables, options?: { onSettled?: () => void }) => options?.onSettled?.());
      setup(makeQuery({ data: envelope(null, null) }), mutation,
        asOf ? `/tesla-account?as_of=${encodeURIComponent(asOf)}` : '/tesla-account');
      const buttons = refreshButtons();
      expect(buttons).toHaveLength(3);
      // Header + sync-centre refreshes are icon-only; the empty-profile CTA
      // keeps its labelled touch target and the write-block reason tooltip.
      const labelled = within(panel('Profile')).getByRole('button', { name: 'Refresh from Tesla' });
      expect(labelled).toHaveClass('min-h-11');
      expect(buttons.filter((button) => button !== labelled)).toHaveLength(2);
      for (const button of buttons) {
        if (button !== labelled) expect(button).toHaveClass('h-9', 'w-9');
        if (reason) {
          expect(button).toBeDisabled();
          expect(button).not.toHaveAttribute('aria-busy');
        } else {
          expect(button).toBeEnabled();
        }
        fireEvent.click(button);
      }
      expect(mutation.mutate).toHaveBeenCalledTimes(reason ? 0 : 3);
      if (reason) {
        expect(labelled).toHaveAttribute('title', reason);
        expect(screen.getByText('Operational changes are read-only')).toBeInTheDocument();
        expect(screen.getByText(reason)).toBeInTheDocument();
      } else {
        expect(screen.queryByText('Operational changes are read-only')).not.toBeInTheDocument();
      }
      for (const heading of ['Profile', 'Sync', 'Account details', 'Activity']) {
        expect(panel(heading)).toBeInTheDocument();
      }
      expect(panel('Sync')).toHaveTextContent('Fetches your latest account profile from the Tesla Fleet API.');
    });

    it.each([
      { mode: 'historical', online: true, asOf: FETCHED_AT },
      { mode: 'cached', online: false, asOf: null },
    ])('$mode blocks direct refresh-handler activation even when DOM disabling is bypassed', ({ online, asOf }) => {
      connection.online = online;
      const mutation = makeMutation();
      setup(makeQuery({ data: envelope(null, null) }), mutation,
        asOf ? `/tesla-account?as_of=${encodeURIComponent(asOf)}` : '/tesla-account');
      for (const button of refreshButtons()) {
        // Invoke the supplied handler itself, not React's disabled-event filter.
        const propsKey = Object.keys(button).find(key => key.startsWith('__reactProps$'));
        expect(propsKey).toBeDefined();
        const props = (button as unknown as Record<string, { onClick?: () => void }>)[propsKey!];
        expect(props.onClick).toBeTypeOf('function');
        act(() => props.onClick?.());
      }
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    it('blocks same-event cross-control duplication before pending rerenders and releases only on settlement', () => {
      const mutation = makeMutation();
      setup(makeQuery({ data: envelope(null, null) }), mutation);
      const buttons = refreshButtons();
      mutation.mutate.mockImplementationOnce(() => fireEvent.click(buttons[1]));
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[2]);
      expect(mutation.mutate).toHaveBeenCalledTimes(1);
      const [, options] = mutation.mutate.mock.calls[0] as [undefined, { onSettled: () => void }];
      act(() => options.onSettled());
      fireEvent.click(buttons[2]);
      expect(mutation.mutate).toHaveBeenCalledTimes(2);
    });

    it('guards a programmatic pending transition before disabled controls rerender', () => {
      const mutation = makeMutation();
      setup(makeQuery({ data: envelope(PROFILE) }), mutation);
      expect(refreshButtons()[0]).toBeEnabled();
      mutation.isPending = true;
      fireEvent.click(refreshButtons()[0]);
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    it('releases the duplicate guard after a synchronous mutation dispatch failure', () => {
      const mutation = makeMutation();
      setup(makeQuery({ data: envelope(PROFILE) }), mutation);
      const button = refreshButtons()[0];
      const propsKey = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
      const { onClick } = (button as unknown as Record<string, { onClick: () => void }>)[propsKey];
      mutation.mutate.mockImplementationOnce(() => { throw new Error('Synthetic dispatch failure'); });
      expect(onClick).toThrow('Synthetic dispatch failure');
      act(() => onClick());
      expect(mutation.mutate).toHaveBeenCalledTimes(2);
    });

    it.each([
      { mode: 'historical', online: true, asOf: FETCHED_AT },
      { mode: 'cached', online: false, asOf: null },
    ])('$mode keeps retained source dates and GET recovery while refresh writes are disabled', ({ online, asOf }) => {
      connection.online = online;
      const query = makeQuery({ data: envelope(PROFILE), isError: true, error: new Error('Synthetic refresh failure') });
      const mutation = makeMutation();
      setup(query, mutation,
        asOf ? `/tesla-account?as_of=${encodeURIComponent(asOf)}` : '/tesla-account');
      expect(panel('Profile')).toHaveTextContent(PROFILE.full_name);
      expect(panel('Account details')).toHaveTextContent(PROFILE.email);
      expect(within(panel('Activity')).getAllByRole('listitem')).toHaveLength(3);
      assertOperationalBriefDisclosure(kpiBand(), `Source fetched at ${formatDateTime(FETCHED_AT, datePreferences)}`, { contains: true });
      expect(refreshButtons()).toHaveLength(2);
      expect(refreshButtons().every(button => button.hasAttribute('disabled'))).toBe(true);
      const recover = within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' });
      expect(recover).toBeEnabled();
      fireEvent.click(recover);
      expect(query.refetch).toHaveBeenCalledOnce();
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    it.each([
      { mode: 'historical', online: true, asOf: FETCHED_AT },
      { mode: 'cached', online: false, asOf: null },
      { mode: 'cached historical', online: false, asOf: FETCHED_AT },
    ])('$mode retries the real profile GET after an error without ever dispatching a POST', async ({ online, asOf }) => {
      connection.online = online;
      const actual = await vi.importActual<typeof import('@/api/hooks/useUser')>('@/api/hooks/useUser');
      profileMock.mockImplementation(actual.useTeslaUserProfile);
      const client = createQueryClient();
      client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
      const fetchMock = vi.fn<typeof fetch>()
        .mockRejectedValueOnce(new DOMException('Synthetic initial read failure', 'AbortError'))
        .mockResolvedValue(new Response(JSON.stringify(envelope(PROFILE)), {
          headers: { 'Content-Type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);
      const mutation = makeMutation();
      const route = asOf ? `/tesla-account?as_of=${encodeURIComponent(asOf)}` : '/tesla-account';
      const oldUrl = window.location.href;
      window.history.replaceState({}, '', route);
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
      try {
        const view = setup(null, mutation, route, client);
        if (online) {
          await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0));
          const retry = screen.getAllByRole('button', { name: 'Retry' })[0];
          expect(retry).toBeEnabled();
          fireEvent.click(retry);
        } else {
          await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry when online' })[0]).toBeDisabled());
          expect(refreshButtons().every(button => button.hasAttribute('disabled'))).toBe(true);
          onlineSpy.mockReturnValue(true);
          connection.online = true;
          act(() => window.dispatchEvent(new Event('online')));
          view.rerender(
            <QueryClientProvider client={client}>
              <MemoryRouter initialEntries={[route]}>
                <OperationalModeProvider><TeslaAccountPage /></OperationalModeProvider>
              </MemoryRouter>
            </QueryClientProvider>,
          );
        }
        await waitFor(() => expect(panel('Profile')).toHaveTextContent(PROFILE.full_name));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        for (const [url, options] of fetchMock.mock.calls) {
          expect(url).toBe('/api/v1/tesla/user/profile');
          expect(options?.method ?? 'GET').toBe('GET');
          expect(options?.signal).toBeInstanceOf(AbortSignal);
          expect(options).not.toHaveProperty('requiresLiveMode');
        }
        for (const button of refreshButtons()) {
          if (asOf) {
            expect(button).toBeDisabled();
            fireEvent.click(button);
          } else {
            expect(button).toBeEnabled();
          }
        }
        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(within(panel('Activity')).getAllByRole('listitem')).toHaveLength(3);
      } finally {
        cleanup();
        client.clear();
        onlineSpy.mockRestore();
        vi.unstubAllGlobals();
        window.history.replaceState({}, '', oldUrl);
      }
    });
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

    // Canonical summary retains four loading tiles, not measured zeroes.
    const loadingStrip = kpiBand();
    expect(loadingStrip).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(loadingStrip, 'Loading sources', { contains: true });
    expect(loadingStrip.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect([...loadingStrip.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(loadingStrip.querySelectorAll('[data-operational-value]')).toHaveLength(0);
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

    // KPI band shows the "never synced" value; unknown readings are omitted
    // tiles with a counted drawer explanation — never blank, never invented.
    expect(within(band.querySelector('[data-operational-metric="sync-status"]') as HTMLElement).getByText('Never synced')).toBeInTheDocument();
    assertOperationalMetricUnavailable(band, 'Account ID');
    assertOperationalMetricUnavailable(band, 'Member since');
    assertOperationalMetricUnavailable(band, 'Last updated');

    // Every section keeps a visible empty state.
    expect(within(panel('Profile')).getByText('No profile synced yet')).toBeInTheDocument();
    expect(
      within(panel('Account details')).getByText(/no Account details yet/i),
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

    // Account id collapses to an omitted tile rather than "#null" or a crash.
    assertOperationalMetricUnavailable(kpiBand(), 'Account ID');
    expect(within(panel('Account details')).getByText('—')).toBeInTheDocument();
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


describe('TeslaAccountPage — restrained adoption', () => {
  it('keeps every panel visible without claiming an initial loading profile was never synced', () => {
    setup(makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
    for (const heading of ['Profile', 'Sync', 'Account details', 'Activity']) {
      expect(panel(heading)).toBeInTheDocument();
    }
    expect(within(panel('Sync')).queryByText('Not synced yet')).not.toBeInTheDocument();
    expect(within(panel('Sync')).getByText('Last synced')).toBeInTheDocument();
  });

  describe('TeslaAccountPage — source trust, saved dates and owned targets', () => {
    it.each(['idle', 'paused'] as const)('keeps an unanswered %s read unresolved with GET recovery, not an empty profile', (fetchStatus) => {
      const query = makeQuery({ isPending: true, fetchStatus, dataUpdatedAt: 0 });
      const mutation = makeMutation();
      setup(query, mutation);
      const message = fetchStatus === 'paused'
        ? 'Profile loading is paused. No account snapshot has been received yet.'
        : 'Account snapshot availability has not resolved yet.';
      for (const heading of ['Profile', 'Account details', 'Activity']) {
        expect(within(panel(heading)).getByRole('status')).toHaveTextContent(message);
        fireEvent.click(within(panel(heading)).getByRole('button', { name: 'Retry' }));
      }
      expect(query.refetch).toHaveBeenCalledTimes(3);
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(refreshButtons()).toHaveLength(2);
      expect(screen.queryByText('No profile synced yet')).not.toBeInTheDocument();
      expect(screen.queryByText('Never synced')).not.toBeInTheDocument();
      expect(screen.queryByText('No account activity to show yet.')).not.toBeInTheDocument();
      expect(within(panel('Sync')).getByText('Unknown')).toBeInTheDocument();
      assertOperationalBriefDisclosure(kpiBand(), 'Source values unknown', { contains: true });
      assertOperationalMetricUnavailable(kpiBand(), 'Sync status');
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    });

    it.each([null, '', 'not-a-date'])('keeps a populated profile with fetch timestamp %s unknown across all sync presentations', (fetched_at) => {
      const profile = { ...PROFILE, fetched_at: fetched_at as unknown as string };
      setup(makeQuery({ data: envelope(profile, null) }));
      const hero = within(panel('Profile'));
      expect(hero.getByText('Unknown').querySelector('span')).toHaveClass('bg-[var(--text-secondary)]');
      expect(hero.getByText(PROFILE.email)).toBeInTheDocument();
      expect(within(panel('Sync')).getByText('Unknown')).toBeInTheDocument();
      assertOperationalBriefDisclosure(kpiBand(), 'Unknown');
      assertOperationalBriefDisclosure(kpiBand(), 'freshness is unknown', { contains: true });
      assertOperationalMetricUnavailable(kpiBand(), 'Sync status');
      expect(screen.queryByText('Never synced')).not.toBeInTheDocument();
      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      expect(within(panel('Activity')).getAllByRole('listitem')).toHaveLength(3);
      expect(refreshButtons()).toHaveLength(2);
    });

    it('keeps timestamp precedence: invalid profile time is not replaced by a valid envelope time', () => {
      setup(makeQuery({ data: envelope({ ...PROFILE, fetched_at: '' }, FETCHED_AT) }));
      expect(within(panel('Profile')).getByText('Unknown')).toBeInTheDocument();
      expect(within(panel('Sync')).getByText('Unknown')).toBeInTheDocument();
      expect(kpiBand()).not.toHaveTextContent(`Source fetched at ${formatDateTime(FETCHED_AT)}`);
    });

    it('uses a valid envelope timestamp when the profile timestamp is absent, without altering the details source', () => {
      setup(makeQuery({ data: envelope({ ...PROFILE, fetched_at: null as unknown as string }, FETCHED_AT) }));
      expect(within(panel('Profile')).getByText('Synced')).toBeInTheDocument();
      expect(within(panel('Sync')).getByText(formatDateTime(FETCHED_AT, datePreferences))).toBeInTheDocument();
      assertOperationalBriefDisclosure(kpiBand(), `Source fetched at ${formatDateTime(FETCHED_AT, datePreferences)}`, { contains: true });
      expect(within(panel('Account details')).getByText('—')).toBeInTheDocument();
      expect(within(panel('Activity')).getAllByRole('listitem')).toHaveLength(3);
    });

    it('retains an independently readable profile through paused recovery without claiming offline or fresh token validity', () => {
      const query = makeQuery({ data: envelope(PROFILE), fetchStatus: 'paused' });
      const mutation = makeMutation();
      setup(query, mutation);
      expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
      expect(within(panel('Profile')).getByText(PROFILE.full_name)).toBeInTheDocument();
      expect(within(panel('Account details')).getByText(PROFILE.email)).toBeInTheDocument();
      expect(within(panel('Activity')).getAllByRole('listitem')).toHaveLength(3);
      assertOperationalBriefDisclosure(kpiBand(), 'Retained source data', { contains: true });
      assertOperationalBriefDisclosure(kpiBand(), `Source fetched at ${formatDateTime(FETCHED_AT, datePreferences)}`, { contains: true });
      fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
      expect(query.refetch).toHaveBeenCalledOnce();
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(screen.queryByText(/offline|token valid|permission granted/i)).not.toBeInTheDocument();
    });

    it('applies saved locale and timezone to all source dates, relative long-age context and activity bounds', () => {
      datePreferences.locale = 'de-DE';
      datePreferences.tz = 'Pacific/Honolulu';
      setup(makeQuery({ data: envelope(PROFILE) }));
      expect(within(panel('Sync')).getByText(formatDateTime(FETCHED_AT, datePreferences))).toBeInTheDocument();
      expect(within(panel('Account details')).getByText(formatDateTime(FETCHED_AT, datePreferences))).toBeInTheDocument();
      const rows = within(panel('Activity')).getAllByRole('listitem');
      expect(rows[0]).toHaveTextContent(formatDateTime(PROFILE.created_at, datePreferences));
      expect(rows[1]).toHaveTextContent(formatDateTime(PROFILE.updated_at, datePreferences));
      expect(rows[2]).toHaveTextContent(formatDateTime(FETCHED_AT, datePreferences));
      expect(panel('Activity')).toHaveTextContent(formatDateTime(PROFILE.created_at, datePreferences));
      expect(kpiBand()).toHaveTextContent(formatDate(PROFILE.created_at, datePreferences));
      withDrawer(kpiBand(), (dialog) => {
        expect(within(dialog).getByRole('group', { name: 'Member since' })).toHaveTextContent(formatRelative(PROFILE.created_at, datePreferences));
        expect(within(dialog).getByRole('group', { name: 'Member since' })).toHaveTextContent(formatDateTime(PROFILE.created_at, datePreferences));
        expect(within(dialog).getByRole('group', { name: 'Last updated' })).toHaveTextContent(formatDateTime(PROFILE.updated_at, datePreferences));
      });
      assertOperationalBriefDisclosure(kpiBand(), `Source fetched at ${formatDateTime(FETCHED_AT, datePreferences)}`, { contains: true });
      expect(PROFILE.fetched_at).toBe(FETCHED_AT);
      expect(PROFILE.id).toBe(42);
    });

    it('adopts mobile44 minimums only for header and empty-profile Refresh and restores their desktop minimums', () => {
      setup(makeQuery({ data: envelope(null, null) }));
      const buttons = refreshButtons();
      expect(buttons).toHaveLength(3);
      // Header + sync-centre refreshes are icon-only; only the empty-profile
      // CTA keeps the labelled-button minimums.
      expect(buttons[0]).toHaveClass('h-9', 'w-9');
      expect(within(panel('Profile')).getByRole('button', { name: 'Refresh from Tesla' }))
        .toHaveClass('h-auto', 'min-h-11', 'min-w-11', 'md:min-h-10', 'md:min-w-0', 'whitespace-normal');
      expect(within(panel('Sync')).getByRole('button', { name: 'Refresh from Tesla' })).toHaveClass('h-9', 'w-9');
    });
  });

  it('distinguishes an unavailable initial source from a successfully empty profile', () => {
    setup(makeQuery({ isError: true, error: new ApiError('boom', 500), dataUpdatedAt: 0 }));
    expect(within(panel('Sync')).getByText('Unavailable')).toBeInTheDocument();
    expect(within(panel('Sync')).queryByText('Not synced yet')).not.toBeInTheDocument();
    expect(refreshButtons()).toHaveLength(2);
  });

  it('shows unknown sync time when no resolved source envelope is available', () => {
    setup(makeQuery({ dataUpdatedAt: 0 }));
    expect(within(panel('Sync')).getByText('Unknown')).toBeInTheDocument();
    expect(within(panel('Sync')).queryByText('Not synced yet')).not.toBeInTheDocument();
  });

  it('disables all three empty-profile refresh controls while pending without submitting again', () => {
    const mutation = makeMutation({ isPending: true });
    setup(makeQuery({ data: envelope(null, null) }), mutation);
    const buttons = refreshButtons();
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(button);
    }
    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(within(panel('Profile')).getByText('No profile synced yet')).toBeInTheDocument();
  });

  it('retains identity and all lifecycle timestamps while a background refresh is in flight', () => {
    setup(makeQuery({ data: envelope(PROFILE), isLoading: true, isFetching: true }));
    expect(within(panel('Profile')).getByText(PROFILE.full_name)).toBeInTheDocument();
    expect(within(panel('Sync')).getByText(formatDateTime(FETCHED_AT, datePreferences))).toBeInTheDocument();
    expect(within(panel('Account details')).getByText(PROFILE.email)).toBeInTheDocument();
    expect(within(panel('Activity')).getAllByRole('listitem')).toHaveLength(3);
    assertOperationalBriefDisclosure(screen.getByTestId('tesla-account-summary'), 'Retained source data', { contains: true });
    expect(refreshButtons()).toHaveLength(2);
  });

  it('keeps complete long identity values with allocated-container responsive details', () => {
    const profile = { ...PROFILE, full_name: 'Synthetic '.repeat(18), email: `${'synthetic'.repeat(24)}@example.com` };
    setup(makeQuery({ data: envelope(profile) }));
    const hero = within(panel('Profile'));
    expect(hero.getByText(profile.full_name.trim())).toHaveClass('whitespace-normal');
    expect(hero.getByText(profile.email)).toHaveClass('[overflow-wrap:anywhere]');
    const details = panel('Account details');
    expect(details.querySelector('dl')).toHaveClass('@container/kv-list');
    expect(within(details).getByText(profile.email)).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('uses shared neutral lifecycle presentation and semantic confirmed-sync color', () => {
    setup(makeQuery({ data: envelope(PROFILE) }));
    expect(panel('Activity').querySelectorAll('[style]')).toHaveLength(0);
    expect(within(panel('Profile')).getByText('Synced').querySelector('span')).toHaveClass('bg-[var(--semantic-success)]');
    expect(panel('Sync').querySelector('.bg-\\[var\\(--surface-2\\)\\]')).toBeInTheDocument();
  });
});
