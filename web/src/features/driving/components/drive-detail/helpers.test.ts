// drive-detail/helpers unit tests.
//
// Every export is exercised across multiple facets/branches:
//   formatDuration — minutes-only vs hour+minute rendering, exact-hour output,
//                    per-field minute rounding, the hour-carry regression
//                    (a value that rounds up to a full hour must not print
//                    "60m" / "…h 60m"), the non-finite / negative guards that
//                    keep bad or in-progress telemetry from leaking "NaNm", a
//                    large multi-hour value, and the real consumer shape
//                    (`drive.durationS / 60`).
//   LEGEND_STYLE   — the recharts <Legend wrapperStyle> object: fixed 10px
//                    legend text and a theme colour token (never a hardcoded
//                    dark-only grey) so the legend tracks the active theme like
//                    the sibling axis ticks.
//
// formatDuration builds its string from raw template interpolation (no locale
// number formatting), so these assertions are locale-independent.

import { describe, it, expect } from 'vitest';
import { formatDuration, LEGEND_STYLE } from './helpers';

describe('formatDuration', () => {
  it('renders sub-hour durations as bare minutes', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(1)).toBe('1m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(59)).toBe('59m');
  });

  it('renders hour + minute for durations of an hour or more', () => {
    expect(formatDuration(60)).toBe('1h 0m');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(125)).toBe('2h 5m');
  });

  it('rounds fractional minutes to the nearest whole minute', () => {
    // 30.4 → 30, 30.6 → 31 (round-half-up within the minute field).
    expect(formatDuration(30.4)).toBe('30m');
    expect(formatDuration(30.6)).toBe('31m');
    expect(formatDuration(90.6)).toBe('1h 31m');
  });

  it('carries a minute that rounds up to a full hour instead of printing 60m', () => {
    // Regression: `Math.round(min % 60)` used to yield 60, so 59.6 rendered as
    // "60m" and 119.7 as "1h 60m". Rounding the total minutes fixes the carry.
    expect(formatDuration(59.6)).toBe('1h 0m');
    expect(formatDuration(59.9)).toBe('1h 0m');
    expect(formatDuration(119.7)).toBe('2h 0m');
    // A well-formed value must never contain a 60-minute remainder.
    expect(formatDuration(119.7)).not.toContain('60m');
    expect(formatDuration(59.6)).not.toBe('60m');
  });

  it('collapses non-finite inputs to "0m" instead of leaking NaN/Infinity', () => {
    expect(formatDuration(Number.NaN)).toBe('0m');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0m');
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe('0m');
    expect(formatDuration(Number.NaN)).not.toContain('NaN');
    expect(formatDuration(Number.POSITIVE_INFINITY)).not.toContain('Infinity');
  });

  it('treats a negative duration as zero', () => {
    expect(formatDuration(-5)).toBe('0m');
    expect(formatDuration(-120)).toBe('0m');
  });

  it('formats large multi-hour durations', () => {
    expect(formatDuration(1500)).toBe('25h 0m');
    expect(formatDuration(1445)).toBe('24h 5m');
  });

  it('matches the real consumer shape (drive.durationS / 60)', () => {
    // DriveStatCards / DriveTimeline call formatDuration(drive.durationS / 60).
    expect(formatDuration(3600 / 60)).toBe('1h 0m'); // 3600s
    expect(formatDuration(3576 / 60)).toBe('1h 0m'); // 3576s → 59.6min (carry)
    expect(formatDuration(7182 / 60)).toBe('2h 0m'); // 7182s → 119.7min (carry)
    expect(formatDuration(2700 / 60)).toBe('45m'); // 2700s
  });
});

describe('LEGEND_STYLE', () => {
  it('pins the legend text size to 10px', () => {
    expect(LEGEND_STYLE.fontSize).toBe(10);
  });

  it('colours the legend from a theme token, not a hardcoded grey', () => {
    // Must resolve through --text-muted so the legend matches the axis ticks
    // and stays legible when the app switches to the light theme.
    expect(LEGEND_STYLE.color).toBe('var(--text-muted)');
    expect(LEGEND_STYLE.color).toContain('--text-');
    expect(LEGEND_STYLE.color).not.toMatch(/#[0-9a-f]/i);
  });

  it('exposes exactly the recharts wrapperStyle keys', () => {
    expect(Object.keys(LEGEND_STYLE).sort()).toEqual(['color', 'fontSize']);
  });
});
