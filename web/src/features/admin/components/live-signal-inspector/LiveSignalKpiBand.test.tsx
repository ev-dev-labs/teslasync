/**
 * LiveSignalKpiBand contract tests.
 *
 * The KPI band is a pure, prop-driven presentational component that summarises
 * the current live-signal snapshot as a six-card metric grid. The behaviour we
 * lock in here:
 *
 *   1. All six cards always render (design-language §8 "band never disappears"),
 *      each with its English label and a decorative (aria-hidden) icon.
 *   2. The numeric buckets (total / live / stale / legacy / numeric) surface the
 *      exact values from `stats`, and the layered-source cards carry their hint
 *      subtitles.
 *   3. The freshest-age card renders the human-readable `formatAge()` output —
 *      milliseconds under a second, seconds under a minute, and an em dash when
 *      the age is unknown (null).
 *   4. Empty snapshot (all zeros, unknown freshest age) still renders the full
 *      band — zeros for the counts and an em dash for the age — instead of a
 *      blank or hidden panel.
 *   5. Null-safety: a partial/malformed `stats` object with a missing numeric
 *      field collapses that card to `0` rather than a blank value.
 *
 * react-i18next is stubbed to echo the English fallback so the copy we assert
 * on is decoupled from the locale bundle. <MetricCard> renders for real — it is
 * a stable shared primitive with its own tests — so the assertions exercise the
 * true label → value → subtitle → icon wiring end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { LiveSignalKpiBand } from './LiveSignalKpiBand';
import type { LiveSignalStats } from './liveSignalStats';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeStats(overrides: Partial<LiveSignalStats> = {}): LiveSignalStats {
  return {
    total: 128,
    live: 64,
    stale: 16,
    legacy: 8,
    numeric: 100,
    bySource: { l1: 64, l2: 8, stale: 16, unknown: 40 },
    byKind: [{ category: 'numeric', count: 100 }],
    freshestAgeMs: 1500,
    ...overrides,
  };
}

/** Assert all six cards are on screen regardless of the underlying values. */
function expectAllSixCards() {
  expect(screen.getByText('Total Signals')).toBeInTheDocument();
  expect(screen.getByText(/^Live/)).toBeInTheDocument(); // "Live · L1"
  expect(screen.getByText('Stale')).toBeInTheDocument();
  expect(screen.getByText(/^Legacy/)).toBeInTheDocument(); // "Legacy · L2"
  expect(screen.getByText('Numeric Fields')).toBeInTheDocument();
  expect(screen.getByText('Freshest')).toBeInTheDocument();
}

// ── Layout & accessibility ────────────────────────────────────────────────────

describe('LiveSignalKpiBand — layout & accessibility', () => {
  it('renders all six labelled cards, each with a decorative icon', () => {
    const { container } = render(<LiveSignalKpiBand stats={makeStats()} />);

    expectAllSixCards();
    // Every card glyph is aria-hidden so a screen reader announces the
    // label + value, never the decorative icon.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(6);
  });

  it('renders the layered-source hint subtitles', () => {
    render(<LiveSignalKpiBand stats={makeStats()} />);

    expect(screen.getByText('Fresh in-process')).toBeInTheDocument();
    expect(screen.getByText('Past 2-min window')).toBeInTheDocument();
    expect(screen.getByText('Redis, unknown age')).toBeInTheDocument();
    expect(screen.getByText('Newest value age')).toBeInTheDocument();
  });
});

// ── Value surfacing ───────────────────────────────────────────────────────────

describe('LiveSignalKpiBand — values', () => {
  it('surfaces the exact per-bucket counts from stats', () => {
    render(
      <LiveSignalKpiBand
        stats={makeStats({
          total: 128,
          live: 64,
          stale: 16,
          legacy: 8,
          numeric: 100,
        })}
      />,
    );

    expect(screen.getByText('128')).toBeInTheDocument(); // total
    expect(screen.getByText('64')).toBeInTheDocument(); // live · L1
    expect(screen.getByText('16')).toBeInTheDocument(); // stale
    expect(screen.getByText('8')).toBeInTheDocument(); // legacy · L2
    expect(screen.getByText('100')).toBeInTheDocument(); // numeric
  });

  it('formats a sub-minute freshest age in seconds', () => {
    render(<LiveSignalKpiBand stats={makeStats({ freshestAgeMs: 1500 })} />);

    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('formats a sub-second freshest age in milliseconds', () => {
    render(<LiveSignalKpiBand stats={makeStats({ freshestAgeMs: 250 })} />);

    expect(screen.getByText('250ms')).toBeInTheDocument();
  });
});

// ── Empty snapshot & null-safety ──────────────────────────────────────────────

describe('LiveSignalKpiBand — empty & null-safety', () => {
  it('still renders the full band with zeros + an em dash for an empty snapshot', () => {
    render(
      <LiveSignalKpiBand
        stats={makeStats({
          total: 0,
          live: 0,
          stale: 0,
          legacy: 0,
          numeric: 0,
          bySource: { l1: 0, l2: 0, stale: 0, unknown: 0 },
          byKind: [],
          freshestAgeMs: null,
        })}
      />,
    );

    // Contract: the band never disappears — all six cards are present.
    expectAllSixCards();
    // Five count cards collapse to "0"; the age card shows "—" (unknown).
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('collapses a missing numeric field to 0 instead of a blank card value', () => {
    // A partial/malformed snapshot: `total` is absent at runtime. The `?? 0`
    // guard must render "0" for that card while the well-formed fields render
    // their real values.
    const partial = {
      live: 7,
      stale: 3,
      legacy: 2,
      numeric: 5,
      bySource: { l1: 7, l2: 2, stale: 3, unknown: 0 },
      byKind: [],
      freshestAgeMs: null,
    } as unknown as LiveSignalStats;

    render(<LiveSignalKpiBand stats={partial} />);

    expectAllSixCards();
    // Only `total` is missing, so exactly one "0" is rendered (unique match).
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // live survived
    expect(screen.getByText('5')).toBeInTheDocument(); // numeric survived
    expect(screen.getByText('—')).toBeInTheDocument(); // null age → em dash
  });
});
