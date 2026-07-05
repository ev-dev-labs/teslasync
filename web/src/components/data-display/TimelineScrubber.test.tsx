/**
 * TimelineScrubber — behaviour, interaction, a11y and hardening coverage.
 *
 * The component has a single runtime export (`<TimelineScrubber>`), but it is a
 * dense interactive control, so every facet is exercised:
 *   - slider semantics: role, aria-valuemin/max/now, aria-valuetext time format
 *   - null-safety hardening: NaN / ±Infinity progress + buffered coerce to 0
 *     instead of leaking `NaN%` into the width / aria (regression guard)
 *   - clamping of out-of-range progress into [0, 100]
 *   - marker ticks: labelled + unlabelled aria names, severity colour mapping,
 *     clustered-count badge, and click-to-seek that does NOT bubble to the track
 *   - pointer click-to-seek + the swallowed trailing click (double-seek fix)
 *   - drag-to-scrub with throttled intermediate emissions (SCRUB_INTERVAL_MS)
 *   - hover preview tooltip (formatted speed/power/soc/elevation + time) and its
 *     teardown on mouse-leave, plus the null / absent sampler branches
 *   - keyboard operability (arrows / page / home / end) — the a11y gap this
 *     elevation closes — including bound clamping and ignored keys
 *   - reduced-motion, decorative background, className passthrough, buffered bar
 *
 * i18n is mocked to the English fallback (with {{var}} interpolation for marker
 * labels) and useMotionPreference is mocked so both motion branches are
 * deterministically reachable. getBoundingClientRect is stubbed to a known
 * 200px-wide track so clientX ↔ normalized position is exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      let tpl = fallback ?? '';
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
      }
      return tpl;
    },
  }),
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: vi.fn(() => ({ reduce: false, durationMs: 250 })),
}));

import { TimelineScrubber, type TimelineMarker } from './TimelineScrubber';
import { useMotionPreference } from '@/hooks/useMotionPreference';

/** Track width used by the stub — clientX / 200 is the normalized position. */
const TRACK_WIDTH = 200;

/**
 * Stub `getBoundingClientRect` so `positionAtClientX` has a deterministic
 * basis: jsdom reports width 0, which the component defensively treats as
 * "unmeasurable" and returns 0 for — making every seek land at 0 without this.
 */
function stubTrackRect(width = TRACK_WIDTH, left = 0) {
  const original = HTMLDivElement.prototype.getBoundingClientRect;
  HTMLDivElement.prototype.getBoundingClientRect = function () {
    return {
      width,
      height: 32,
      top: 0,
      left,
      right: left + width,
      bottom: 32,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    HTMLDivElement.prototype.getBoundingClientRect = original;
  };
}

const getTrack = () => screen.getByRole('slider');

beforeEach(() => {
  vi.mocked(useMotionPreference).mockReturnValue({ reduce: false, durationMs: 250 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<TimelineScrubber> — slider semantics', () => {
  it('exposes a labelled slider with min/max/now and formatted valuetext', () => {
    render(<TimelineScrubber progress={0.5} duration={120} onSeek={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: 'Playback progress' });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveAttribute('aria-valuetext', '1:00');
    expect(slider).toHaveAttribute('tabindex', '0');
  });

  it('formats aria-valuetext as m:ss with zero-padded seconds', () => {
    render(<TimelineScrubber progress={0.25} duration={125} onSeek={vi.fn()} />);
    // 125 * 0.25 = 31.25 → round 31s → 0:31
    expect(getTrack()).toHaveAttribute('aria-valuetext', '0:31');
  });

  it('omits aria-valuetext when duration is zero or non-finite', () => {
    const { rerender } = render(
      <TimelineScrubber progress={0.5} duration={0} onSeek={vi.fn()} />,
    );
    expect(getTrack()).not.toHaveAttribute('aria-valuetext');

    rerender(<TimelineScrubber progress={0.5} duration={Infinity} onSeek={vi.fn()} />);
    expect(getTrack()).not.toHaveAttribute('aria-valuetext');
  });

  it('clamps out-of-range progress into the 0..100 aria scale', () => {
    const { rerender } = render(
      <TimelineScrubber progress={1.5} duration={120} onSeek={vi.fn()} />,
    );
    expect(getTrack()).toHaveAttribute('aria-valuenow', '100');

    rerender(<TimelineScrubber progress={-0.5} duration={120} onSeek={vi.fn()} />);
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('<TimelineScrubber> — non-finite hardening (bug fix)', () => {
  it('coerces NaN / Infinity progress to 0 instead of rendering NaN%', () => {
    const { container, rerender } = render(
      <TimelineScrubber progress={NaN} duration={120} onSeek={vi.fn()} />,
    );
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0');
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).toContain('width: 0%');

    rerender(<TimelineScrubber progress={Infinity} duration={120} onSeek={vi.fn()} />);
    expect(getTrack()).toHaveAttribute('aria-valuenow', '0');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('coerces a NaN buffered value to a 0-width bar rather than NaN%', () => {
    const { container } = render(
      <TimelineScrubber progress={0.4} buffered={NaN} duration={120} onSeek={vi.fn()} />,
    );
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders a buffered bar at the given fraction', () => {
    const { container } = render(
      <TimelineScrubber progress={0.4} buffered={0.7} duration={120} onSeek={vi.fn()} />,
    );
    expect(container.innerHTML).toContain('width: 70%');
  });
});

describe('<TimelineScrubber> — markers', () => {
  const markers: TimelineMarker[] = [
    { at: 0.1, kind: 'start', label: 'Trip start' },
    { at: 0.5, kind: 'regen-peak' },
    { at: 0.9, kind: 'low-soc', label: 'Low battery', count: 3 },
  ];

  it('renders one focusable button per marker with an accessible name', () => {
    render(<TimelineScrubber progress={0} duration={120} markers={markers} onSeek={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Trip start at 10%' })).toBeInTheDocument();
    // Unlabelled markers fall back to "<kind> <pct>%".
    expect(screen.getByRole('button', { name: 'regen-peak 50%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Low battery at 90%' })).toBeInTheDocument();
  });

  it('maps marker kind to its severity colour and shows a cluster count badge', () => {
    render(<TimelineScrubber progress={0} duration={120} markers={markers} onSeek={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Trip start at 10%' }).className,
    ).toContain('bg-emerald-400');
    expect(
      screen.getByRole('button', { name: 'Low battery at 90%' }).className,
    ).toContain('bg-rose-300');
    // count > 1 surfaces a numeric badge.
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('seeks to the marker position on click without a second track seek', () => {
    const onSeek = vi.fn();
    render(
      <TimelineScrubber
        progress={0}
        duration={120}
        markers={[{ at: 0.3, kind: 'charge-start', label: 'Charging' }]}
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Charging at 30%' }));
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(0.3);
  });

  it('renders no marker buttons when markers is undefined', () => {
    render(<TimelineScrubber progress={0.5} duration={120} onSeek={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('<TimelineScrubber> — pointer interaction', () => {
  it('seeks to the pressed position and swallows the redundant trailing click', () => {
    const restore = stubTrackRect();
    try {
      const onSeek = vi.fn();
      render(<TimelineScrubber progress={0} duration={120} onSeek={onSeek} />);
      const track = getTrack();

      fireEvent.pointerDown(track, { clientX: 100, button: 0, pointerId: 1 });
      fireEvent.pointerUp(track, { clientX: 100, pointerId: 1 });
      // Browser then dispatches a synthetic click at the same spot.
      fireEvent.click(track, { clientX: 100 });

      // down + up commit the seek; the trailing click is swallowed (was 3×).
      expect(onSeek).toHaveBeenCalledTimes(2);
      expect(onSeek).toHaveBeenLastCalledWith(0.5);
    } finally {
      restore();
    }
  });

  it('emits throttled intermediate seeks while dragging and a final one on release', () => {
    const restore = stubTrackRect();
    const nowSpy = vi.spyOn(performance, 'now');
    try {
      const onSeek = vi.fn();
      render(<TimelineScrubber progress={0} duration={120} onSeek={onSeek} />);
      const track = getTrack();

      nowSpy.mockReturnValue(1000);
      fireEvent.pointerDown(track, { clientX: 0, button: 0, pointerId: 1 }); // seek 0

      nowSpy.mockReturnValue(1100); // +100ms ≥ 50ms → emit
      fireEvent.pointerMove(track, { clientX: 100, pointerId: 1 }); // seek 0.5

      nowSpy.mockReturnValue(1120); // +20ms < 50ms since last emit → throttled
      fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 }); // 0.75 suppressed

      fireEvent.pointerUp(track, { clientX: 200, pointerId: 1 }); // final seek 1

      const seeks = onSeek.mock.calls.map((c) => c[0]);
      expect(seeks).toEqual([0, 0.5, 1]);
      expect(seeks).not.toContain(0.75);
    } finally {
      nowSpy.mockRestore();
      restore();
    }
  });
});

describe('<TimelineScrubber> — hover preview', () => {
  it('shows the formatted sampler values and playback time, then clears on leave', () => {
    const restore = stubTrackRect();
    try {
      const getPreviewAt = vi.fn(() => ({
        at: 0.5,
        speed: '88 km/h',
        power: '42 kW',
        soc: '76%',
        elevation: '340 m',
      }));
      render(
        <TimelineScrubber
          progress={0.5}
          duration={120}
          onSeek={vi.fn()}
          getPreviewAt={getPreviewAt}
        />,
      );
      const track = getTrack();

      fireEvent.mouseMove(track, { clientX: 100 });
      expect(getPreviewAt).toHaveBeenCalledWith(0.5);
      expect(screen.getByText('88 km/h')).toBeInTheDocument();
      expect(screen.getByText('42 kW')).toBeInTheDocument();
      expect(screen.getByText('76%')).toBeInTheDocument();
      expect(screen.getByText('340 m')).toBeInTheDocument();
      expect(screen.getByText('1:00')).toBeInTheDocument(); // 120 * 0.5 = 60s

      fireEvent.mouseLeave(track);
      expect(screen.queryByText('88 km/h')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('shows the time-only tooltip when no sampler is provided', () => {
    const restore = stubTrackRect();
    try {
      render(<TimelineScrubber progress={0.5} duration={100} onSeek={vi.fn()} />);
      fireEvent.mouseMove(getTrack(), { clientX: 50 }); // 0.25 → 25s → 0:25
      expect(screen.getByText('0:25')).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('does not crash or show a tooltip when the sampler returns null and duration is 0', () => {
    const restore = stubTrackRect();
    try {
      const getPreviewAt = vi.fn(() => null);
      render(
        <TimelineScrubber
          progress={0.3}
          duration={0}
          onSeek={vi.fn()}
          getPreviewAt={getPreviewAt}
        />,
      );
      fireEvent.mouseMove(getTrack(), { clientX: 100 });
      expect(getPreviewAt).toHaveBeenCalledWith(0.5);
      expect(screen.queryByText(/km\/h/)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe('<TimelineScrubber> — keyboard operability (a11y)', () => {
  it('nudges by 1% on arrow keys in both directions', () => {
    const onSeek = vi.fn();
    render(<TimelineScrubber progress={0.5} duration={120} onSeek={onSeek} />);
    const track = getTrack();

    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(0.51, 5);

    fireEvent.keyDown(track, { key: 'ArrowLeft' });
    expect(onSeek.mock.calls[1][0]).toBeCloseTo(0.49, 5);

    fireEvent.keyDown(track, { key: 'ArrowUp' });
    expect(onSeek.mock.calls[2][0]).toBeCloseTo(0.51, 5);
  });

  it('jumps by 10% on PageUp/PageDown and to the ends on Home/End', () => {
    const onSeek = vi.fn();
    render(<TimelineScrubber progress={0.5} duration={120} onSeek={onSeek} />);
    const track = getTrack();

    fireEvent.keyDown(track, { key: 'PageUp' });
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(0.6, 5);

    fireEvent.keyDown(track, { key: 'PageDown' });
    expect(onSeek.mock.calls[1][0]).toBeCloseTo(0.4, 5);

    fireEvent.keyDown(track, { key: 'Home' });
    expect(onSeek).toHaveBeenNthCalledWith(3, 0);

    fireEvent.keyDown(track, { key: 'End' });
    expect(onSeek).toHaveBeenNthCalledWith(4, 1);
  });

  it('clamps keyboard moves at the track bounds', () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <TimelineScrubber progress={1} duration={120} onSeek={onSeek} />,
    );
    fireEvent.keyDown(getTrack(), { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(1);

    rerender(<TimelineScrubber progress={0} duration={120} onSeek={onSeek} />);
    fireEvent.keyDown(getTrack(), { key: 'ArrowLeft' });
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('ignores keys that are not slider controls', () => {
    const onSeek = vi.fn();
    render(<TimelineScrubber progress={0.5} duration={120} onSeek={onSeek} />);
    fireEvent.keyDown(getTrack(), { key: 'a' });
    fireEvent.keyDown(getTrack(), { key: 'Enter' });
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('<TimelineScrubber> — presentation', () => {
  it('renders the decorative background node behind the track', () => {
    render(
      <TimelineScrubber
        progress={0.5}
        duration={120}
        onSeek={vi.fn()}
        background={<div data-testid="spark" />}
      />,
    );
    expect(screen.getByTestId('spark')).toBeInTheDocument();
  });

  it('forwards a custom className onto the root element', () => {
    const { container } = render(
      <TimelineScrubber
        progress={0.5}
        duration={120}
        onSeek={vi.fn()}
        className="my-scrubber"
      />,
    );
    expect(container.firstChild).toHaveClass('my-scrubber');
  });

  it('respects prefers-reduced-motion while keeping all content intact', () => {
    vi.mocked(useMotionPreference).mockReturnValue({ reduce: true, durationMs: 0 });
    render(<TimelineScrubber progress={0.5} duration={120} onSeek={vi.fn()} />);
    expect(useMotionPreference).toHaveBeenCalled();
    const slider = getTrack();
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuenow', '50');
  });
});
