/**
 * RateTimeline — behaviour + hardening coverage.
 *
 * <RateTimeline> renders a 24-column time-of-use rate bar chart for the Smart
 * Charge planner. It is a pure presentational leaf (its data arrives as the
 * `rates` prop), so a bare render() + the real `@/i18n` fallbacks are enough —
 * no QueryClient / Router / network. The suite exercises every branch and the
 * real bugs the hardening pass fixed:
 *
 *   • empty / null-safety — an empty `rates` array (and, defensively, an
 *     `undefined` prop) renders the "No rate data available" copy and no bars
 *     instead of crashing on `.length` / `.map`.
 *   • rendering & legend — one accessible bar (role="img") per rate, the
 *     labelled chart group, the three tier legend chips, and the Charge Window
 *     legend entry only when a window is supplied.
 *   • bar heights — proportional to the peak rate, floored at 5% (so a zero
 *     rate is still a visible sliver) and clamped at 100%.
 *   • non-finite regression — a single NaN / undefined `rate_cents` no longer
 *     turns `Math.max` into NaN (which used to collapse EVERY bar to the flat
 *     fallback and emit an invalid `height: NaN%`); the bad bar floors while
 *     its valid neighbours keep their proportional heights.
 *   • charge window — same-day and cross-midnight windows highlight the right
 *     bars (cyan) and leave the rest on their tier colour.
 *   • tier colours — each known tier maps to its swatch; an unknown tier fails
 *     closed to the neutral surface colour without throwing.
 *   • a11y — every bar carries a descriptive accessible name (hour, rate,
 *     tier, + "in charge window" when applicable), the decorative legend
 *     swatches are aria-hidden, and hours render in 12-hour notation (with a
 *     normalised 24→midnight and a "—" for a non-finite hour).
 */
import '@/i18n';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { RateTimeline } from './RateTimeline';
import type { HourlyRate } from '@/types/charging';

/** Build an HourlyRate, overriding only the fields under test. */
function makeRate(overrides: Partial<HourlyRate> = {}): HourlyRate {
  return { hour: 0, rate_cents: 10, tier: 'OFF_PEAK', ...overrides };
}

type Props = ComponentProps<typeof RateTimeline>;

function renderTimeline(props: Props) {
  return render(<RateTimeline {...props} />);
}

/** Each hour column is a role="img"; the coloured bar is its last child. */
function bars() {
  return screen.getAllByRole('img');
}
function barEl(cell: HTMLElement): HTMLElement {
  return cell.lastElementChild as HTMLElement;
}

// ── Empty state / null-safety ────────────────────────────────────────────────

describe('RateTimeline — empty state', () => {
  it('renders the no-data copy and no bars when rates is empty', () => {
    renderTimeline({ rates: [] });

    expect(screen.getByText('No rate data available')).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    // The chart group is withheld too — nothing to plot.
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('is null-safe when rates is undefined instead of crashing on .length', () => {
    expect(() =>
      renderTimeline({ rates: undefined as unknown as HourlyRate[] }),
    ).not.toThrow();

    expect(screen.getByText('No rate data available')).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});

// ── Rendering & legend ───────────────────────────────────────────────────────

describe('RateTimeline — rendering & legend', () => {
  it('renders one accessible bar per rate inside a labelled chart group', () => {
    renderTimeline({
      rates: [makeRate({ hour: 0 }), makeRate({ hour: 1 }), makeRate({ hour: 2 })],
    });

    expect(bars()).toHaveLength(3);
    expect(
      screen.getByRole('group', { name: /24-hour electricity rate timeline/i }),
    ).toBeInTheDocument();
  });

  it('renders the three tier legend labels', () => {
    renderTimeline({ rates: [makeRate()] });

    expect(screen.getByText('Off-Peak')).toBeInTheDocument();
    expect(screen.getByText('Mid-Peak')).toBeInTheDocument();
    expect(screen.getByText('On-Peak')).toBeInTheDocument();
  });

  it('shows the Charge Window legend entry only when a window is supplied', () => {
    const { unmount } = renderTimeline({ rates: [makeRate()] });
    expect(screen.queryByText('Charge Window')).toBeNull();
    unmount();

    renderTimeline({ rates: [makeRate()], chargeWindow: { startHour: 0, endHour: 6 } });
    expect(screen.getByText('Charge Window')).toBeInTheDocument();
  });

  it('shows the formatted rate in the (decorative) hover tooltip', () => {
    renderTimeline({ rates: [makeRate({ hour: 0, rate_cents: 17.5, tier: 'ON_PEAK' })] });
    expect(screen.getByText('17.5¢/kWh')).toBeInTheDocument();
  });
});

// ── Bar heights ──────────────────────────────────────────────────────────────

describe('RateTimeline — bar heights', () => {
  it('scales bar heights proportionally to the peak rate', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 0, rate_cents: 10 }),
        makeRate({ hour: 1, rate_cents: 20 }),
      ],
    });

    const [b0, b1] = bars();
    expect(barEl(b0).style.height).toBe('50%'); // 10 / 20
    expect(barEl(b1).style.height).toBe('100%'); // 20 / 20 (peak)
  });

  it('floors a zero-rate bar at 5% (all-zero rates fall back to a peak of 1)', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 0, rate_cents: 0 }),
        makeRate({ hour: 1, rate_cents: 0 }),
      ],
    });

    for (const b of bars()) {
      expect(barEl(b).style.height).toBe('5%');
    }
  });
});

// ── Non-finite regression (the Math.max NaN bug) ─────────────────────────────

describe('RateTimeline — non-finite rate hardening', () => {
  it('keeps valid bars proportional when one rate is NaN (no whole-chart collapse)', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 0, rate_cents: 10, tier: 'OFF_PEAK' }),
        makeRate({ hour: 1, rate_cents: Number.NaN, tier: 'ON_PEAK' }),
        makeRate({ hour: 2, rate_cents: 20, tier: 'MID_PEAK' }),
      ],
    });

    const [b0, b1, b2] = bars();
    expect(barEl(b0).style.height).toBe('50%'); // valid neighbour untouched
    expect(barEl(b1).style.height).toBe('5%'); // NaN → floored, never NaN%
    expect(barEl(b2).style.height).toBe('100%'); // peak (NaN excluded from max)

    // No bar may carry an invalid "NaN%" height.
    for (const b of bars()) {
      expect(barEl(b).style.height).not.toContain('NaN');
    }
  });

  it('coalesces an undefined rate_cents to the 5% floor', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 0, rate_cents: 20, tier: 'ON_PEAK' }),
        makeRate({ hour: 1, rate_cents: undefined as unknown as number, tier: 'OFF_PEAK' }),
      ],
    });

    const [b0, b1] = bars();
    expect(barEl(b0).style.height).toBe('100%');
    expect(barEl(b1).style.height).toBe('5%');
  });
});

// ── Charge window highlighting ───────────────────────────────────────────────

describe('RateTimeline — charge window highlighting', () => {
  it('highlights bars inside a same-day window and leaves the rest on their tier colour', () => {
    renderTimeline({
      rates: [0, 1, 2, 3].map((hour) => makeRate({ hour, rate_cents: 10, tier: 'OFF_PEAK' })),
      chargeWindow: { startHour: 1, endHour: 3 },
    });

    const [b0, b1, b2, b3] = bars();
    // Hours 1 & 2 are in [1, 3); 0 & 3 are out.
    expect(barEl(b1).className).toContain('bg-cyan-400/70');
    expect(barEl(b1).className).toContain('ring-cyan-400/50');
    expect(barEl(b2).className).toContain('bg-cyan-400/70');

    expect(barEl(b0).className).toContain('bg-emerald-500/40');
    expect(barEl(b0).className).not.toContain('bg-cyan-400/70');
    expect(barEl(b3).className).toContain('bg-emerald-500/40');
  });

  it('handles a cross-midnight window (startHour > endHour)', () => {
    renderTimeline({
      rates: [0, 1, 2, 22, 23].map((hour) => makeRate({ hour, rate_cents: 10, tier: 'OFF_PEAK' })),
      chargeWindow: { startHour: 22, endHour: 2 },
    });

    const [h0, h1, h2, h22, h23] = bars();
    expect(barEl(h0).className).toContain('bg-cyan-400/70'); // 0 < 2 → in
    expect(barEl(h1).className).toContain('bg-cyan-400/70'); // 1 < 2 → in
    expect(barEl(h2).className).not.toContain('bg-cyan-400/70'); // 2 is NOT < 2 → out
    expect(barEl(h22).className).toContain('bg-cyan-400/70'); // 22 >= 22 → in
    expect(barEl(h23).className).toContain('bg-cyan-400/70'); // 23 >= 22 → in
  });
});

// ── Tier colours ─────────────────────────────────────────────────────────────

describe('RateTimeline — tier colours', () => {
  it('maps every known tier to its swatch and fails closed for an unknown tier', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 0, tier: 'OFF_PEAK' }),
        makeRate({ hour: 1, tier: 'SUPER_OFF_PEAK' }),
        makeRate({ hour: 2, tier: 'MID_PEAK' }),
        makeRate({ hour: 3, tier: 'ON_PEAK' }),
        makeRate({ hour: 4, tier: 'MYSTERY' }),
      ],
    });

    const [off, superOff, mid, on, unknown] = bars();
    expect(barEl(off).className).toContain('bg-emerald-500/40');
    expect(barEl(superOff).className).toContain('bg-emerald-500/50');
    expect(barEl(mid).className).toContain('bg-amber-500/40');
    expect(barEl(on).className).toContain('bg-red-500/40');
    expect(barEl(unknown).className).toContain('bg-[var(--surface-2)]');
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('RateTimeline — accessibility', () => {
  it('gives each bar a descriptive accessible name (hour, rate, tier)', () => {
    renderTimeline({ rates: [makeRate({ hour: 0, rate_cents: 15, tier: 'OFF_PEAK' })] });

    expect(
      screen.getByRole('img', { name: '12a: 15.0¢ per kWh, Off-Peak' }),
    ).toBeInTheDocument();
  });

  it('appends the charge-window state to the accessible name for in-window bars', () => {
    renderTimeline({
      rates: [makeRate({ hour: 2, rate_cents: 8, tier: 'OFF_PEAK' })],
      chargeWindow: { startHour: 1, endHour: 4 },
    });

    expect(
      screen.getByRole('img', { name: '2a: 8.0¢ per kWh, Off-Peak, in charge window' }),
    ).toBeInTheDocument();
  });

  it('surfaces an unknown tier verbatim and falls back to "Unknown" for a blank tier', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 5, rate_cents: 5, tier: 'WEIRD' }),
        makeRate({ hour: 6, rate_cents: 5, tier: '' }),
      ],
    });

    expect(screen.getByRole('img', { name: /5a: 5\.0¢ per kWh, WEIRD/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /6a: 5\.0¢ per kWh, Unknown/ })).toBeInTheDocument();
  });

  it('marks the decorative legend swatch aria-hidden (state conveyed by adjacent text)', () => {
    renderTimeline({ rates: [makeRate()] });

    const swatch = screen.getByText('Off-Peak').previousElementSibling;
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveAttribute('aria-hidden', 'true');
  });

  it('formats hours in 12-hour notation within the accessible name', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 0, rate_cents: 5, tier: 'OFF_PEAK' }),
        makeRate({ hour: 12, rate_cents: 5, tier: 'OFF_PEAK' }),
        makeRate({ hour: 13, rate_cents: 5, tier: 'OFF_PEAK' }),
        makeRate({ hour: 23, rate_cents: 5, tier: 'OFF_PEAK' }),
      ],
    });

    expect(screen.getByRole('img', { name: /^12a:/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^12p:/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^1p:/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^11p:/ })).toBeInTheDocument();
  });

  it('normalises hour 24 to midnight and degrades a non-finite hour to a dash', () => {
    renderTimeline({
      rates: [
        makeRate({ hour: 24, rate_cents: 5, tier: 'OFF_PEAK' }),
        makeRate({ hour: Number.NaN, rate_cents: 5, tier: 'OFF_PEAK' }),
      ],
    });

    expect(screen.getByRole('img', { name: /^12a:/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^—:/ })).toBeInTheDocument();
  });
});
