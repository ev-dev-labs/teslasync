/**
 * MediaNavigationPanel — behaviour + regression coverage.
 *
 * The panel is purely presentational (props in, DOM out — no buttons, inputs,
 * or async), so this suite exercises every branch and the hardening applied
 * while elevating it:
 *   - REGRESSION (real bug): the playback-status <Badge> was passed `color=`
 *     with `green`/`amber`/`neutral` values, but the shared Badge only reads a
 *     `variant` prop keyed by `success`/`warning`/`neutral`. The result was that
 *     the badge ALWAYS rendered neutral-grey regardless of playback state. The
 *     fix maps Playing→success (green), Paused→warning (amber), else→neutral, so
 *     these tests assert on the concrete variant classes to lock the mapping in.
 *   - SI correctness: `miles_to_arrival` is stored by the backend normalize
 *     pipeline as SI *metres* (raw miles × 1609.344 — see internal/tesla/units),
 *     despite its legacy name. The panel converts metres → the user's display
 *     unit via convertDistanceFromSI, so 5 000 m must render as "5.00 km" (and
 *     16 093.44 m as "10.00 mi"), never a raw "5,000".
 *   - null / Go-nil safety: `<nil>` sentinels collapse to translated
 *     placeholders; absent distance / eta / presence flags simply omit their
 *     rows instead of leaking `undefined`.
 *   - a11y: decorative emoji glyphs are wrapped in aria-hidden spans and the
 *     panel exposes an accessible heading.
 *
 * `react-i18next` is stubbed to echo the English fallback; `useUnits` is stubbed
 * with a hoisted, per-test-mutable display unit so the same suite covers both
 * metric and imperial rendering. No network is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { MediaNavigationPanel } from './MediaNavigationPanel';
import type { MediaSnapshot, LocationSnapshot } from '@/api/types';
import { BADGE_VARIANTS } from '@/components/ui';

// Per-test-mutable display unit. `vi.hoisted` guarantees the object exists
// before the hoisted `vi.mock` factory below closes over it.
const unitState = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi' | 'ft' }));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: unitState.distance } }),
}));

// Echo the English fallback so assertions read naturally; option objects fall
// through to the key (this component only passes plain-string fallbacks).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

function media(partial: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 1,
    vehicle_id: 7,
    created_at: '2026-07-05T00:00:00Z',
    ...partial,
  };
}

function location(partial: Partial<LocationSnapshot> = {}): LocationSnapshot {
  return {
    id: 1,
    vehicle_id: 7,
    created_at: '2026-07-05T00:00:00Z',
    ...partial,
  };
}

beforeEach(() => {
  unitState.distance = 'km';
});

describe('MediaNavigationPanel', () => {
  it('always renders the accessible section heading and both column labels', () => {
    render(<MediaNavigationPanel mediaData={null} locationData={null} />);
    expect(screen.getByRole('heading', { name: 'Media & Navigation' })).toBeInTheDocument();
    // The sub-section labels render regardless of data so the panel is never blank.
    expect(screen.getByText('Now Playing')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
  });

  it('shows explicit empty states (never a blank panel) when both sources are null', () => {
    render(<MediaNavigationPanel mediaData={null} locationData={null} />);
    expect(screen.getByText('No media data')).toBeInTheDocument();
    expect(screen.getByText('No location data')).toBeInTheDocument();
    // No card content leaks through the empty branch.
    expect(screen.queryByText('Nothing playing')).not.toBeInTheDocument();
  });

  it('renders the now-playing title, artist, source chip and status', () => {
    render(
      <MediaNavigationPanel
        mediaData={media({
          now_playing_title: 'Bohemian Rhapsody',
          now_playing_artist: 'Queen',
          playback_source: 'Spotify',
          playback_status: 'Playing',
        })}
        locationData={null}
      />,
    );
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Queen')).toBeInTheDocument();
    expect(screen.getByText('Spotify')).toBeInTheDocument();
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });

  it('collapses Go-nil sentinels to translated placeholders', () => {
    render(
      <MediaNavigationPanel
        mediaData={media({
          now_playing_title: '<nil>', // Go's fmt.Sprintf("%v", nil)
          now_playing_artist: undefined,
          playback_status: 'nil',
        })}
        locationData={null}
      />,
    );
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.getByText('Unknown artist')).toBeInTheDocument();
    // The raw sentinels must never reach the DOM, and a nil status hides the badge.
    expect(screen.queryByText('<nil>')).not.toBeInTheDocument();
    expect(screen.queryByText('nil')).not.toBeInTheDocument();
  });

  it('colours the status badge success (green) while Playing — regression for the color/variant bug', () => {
    render(
      <MediaNavigationPanel
        mediaData={media({ playback_status: 'Playing' })}
        locationData={null}
      />,
    );
    const badge = screen.getByText('Playing');
    // Before the fix this badge fell through to the neutral default (bg-gray-100).
    expect(badge).toHaveClass('bg-green-100');
    expect(badge).not.toHaveClass(BADGE_VARIANTS.neutral);
  });

  it('colours the status badge warning (amber) while Paused', () => {
    render(
      <MediaNavigationPanel
        mediaData={media({ playback_status: 'Paused' })}
        locationData={null}
      />,
    );
    expect(screen.getByText('Paused')).toHaveClass('bg-yellow-100');
  });

  it('falls back to the neutral badge for any other status', () => {
    render(
      <MediaNavigationPanel
        mediaData={media({ playback_status: 'Stopped' })}
        locationData={null}
      />,
    );
    const badge = screen.getByText('Stopped');
    expect(badge).toHaveClass(BADGE_VARIANTS.neutral);
    expect(badge).not.toHaveClass('bg-green-100');
  });

  it('converts miles_to_arrival from SI metres to the km display unit', () => {
    render(
      <MediaNavigationPanel
        mediaData={null}
        locationData={location({
          destination_name: 'Supercharger — Mountain View',
          miles_to_arrival: 5000, // SI metres, not miles
          minutes_to_arrival: 15,
        })}
      />,
    );
    expect(screen.getByText('Supercharger — Mountain View')).toBeInTheDocument();
    // 5 000 m ÷ 1000 = 5.00 km — proves the value is treated as metres, not a raw scalar.
    expect(screen.getByText('5.00 km')).toBeInTheDocument();
    expect(screen.queryByText(/5,000/)).not.toBeInTheDocument();
    expect(screen.getByText('15 min')).toBeInTheDocument();
  });

  it('honours the imperial display preference (metres → miles)', () => {
    unitState.distance = 'mi';
    render(
      <MediaNavigationPanel
        mediaData={null}
        locationData={location({
          destination_name: 'Home',
          miles_to_arrival: 16093.44, // exactly 10 miles in metres
        })}
      />,
    );
    expect(screen.getByText('10.00 mi')).toBeInTheDocument();
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
  });

  it('shows the no-active-destination hint (not distance) when a fix has no route', () => {
    render(
      <MediaNavigationPanel
        mediaData={null}
        locationData={location({ located_at_home: true })}
      />,
    );
    expect(screen.getByText('No active destination')).toBeInTheDocument();
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/min$/)).not.toBeInTheDocument();
  });

  it('omits distance and eta rows when those fields are absent', () => {
    render(
      <MediaNavigationPanel
        mediaData={null}
        locationData={location({ destination_name: 'Office', miles_to_arrival: undefined })}
      />,
    );
    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/min$/)).not.toBeInTheDocument();
  });

  it('renders a presence chip only for each active place flag', () => {
    render(
      <MediaNavigationPanel
        mediaData={null}
        locationData={location({
          located_at_home: true,
          located_at_work: false,
          located_at_favorite: true,
        })}
      />,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Favorite')).toBeInTheDocument();
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('marks decorative emoji glyphs as aria-hidden for screen readers', () => {
    render(
      <MediaNavigationPanel
        mediaData={null}
        locationData={location({ located_at_home: true })}
      />,
    );
    const glyph = screen.getByText('Home').querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveTextContent('🏠');
  });
});
