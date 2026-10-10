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
import { setGlobalPrecision } from '@/lib/numberFormat';
import { toReconstructionMarkers, type ReconstructionResult } from '@/features/dashcam/lib/timelineAlignment';

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
  setGlobalPrecision(0);
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

  describe('<TimelineScrubber> — read-only event overview', () => {
    const markers: TimelineMarker[] = [
      { id: 'clip-end', at: 0.75, kind: 'stop', label: 'Clip end', timeLabel: 't=60s' },
      { id: 'incident-a', at: 0.25, kind: 'event', label: 'Brake', description: 'Hard brake: z=4.2', count: 3 },
      { id: 'clip-start', at: 0.25, kind: 'start', label: 'Clip start', timeLabel: 't=0s' },
      { id: 'incident-b', at: 1, kind: 'event', label: 'Post-roll', description: 'Door opened at t=90s' },
    ];

    it('retains all caller geometry, order, identity, evidence and accessible names without playback', () => {
      const { container, rerender } = render(
        <TimelineScrubber mode="readOnly" label="Reconstruction events" markers={markers} background={<div data-testid="overview-background" />} />,
      );
      expect(screen.getByRole('group', { name: 'Reconstruction events' })).toBeInTheDocument();
      const items = screen.getAllByRole('listitem');
      expect(items.map((item) => item.dataset.markerId)).toEqual(markers.map((marker) => marker.id));
      expect(items.map((item) => item.style.left)).toEqual(['75%', '25%', '25%', '100%']);
      expect(items[1]).toHaveAccessibleName('Brake — Hard brake: z=4.2 — 3 events');
      expect(items[1]).toHaveAttribute('title', 'Brake — Hard brake: z=4.2 — 3 events');
      expect(items[0]).toHaveAccessibleName('Clip end — t=60s');
      expect(items[3]).toHaveAccessibleName('Post-roll — Door opened at t=90s');
      expect(screen.getByTestId('overview-background').parentElement).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(container.querySelector('[tabindex]')).toBeNull();
      expect(container.querySelector('[data-timeline-playhead]')).toBeNull();
      expect(container.querySelector('[data-timeline-ghost-playhead]')).toBeNull();
      expect(container.querySelector('[aria-valuenow]')).toBeNull();
      expect(container.querySelector('[style*="width"]')).toBeNull();
      expect(items[1]).toHaveClass('bg-[var(--surface-2)]');
      rerender(<TimelineScrubber mode="readOnly" markers={[markers[2], markers[1], markers[0], markers[3]]} />);
      expect(screen.getAllByRole('listitem')[2]).toBe(items[0]);
    });

    it('renders the full prepared ReconstructionTimeline window and every statistical event without reordering or truncation', () => {
      const reconstruction: ReconstructionResult = {
        clipWindow: { startSeconds: 0, endSeconds: 60 },
        reconstructionWindow: { startSeconds: -30, endSeconds: 90 },
        series: [],
        incidentSequence: [
          { id: 'post', atSeconds: 90, kind: 'state_change', signal: 'Door', description: 'Door opened in post-roll', zScore: 0 },
          { id: 'pre', atSeconds: -15, kind: 'hard_brake', signal: 'Speed', description: 'Pre-roll braking (z=4.2)', zScore: 4.2 },
          { id: 'clip', atSeconds: 0, kind: 'signal_spike', signal: 'Power', description: 'Clip-start power spike (z=5.1)', zScore: 5.1 },
        ],
        overallQuality: 'partial',
        qualityNotes: ['Retained by caller'],
      };
      const prepared = toReconstructionMarkers(reconstruction);
      render(<TimelineScrubber mode="readOnly" markers={prepared} duration={120} clockOriginSeconds={-30} formatTime={(seconds) => `t=${seconds}s`} />);
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(prepared.length);
      expect(items.map((item) => item.style.left)).toEqual(['25%', '75%', '100%', '12.5%', '25%']);
      expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
        'Clip start — t=0s',
        'Clip end — t=60s',
        'Door opened in post-roll — t=90s',
        'Pre-roll braking (z=4.2) — t=-15s',
        'Clip-start power spike (z=5.1) — t=0s',
      ]);
      expect(reconstruction.incidentSequence.map((event) => event.id)).toEqual(['post', 'pre', 'clip']);
    });

    it('does not handle click, hover, drag or seeking keys or install seek listeners', () => {
      const addListener = vi.spyOn(window, 'addEventListener');
      const formatTime = vi.fn((seconds: number) => `t=${seconds}s`);
      const { container } = render(
        <TimelineScrubber mode="readOnly" markers={markers} duration={120} clockOriginSeconds={-30} formatTime={formatTime} />,
      );
      const overview = screen.getByRole('group');
      const initialFormatCalls = formatTime.mock.calls.length;
      fireEvent.click(overview, { clientX: 100 });
      fireEvent.click(screen.getAllByRole('listitem')[0]);
      fireEvent.pointerDown(overview, { clientX: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(overview, { clientX: 150, pointerId: 1 });
      fireEvent.pointerUp(overview, { clientX: 150, pointerId: 1 });
      fireEvent.mouseMove(overview, { clientX: 100 });
      expect(fireEvent.keyDown(overview, { key: 'ArrowRight' })).toBe(true);
      expect(fireEvent.keyDown(overview, { key: 'End' })).toBe(true);
      expect(formatTime).toHaveBeenCalledTimes(initialFormatCalls);
      expect(addListener.mock.calls.filter(([event]) => event === 'pointerup' || event === 'pointercancel')).toEqual([]);
      expect(container.querySelector('[data-timeline-playhead]')).toBeNull();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('uses explicit caller clock origin and formatting, not window elapsed time', () => {
      render(
        <TimelineScrubber mode="readOnly" markers={markers} duration={120} clockOriginSeconds={-30} formatTime={(seconds) => `t=${seconds}s`} />,
      );
      expect(screen.getAllByRole('listitem')[1]).toHaveAccessibleName('Brake — Hard brake: z=4.2 — t=0s — 3 events');
      expect(screen.getByText('t=-30s')).toBeInTheDocument();
      expect(screen.getByText('t=90s')).toBeInTheDocument();
      expect(screen.queryByText('0:30')).not.toBeInTheDocument();
    });

    it('preserves caller-prepared boundary and marker labels without interpreting clocks', () => {
      render(
        <TimelineScrubber
          mode="readOnly"
          duration={null}
          clockOriginSeconds={null}
          startLabel="Before clip (camera clock)"
          endLabel="After clip (UTC+2)"
          markers={[{ at: 0.4, kind: 'event', label: 'Signal change', timeLabel: '14:03:00 UTC+2', description: 'Coverage: partial' }]}
        />,
      );
      expect(screen.getByText('Before clip (camera clock)')).toBeInTheDocument();
      expect(screen.getByText('After clip (UTC+2)')).toBeInTheDocument();
      expect(screen.getByRole('listitem')).toHaveAccessibleName('Signal change — Coverage: partial — 14:03:00 UTC+2');
      expect(screen.getByRole('listitem')).toHaveStyle({ left: '40%' });
    });

    it.each([null, undefined, NaN, Infinity, -1])('does not invent times for unknown duration %s', (duration) => {
      const formatTime = vi.fn(() => 'Invented time');
      render(
        <TimelineScrubber mode="readOnly" duration={duration} clockOriginSeconds={-30} formatTime={formatTime} markers={[{ at: 0.5, kind: 'event', label: 'Evidence retained' }]} />,
      );
      expect(formatTime).not.toHaveBeenCalled();
      expect(screen.getByRole('listitem')).toHaveAccessibleName('Evidence retained');
      expect(screen.getByRole('listitem')).toHaveStyle({ left: '50%' });
    });

    it.each([null, undefined, NaN, Infinity])('requires a valid explicit origin, not implicit elapsed zero (%s)', (clockOriginSeconds) => {
      const formatTime = vi.fn(() => 'Invented time');
      render(<TimelineScrubber mode="readOnly" duration={120} clockOriginSeconds={clockOriginSeconds} formatTime={formatTime} markers={[{ at: 0.5, kind: 'event' }]} />);
      expect(formatTime).not.toHaveBeenCalled();
      expect(screen.queryByText('Invented time')).not.toBeInTheDocument();
    });

    it('preserves zero duration and origin without division, fake progress or losing events', () => {
      const { container } = render(
        <TimelineScrubber mode="readOnly" duration={0} clockOriginSeconds={0} formatTime={(seconds) => `t=${seconds}s`} markers={[{ at: 0, kind: 'start' }, { at: 1, kind: 'stop' }]} />,
      );
      const items = screen.getAllByRole('listitem');
      expect(items.map((item) => item.style.left)).toEqual(['0%', '100%']);
      expect(items[0]).toHaveAccessibleName('start — t=0s');
      expect(items[1]).toHaveAccessibleName('stop — t=0s');
      expect(container.querySelector('[aria-valuenow]')).toBeNull();
      expect(container.querySelector('[data-timeline-playhead]')).toBeNull();
    });

    it('retains invalid-position evidence without fabricating zero geometry or time', () => {
      const formatTime = vi.fn((seconds: number) => String(seconds));
      const { container } = render(
        <TimelineScrubber mode="readOnly" duration={60} clockOriginSeconds={0} formatTime={formatTime} markers={[{ at: NaN, kind: 'event', label: 'Unknown position' }, { at: Infinity, kind: 'stop', description: 'Capture ended' }]} />,
      );
      expect(screen.getAllByRole('listitem')[0]).toHaveAccessibleName('Unknown position — Position unavailable');
      expect(screen.getAllByRole('listitem')[1]).toHaveAccessibleName('stop — Capture ended — Position unavailable');
      expect(screen.getAllByRole('listitem').map((item) => item.style.left)).toEqual(['', '']);
      expect(container.innerHTML).not.toContain('NaN');
      expect(formatTime.mock.calls.map(([seconds]) => seconds)).toEqual([0, 60]);
    });

    it('renders an empty overview without a numeric playback position', () => {
      const { container } = render(<TimelineScrubber mode="readOnly" />);
      expect(screen.getByRole('group', { name: 'Event overview' })).toBeInTheDocument();
      expect(screen.getByRole('list')).toBeInTheDocument();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      expect(container.querySelector('[aria-valuenow]')).toBeNull();
    });
  });

  describe('<TimelineScrubber> — disabled interactive seeking', () => {
    it('retains interactive time formatting and position but disables keyboard, click, marker and drag seeks', () => {
      const onSeek = vi.fn();
      const preview = vi.fn(() => null);
      render(
        <TimelineScrubber disabled progress={0.5} duration={120} onSeek={onSeek} getPreviewAt={preview} markers={[{ id: 'event', at: 0.25, kind: 'event', label: 'Event' }]} />,
      );
      const slider = getTrack();
      expect(slider).toHaveAttribute('aria-disabled', 'true');
      expect(slider).toHaveAttribute('tabindex', '-1');
      expect(slider).toHaveAttribute('aria-valuenow', '50');
      expect(slider).toHaveAttribute('aria-valuetext', '1:00');
      expect(screen.getByRole('button')).toBeDisabled();
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      fireEvent.keyDown(slider, { key: 'End' });
      fireEvent.click(slider, { clientX: 100 });
      fireEvent.click(screen.getByRole('button'));
      fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(slider, { clientX: 200, pointerId: 1 });
      fireEvent.pointerUp(slider, { clientX: 200, pointerId: 1 });
      fireEvent.mouseMove(slider, { clientX: 100 });
      expect(onSeek).not.toHaveBeenCalled();
      expect(preview).not.toHaveBeenCalled();
    });

    it('preserves click seeking by default and restores seeking after re-enabling', () => {
      const restore = stubTrackRect();
      try {
        const onSeek = vi.fn();
        const { rerender } = render(<TimelineScrubber progress={0.5} duration={120} onSeek={onSeek} />);
        fireEvent.click(getTrack(), { clientX: 50 });
        expect(onSeek).toHaveBeenLastCalledWith(0.25);
        rerender(<TimelineScrubber disabled progress={0.5} duration={120} onSeek={onSeek} />);
        fireEvent.click(getTrack(), { clientX: 100 });
        expect(onSeek).toHaveBeenCalledTimes(1);
        rerender(<TimelineScrubber progress={0.5} duration={120} onSeek={onSeek} />);
        fireEvent.keyDown(getTrack(), { key: 'Home' });
        expect(onSeek).toHaveBeenLastCalledWith(0);
        expect(getTrack()).toHaveAttribute('tabindex', '0');
      } finally {
        restore();
      }
    });
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
