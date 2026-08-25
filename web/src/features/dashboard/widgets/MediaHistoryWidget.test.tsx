/**
 * MediaHistoryWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's recently-played-media tile. Its surface under
 * test:
 *
 *   1. Responsive layout keyed off `size.cols`:
 *        - standard (cols ≥ 2) → a titled shell + a WidgetEventFeed of tracks
 *          (each row: "🎵 {title} — {artist}" + a source subtitle),
 *        - compact  (cols ≤ 1) → a single-line "last track" summary.
 *   2. The `sourceLabel` mapping it owns: `usb` → the "USB" acronym, everything
 *      else Capitalised (`bluetooth` → "Bluetooth", `spotify` → "Spotify").
 *   3. The playing/paused colour branch: a `playing` row is green (#22c55e),
 *      every other status is neutral grey (#6b7280).
 *   4. The compact "last track" label branches: title + artist, title only
 *      (artist missing — no dangling em dash), and the "No tracks played"
 *      fallback when the newest entry has no title.
 *   5. Loading / error / empty states (never a blank panel). The error branch
 *      is the key regression guard — the widget now forwards `error` so a fetch
 *      failure surfaces the shared QueryError panel instead of masquerading as
 *      the "No tracks played" empty state.
 *   6. Freshness-control refresh → refetch.
 *   7. Null-safety of a malformed / partial payload (no crash; a sibling row
 *      still renders).
 *   8. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles`; with no vehicle the query is scoped to ''.
 *
 * Strategy (mirrors AnalyticsSummaryWidget.test.tsx +
 * BatteryDegradationTrendWidget.test.tsx):
 *   - The data hooks are mocked with hoisted vi.fn()s so the network is never
 *     touched and every render is deterministic.
 *   - The global test-setup (src/test-setup.ts) already mocks useSettings +
 *     useTimezone, so the REAL useDateFormat (used by both the WidgetEventFeed
 *     and the freshness chip) composes without needing a QueryClient.
 *   - react-i18next resolves the developer fallback string, so assertions read
 *     the English defaults.
 *   - matchMedia is shimmed so framer-motion (via the freshness chip) settles.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls useNavigate.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

const { mediaMock, vehiclesMock } = vi.hoisted(() => ({
  mediaMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
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

vi.mock('@/api/hooks/useVehicleSystems', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicleSystems')>(
    '@/api/hooks/useVehicleSystems',
  );
  return { ...actual, useMediaHistory: (...args: unknown[]) => mediaMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return { ...actual, useVehicles: () => vehiclesMock() };
});

import MediaHistoryWidget from './MediaHistoryWidget';
import type { WidgetSize } from './types';
import type { MediaSnapshot } from '@/api/types';

/* ── Fixtures ─────────────────────────────────────────────────────── */

const MUSIC = '\uD83C\uDFB5'; // 🎵 — the feed-title prefix
const EM = '\u2014'; // — the title/artist separator + em-dash placeholder

type Item = Partial<MediaSnapshot> & { id: number };

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

// list[0] is the newest — the compact view's "last track". Distinct sources
// exercise every `sourceLabel` branch; distinct statuses exercise the colour
// branch (Playing → green, everything else → grey).
const ITEMS: Item[] = [
  {
    id: 1,
    vehicle_id: 7,
    now_playing_title: 'Bohemian Rhapsody',
    now_playing_artist: 'Queen',
    playback_status: 'Playing',
    playback_source: 'usb',
    created_at: iso(1),
  },
  {
    id: 2,
    vehicle_id: 7,
    now_playing_title: 'Yesterday',
    now_playing_artist: 'The Beatles',
    playback_status: 'Paused',
    playback_source: 'bluetooth',
    created_at: iso(2),
  },
  {
    id: 3,
    vehicle_id: 7,
    now_playing_title: 'Clocks',
    now_playing_artist: 'Coldplay',
    playback_status: 'stopped',
    playback_source: 'spotify',
    created_at: iso(3),
  },
];

interface FakeQuery {
  data?: unknown;
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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <MediaHistoryWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

/** True when some rendered element paints the given CSS colour (jsdom may keep
 *  the hex or normalise it to rgb()). Used to assert the playing/paused branch. */
function hasColour(container: HTMLElement, hex: string, rgb: string): boolean {
  return Array.from(container.querySelectorAll<HTMLElement>('[style]')).some(
    (el) => el.style.color === hex || el.style.color === rgb,
  );
}

beforeEach(() => {
  mediaMock.mockReset();
  vehiclesMock.mockReset();
  mediaMock.mockReturnValue(makeQuery({ data: ITEMS }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('MediaHistoryWidget', () => {
  it('renders the titled feed with every track and its capitalised source label', () => {
    const { container } = renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Media History')).toBeInTheDocument();

    // Each history row renders "🎵 {title} — {artist}".
    expect(screen.getByText(`${MUSIC} Bohemian Rhapsody ${EM} Queen`)).toBeInTheDocument();
    expect(screen.getByText(`${MUSIC} Yesterday ${EM} The Beatles`)).toBeInTheDocument();
    expect(screen.getByText(`${MUSIC} Clocks ${EM} Coldplay`)).toBeInTheDocument();

    // sourceLabel: `usb` → the acronym, others Capitalised.
    expect(screen.getByText('USB')).toBeInTheDocument();
    expect(screen.getByText('Bluetooth')).toBeInTheDocument();
    expect(screen.getByText('Spotify')).toBeInTheDocument();

    // The compact single-line summary is NOT used at 2 cols.
    expect(screen.queryByText(`Bohemian Rhapsody ${EM} Queen`)).not.toBeInTheDocument();

    // All three rows reached the feed.
    expect(container.querySelectorAll('[style]').length).toBeGreaterThanOrEqual(3);
  });

  it('colours the playing row green and non-playing rows neutral grey', () => {
    const { container } = renderWidget();

    // Playing → #22c55e; Paused/stopped → #6b7280.
    expect(hasColour(container, '#22c55e', 'rgb(34, 197, 94)')).toBe(true);
    expect(hasColour(container, '#6b7280', 'rgb(107, 114, 128)')).toBe(true);
  });

  it('compact layout summarises the newest track and drops the feed', () => {
    renderWidget({ cols: 1, rows: 2 });

    // Newest entry (list[0]) as a single line, WITHOUT the feed's 🎵 prefix.
    expect(screen.getByText(`Bohemian Rhapsody ${EM} Queen`)).toBeInTheDocument();
    // The title still shows in compact (the widget always passes it).
    expect(screen.getByText('Media History')).toBeInTheDocument();

    // Feed-only artefacts (emoji rows + source subtitles) are gone.
    expect(screen.queryByText(`${MUSIC} Bohemian Rhapsody ${EM} Queen`)).not.toBeInTheDocument();
    expect(screen.queryByText('USB')).not.toBeInTheDocument();
    expect(screen.queryByText('Bluetooth')).not.toBeInTheDocument();
  });

  it('compact layout shows the title alone when the artist is missing (no dangling em dash)', () => {
    mediaMock.mockReturnValue(
      makeQuery({
        data: [{ id: 9, vehicle_id: 7, now_playing_title: 'Solo Track', created_at: iso(1) }] as Item[],
      }),
    );
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('Solo Track')).toBeInTheDocument();
    // The pre-hardening code rendered "Solo Track — —"; that must never appear.
    expect(screen.queryByText(`Solo Track ${EM} ${EM}`)).not.toBeInTheDocument();
  });

  it('compact layout falls back to "No tracks played" when the newest entry has no title', () => {
    mediaMock.mockReturnValue(
      makeQuery({ data: [{ id: 9, vehicle_id: 7, created_at: iso(1) }] as Item[] }),
    );
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No tracks played')).toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no history', () => {
    mediaMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No tracks played')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No track summary rendered.
    expect(screen.queryByText(/Bohemian Rhapsody/)).not.toBeInTheDocument();
  });

  it('standard layout shows the feed empty message while keeping the titled shell', () => {
    mediaMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('Media History')).toBeInTheDocument();
    expect(screen.getByText('No tracks played')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No track rows.
    expect(screen.queryByText(new RegExp(MUSIC))).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the query is loading', () => {
    mediaMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No shell content while loading.
    expect(screen.queryByText('Media History')).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(MUSIC))).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the query fails', () => {
    // Regression guard: the widget now forwards `error` so a fetch failure is
    // distinguishable from genuinely-empty data. Before the fix the header +
    // empty feed rendered and the failure masqueraded as "No tracks played".
    mediaMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading empty state must NOT appear on error.
    expect(screen.queryByText('No tracks played')).not.toBeInTheDocument();
    expect(screen.queryByText('Media History')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: /^Refresh/i })).not.toBeInTheDocument();
  });

  it('refetches when the freshness control is activated', () => {
    const q = makeQuery({ data: ITEMS });
    mediaMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: a malformed payload renders without crashing and keeps the valid row', () => {
    // A bare `{ id }` row (no title/artist/source/status/created_at) must not
    // throw — every field is coalesced — and the well-formed sibling survives.
    mediaMock.mockReturnValue(
      makeQuery({
        data: [
          { id: 50 } as Item,
          {
            id: 51,
            vehicle_id: 7,
            now_playing_title: 'Valid Song',
            now_playing_artist: 'Real Artist',
            playback_source: 'usb',
            created_at: iso(1),
          },
        ] as Item[],
      }),
    );

    expect(() => renderWidget()).not.toThrow();

    // Both rows reached the feed (each row title starts with the 🎵 prefix).
    expect(screen.getAllByText(new RegExp(MUSIC))).toHaveLength(2);
    expect(screen.getByText(`${MUSIC} Valid Song ${EM} Real Artist`)).toBeInTheDocument();
  });

  it('scopes the query to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();
    expect(mediaMock).toHaveBeenCalledWith('7');
  });

  it('scopes the query to the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(mediaMock).toHaveBeenCalledWith('42');
  });

  it('scopes the query to the empty string (disabling it) when no vehicle exists', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(mediaMock).toHaveBeenCalledWith('');
  });
});
