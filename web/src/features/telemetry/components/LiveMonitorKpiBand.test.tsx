/**
 * LiveMonitorKpiBand contract tests.
 *
 * The KPI band is a pure, prop-driven presentational strip that summarises the
 * live SSE firehose as a six-card metric grid. The behaviour locked in here:
 *
 *   1. Layout & a11y — the strip is exposed as a named landmark region and all
 *      six labelled cards always render, each with a decorative (aria-hidden)
 *      icon, so the band never disappears.
 *   2. Connection state — the first card swaps its copy (Connected /
 *      Disconnected) and its glyph (Wifi / WifiOff) off the `connected` flag.
 *   3. Value surfacing — rate / buffer / unique / numeric / categorical counts
 *      pass through `fmtInt` (locale separators included) and the buffer card's
 *      subtitle reports capacity + a whole-percent fill.
 *   4. Fill clamping (the hardened source) — the fill percentage is bounded to
 *      [0, 100]: an over-capacity count caps at 100%, a negative count floors at
 *      0% (never "-5%"), and a zero/negative capacity falls back to `/ 1` so the
 *      division can never yield Infinity/NaN.
 *   5. Null-safety — a partial/malformed prop bag with missing numeric fields
 *      collapses each affected card to `0` and still prints a finite `0%` fill
 *      subtitle rather than `NaN%`.
 *
 * react-i18next is stubbed to echo the English fallback so the copy asserted on
 * is decoupled from the locale bundle. <MetricCard> renders for real — it is a
 * stable shared primitive with its own tests — so the assertions exercise the
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

import {
  LiveMonitorKpiBand,
  type LiveMonitorKpiBandProps,
} from './LiveMonitorKpiBand';

// The middle dot the source uses to join capacity + fill (U+00B7). Declared via
// an escape so the assertions stay independent of the test file's encoding.
const DOT = '\u00B7';
/** Build the expected "/ {capacity} · {pct}" buffer subtitle. */
const bufferSubtitle = (capacity: string, pct: string) =>
  `/ ${capacity} ${DOT} ${pct}`;

function renderBand(overrides: Partial<LiveMonitorKpiBandProps> = {}) {
  const props: LiveMonitorKpiBandProps = {
    connected: true,
    rate: 42,
    bufferCount: 50,
    bufferMax: 200,
    uniqueSignals: 17,
    numericCount: 33,
    categoricalCount: 9,
    ...overrides,
  };
  return render(<LiveMonitorKpiBand {...props} />);
}

/** Assert every card label is on screen regardless of the underlying values. */
function expectAllSixLabels() {
  expect(screen.getByText('Connection')).toBeInTheDocument();
  expect(screen.getByText('Signals / sec')).toBeInTheDocument();
  expect(screen.getByText('Buffer Size')).toBeInTheDocument();
  expect(screen.getByText('Unique Signals')).toBeInTheDocument();
  expect(screen.getByText('Numeric')).toBeInTheDocument();
  expect(screen.getByText('Categorical')).toBeInTheDocument();
}

// ── Layout & accessibility ────────────────────────────────────────────────────

describe('LiveMonitorKpiBand — layout & accessibility', () => {
  it('exposes the strip as a named landmark region', () => {
    renderBand();

    expect(
      screen.getByRole('region', { name: 'Live stream summary' }),
    ).toBeInTheDocument();
  });

  it('renders all six labelled cards, each with a decorative icon', () => {
    const { container } = renderBand();

    expectAllSixLabels();
    // Every card glyph is aria-hidden so a screen reader announces the
    // label + value, never the decorative icon.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(6);
  });
});

// ── Connection state ──────────────────────────────────────────────────────────

describe('LiveMonitorKpiBand — connection state', () => {
  it('shows the connected copy and the Wifi glyph when connected', () => {
    const { container } = renderBand({ connected: true });

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).toBeNull();
    // The "on" glyph is present; the "off" glyph is not.
    expect(container.querySelector('.lucide-wifi')).not.toBeNull();
    expect(container.querySelector('.lucide-wifi-off')).toBeNull();
  });

  it('shows the disconnected copy and the WifiOff glyph when disconnected', () => {
    const { container } = renderBand({ connected: false });

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(container.querySelector('.lucide-wifi-off')).not.toBeNull();
    expect(container.querySelector('.lucide-wifi')).toBeNull();
  });
});

// ── Value surfacing ───────────────────────────────────────────────────────────

describe('LiveMonitorKpiBand — value surfacing', () => {
  it('surfaces each metric through fmtInt with locale separators', () => {
    renderBand({
      rate: 42,
      bufferCount: 50,
      uniqueSignals: 1250,
      numericCount: 33,
      categoricalCount: 9,
    });

    expect(screen.getByText('42')).toBeInTheDocument(); // rate
    expect(screen.getByText('50')).toBeInTheDocument(); // buffer count
    expect(screen.getByText('1,250')).toBeInTheDocument(); // fmtInt separator
    expect(screen.getByText('33')).toBeInTheDocument(); // numeric
    expect(screen.getByText('9')).toBeInTheDocument(); // categorical
  });

  it('reports buffer capacity and a whole-percent fill in the subtitle', () => {
    renderBand({ bufferCount: 50, bufferMax: 200 });

    // 50 / 200 = 25%.
    expect(
      screen.getByText(bufferSubtitle('200', '25%')),
    ).toBeInTheDocument();
  });
});

// ── Fill clamping (hardened source) ───────────────────────────────────────────

describe('LiveMonitorKpiBand — buffer fill clamping', () => {
  it('caps the fill at 100% when the count exceeds capacity', () => {
    renderBand({ bufferCount: 500, bufferMax: 200 });

    expect(screen.getByText('500')).toBeInTheDocument(); // raw count preserved
    expect(
      screen.getByText(bufferSubtitle('200', '100%')),
    ).toBeInTheDocument();
  });

  it('floors the fill at 0% for a negative count (never a negative percent)', () => {
    renderBand({ bufferCount: -10, bufferMax: 200 });

    // The raw (nonsensical) count is still shown, but the fill is clamped to 0%.
    expect(screen.getByText('-10')).toBeInTheDocument();
    expect(screen.getByText(bufferSubtitle('200', '0%'))).toBeInTheDocument();
    // The pre-hardening "-5%" must never surface.
    expect(screen.queryByText(bufferSubtitle('200', '-5%'))).toBeNull();
  });

  it('falls back to /1 capacity when bufferMax is zero (no Infinity/NaN)', () => {
    renderBand({ bufferCount: 3, bufferMax: 0 });

    expect(screen.getByText('3')).toBeInTheDocument();
    // 3 / 1 → clamped to 100%, and the capacity reads "1", never "0".
    expect(screen.getByText(bufferSubtitle('1', '100%'))).toBeInTheDocument();
  });
});

// ── Null-safety ───────────────────────────────────────────────────────────────

describe('LiveMonitorKpiBand — null-safety', () => {
  it('collapses missing numeric fields to 0 and keeps a finite fill subtitle', () => {
    // A partial/malformed prop bag: rate, bufferCount and uniqueSignals are
    // absent at runtime. The `?? 0` guards must render "0" for each of those
    // cards while the well-formed fields render their real values — and the
    // buffer fill must resolve to a finite "0%", never "NaN%".
    const partial = {
      connected: true,
      bufferMax: 100,
      numericCount: 7,
      categoricalCount: 4,
    } as unknown as LiveMonitorKpiBandProps;

    // Render the partial bag directly — going through `renderBand` would splice
    // the missing fields back in from its defaults and defeat the guard test.
    render(<LiveMonitorKpiBand {...partial} />);

    expectAllSixLabels();
    // rate, buffer count and unique signals each collapse to "0".
    expect(screen.getAllByText('0')).toHaveLength(3);
    // Surviving fields keep their values.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    // The fill is a finite 0%, proving the NaN guard on the division.
    expect(screen.getByText(bufferSubtitle('100', '0%'))).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
