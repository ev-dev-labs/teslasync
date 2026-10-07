/**
 * MediaNowPlayingWidget — behaviour, branch, null-safety and a11y coverage for
 * the dashboard's "now playing" media widget.
 *
 * What this file pins:
 *   - the two exported pure helpers `progressPercent` / `volumePercent` — their
 *     ratio maths, the 0-return guards for a non-positive duration / scale-max
 *     (the divide-by-zero fix that used to yield a `NaN%` bar width), and the
 *     0–100 clamp for over-driven / negative readings;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. an empty/undefined fleet → id 0 so the query stays
 *     disabled) and that the 5 s poll interval is forwarded to the hook;
 *   - every render state fanned out by `WidgetShell` — the loading skeleton, the
 *     "Nothing playing" empty state (never a blank panel), and the error
 *     affordance (red freshness dot) that still paints an empty panel;
 *   - the responsive variants — compact 1×1 (title + artist only, no header /
 *     bars / chip), standard non-tall (album + volume hidden, source shown), and
 *     tall (album, source, and the volume bar);
 *   - the REGRESSION FIX at the heart of this elevation: the volume bar's fill is
 *     no longer the same colour as its track (it was invisible), and it now
 *     survives a `0` scale-max without emitting `NaN%`;
 *   - a11y — decorative icons are hidden from the a11y tree and both meters are
 *     real `role="progressbar"` elements with bounded aria-value* attributes;
 *   - the "Refresh" freshness control wiring back to the query's `refetch`.
 *
 * Strategy: the two data hooks (`useVehicles`, `useMediaLatest`) live in the same
 * module and are mocked together so no network is touched and every query state
 * is controllable per-test. i18n is a passthrough that honours the English
 * default so the visible copy ("Now Playing", "Playing", "Nothing playing",
 * "Volume", "Refresh") is asserted verbatim. `formatDurationClock` is left
 * un-mocked and fed millisecond values so its "m:ss" output is deterministic.
 * The widget is rendered inside a MemoryRouter because the shared feedback
 * components it composes may reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { MediaSnapshot } from '@/api/types';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useVehiclesMock, useMediaLatestMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useMediaLatestMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
  useMediaLatest: (id: number, refetchInterval?: number) =>
    useMediaLatestMock(id, refetchInterval),
}));

import MediaNowPlayingWidget, { progressPercent, volumePercent } from './MediaNowPlayingWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeMedia(over: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    now_playing_title: 'Bohemian Rhapsody',
    now_playing_artist: 'Queen',
    now_playing_album: 'A Night at the Opera',
    now_playing_station: 'Classic Rock FM',
    now_playing_duration: 185_000,
    now_playing_elapsed: 65_000,
    playback_status: 'Playing',
    playback_source: 'Spotify',
    audio_volume: 5,
    audio_volume_max: 10,
    audio_volume_increment: 0.333,
    created_at: new Date().toISOString(),
    ...over,
  };
}

interface MediaResult {
  data: MediaSnapshot | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<MediaResult> = {}): MediaResult {
  return {
    data: makeMedia(),
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <MediaNowPlayingWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useMediaLatestMock.mockReset();
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useMediaLatestMock.mockReturnValue(makeResult());
});

// ── Pure helper: progressPercent ─────────────────────────────────────────────

describe('progressPercent', () => {
  it('returns 0 when the duration is unknown or non-positive', () => {
    expect(progressPercent(50, 0)).toBe(0);
    expect(progressPercent(50, -10)).toBe(0);
  });

  it('computes elapsed / duration as a percentage', () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(90, 180)).toBe(50);
  });

  it('clamps out-of-range readings into 0–100', () => {
    expect(progressPercent(300, 200)).toBe(100); // over-run clamps down
    expect(progressPercent(-10, 200)).toBe(0); // negative clamps up
  });
});

// ── Pure helper: volumePercent (the divide-by-zero fix) ──────────────────────

describe('volumePercent', () => {
  it('returns 0 (never NaN) when the scale max is unusable', () => {
    expect(volumePercent(5, 0)).toBe(0);
    expect(volumePercent(5, -3)).toBe(0);
    expect(Number.isNaN(volumePercent(0, 0))).toBe(false);
  });

  it('computes volume / max as a percentage', () => {
    expect(volumePercent(5, 10)).toBe(50);
    expect(volumePercent(0, 11)).toBe(0);
  });

  it('clamps an over-driven volume to 100', () => {
    expect(volumePercent(15, 10)).toBe(100);
  });
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe('MediaNowPlayingWidget — vehicle resolution', () => {
  it('reads media for the explicit vehicleId prop with the 5s poll', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(useMediaLatestMock).toHaveBeenCalledWith(42, 5000);
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useMediaLatestMock).toHaveBeenCalledWith(7, 5000);
  });

  it('falls back to id 0 (query disabled) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useMediaLatestMock).toHaveBeenCalledWith(0, 5000);
  });

  it('tolerates an undefined vehicles list without throwing', () => {
    useVehiclesMock.mockReturnValue({ data: undefined });
    expect(() => renderWidget()).not.toThrow();
    expect(useMediaLatestMock).toHaveBeenCalledWith(0, 5000);
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('MediaNowPlayingWidget — states', () => {
  it('renders a loading skeleton while the media query is pending', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Nothing playing')).toBeNull();
  });

  it('shows the empty state (never a blank panel) when nothing is playing', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ data: null }));
    renderWidget();
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('surfaces a red freshness dot on error but still paints an empty panel', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ isError: true, dataUpdatedAt: 0, data: null }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
  });
});

// ── Standard (non-tall) variant: { cols: 2, rows: 1 } ────────────────────────

describe('MediaNowPlayingWidget — standard (non-tall)', () => {
  const STD: WidgetSize = { cols: 2, rows: 1 };

  it('renders the "Now Playing" header, title and artist', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ now_playing_title: 'Song A', now_playing_artist: 'Artist B' }) }),
    );
    renderWidget(STD);
    expect(screen.getByText('Now Playing')).toBeInTheDocument();
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Artist B')).toBeInTheDocument();
  });

  it('hides the album line and the volume bar at non-tall size', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ now_playing_album: 'Hidden Album', audio_volume: 5 }) }),
    );
    renderWidget(STD);
    expect(screen.queryByText('Hidden Album')).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Volume' })).toBeNull();
  });

  it('shows the playback source, falling back to the station name', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ playback_source: undefined, now_playing_station: 'Radio X' }) }),
    );
    renderWidget(STD);
    expect(screen.getByText('Radio X')).toBeInTheDocument();
  });

  it('renders the playback progress bar + m:ss clock when a duration is known', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ now_playing_elapsed: 65_000, now_playing_duration: 185_000 }) }),
    );
    renderWidget(STD);
    const bar = screen.getByRole('progressbar', { name: 'Playback progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '35'); // 65s / 185s ≈ 35%
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('3:05')).toBeInTheDocument();
  });

  it('omits the progress bar entirely when the duration is unknown', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ data: makeMedia({ now_playing_duration: 0 }) }));
    renderWidget(STD);
    expect(screen.queryByRole('progressbar', { name: 'Playback progress' })).toBeNull();
  });
});

// ── Playback status chip ─────────────────────────────────────────────────────

describe('MediaNowPlayingWidget — playback chip', () => {
  it('shows the "Playing" chip while playing', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ data: makeMedia({ playback_status: 'Playing' }) }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });

  it('hides the chip when the track is paused', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ data: makeMedia({ playback_status: 'Paused' }) }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.queryByText('Playing')).toBeNull();
  });
});

// ── Tall variant: { cols: 2, rows: 2 } ───────────────────────────────────────

describe('MediaNowPlayingWidget — tall', () => {
  const TALL: WidgetSize = { cols: 2, rows: 2 };

  it('shows the album line when present', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ now_playing_album: 'A Night at the Opera' }) }),
    );
    renderWidget(TALL);
    expect(screen.getByText('A Night at the Opera')).toBeInTheDocument();
  });

  it('renders a labelled, VISIBLE volume bar reflecting the level', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ audio_volume: 5, audio_volume_max: 10 }) }),
    );
    renderWidget(TALL);
    const vol = screen.getByRole('progressbar', { name: 'Volume' });
    expect(vol).toHaveAttribute('aria-valuenow', '5');
    expect(vol).toHaveAttribute('aria-valuemax', '10');
    // Regression pin: the fill must NOT reuse the track colour (it was invisible).
    const fill = vol.querySelector('div');
    expect(fill?.className).toContain('bg-[var(--text-secondary)]');
    expect(fill?.className).not.toContain('bg-[var(--surface-2)]');
  });

  it('hides the volume bar when no volume reading is present', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ data: makeMedia({ audio_volume: undefined }) }));
    renderWidget(TALL);
    expect(screen.queryByRole('progressbar', { name: 'Volume' })).toBeNull();
  });

  it('still renders the volume bar at zero volume (0 is a valid level)', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ audio_volume: 0, audio_volume_max: 10 }) }),
    );
    renderWidget(TALL);
    const vol = screen.getByRole('progressbar', { name: 'Volume' });
    expect(vol).toHaveAttribute('aria-valuenow', '0');
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('MediaNowPlayingWidget — compact', () => {
  const CMP: WidgetSize = { cols: 1, rows: 1 };

  it('shows only the title + artist and suppresses the header, bars and chip', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({
        data: makeMedia({
          now_playing_title: 'Compact Song',
          now_playing_artist: 'CA',
          playback_status: 'Playing',
          now_playing_duration: 185_000,
        }),
      }),
    );
    renderWidget(CMP);
    expect(screen.getByText('Compact Song')).toBeInTheDocument();
    expect(screen.getByText('CA')).toBeInTheDocument();
    expect(screen.queryByText('Now Playing')).toBeNull(); // title-less shell
    expect(screen.queryByRole('progressbar')).toBeNull(); // no bars
    expect(screen.queryByText('Playing')).toBeNull(); // no chip
  });

  it('floors a missing title and artist to an em-dash', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ now_playing_title: undefined, now_playing_artist: undefined }) }),
    );
    renderWidget(CMP);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('MediaNowPlayingWidget — a11y', () => {
  it('hides the decorative header icon from the accessibility tree', () => {
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('exposes the playback progress bar with bounded aria-value* attributes', () => {
    useMediaLatestMock.mockReturnValue(
      makeResult({ data: makeMedia({ now_playing_elapsed: 90_000, now_playing_duration: 180_000 }) }),
    );
    renderWidget({ cols: 2, rows: 2 });
    const bar = screen.getByRole('progressbar', { name: 'Playback progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
  });
});

// ── Refresh wiring ───────────────────────────────────────────────────────────

describe('MediaNowPlayingWidget — refresh', () => {
  it('refetches when the freshness control is activated', () => {
    const refetch = vi.fn();
    useMediaLatestMock.mockReturnValue(makeResult({ refetch }));
    renderWidget({ cols: 2, rows: 2 });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
