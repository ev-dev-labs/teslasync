/**
 * LiveMonitorKpiBand contract tests.
 *
 * The KPI band is a pure, prop-driven presentational strip that summarises the
 * live SSE firehose through the actual six-metric OperationalBrief. Coverage:
 *
 *   1. Layout & a11y — the strip is exposed as a named landmark region and all
 *      six labelled metrics render, so the band never disappears.
 *   2. Connection state — the first metric preserves Connected / Disconnected
 *      separately from retained-data status.
 *   3. Value surfacing — rate / buffer / unique / numeric / categorical counts
 *      pass through `fmtInt` (locale separators included) and the buffer card's
 *      subtitle reports capacity + a whole-percent fill.
 *   4. Fill clamping (the hardened source) — the fill percentage is bounded to
 *      [0, 100]: an over-capacity count caps at 100%, a negative count floors at
 *      0% (never "-5%"), and a zero/negative capacity falls back to `/ 1` so the
 *      division can never yield Infinity/NaN.
 *   5. Null-safety — missing and invalid numeric inputs remain distinguishable
 *      from measured zero; the existing fill caption remains finite.
 *
 * react-i18next is stubbed to echo the English fallback so the copy asserted on
 * is decoupled from the locale bundle. The actual numerical bridge and
 * OperationalBrief render for real; only preference providers are isolated.
 */

import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import './operationalbrief-all/metricPreferencesTestSetup';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        let template = typeof fallback === 'string' ? fallback : key;
        // Mirror the global mock's plural selection and interpolation so
        // counted sentences resolve exactly as production i18next renders.
        if (options && typeof options.count === 'number') {
          const plural = options.count === 1 ? options.defaultValue_one : options.defaultValue_other;
          if (typeof plural === 'string') template = plural;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options[name] != null ? String(options[name]) : `{{${name}}}`);
        }
        return template;
      },
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

function expectDrawerGroupText(label: string, expected: string | RegExp) {
  const brief = screen.getByTestId('live-monitor-summary');
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const details = screen.getByRole('dialog');
  try {
    expect(within(details).getByRole('group', { name: label })).toHaveTextContent(expected);
  } finally {
    fireEvent.keyDown(details, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

function expectHiddenFieldCount(expected: string) {
  const brief = screen.getByTestId('live-monitor-summary');
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const drawer = screen.getByRole('dialog');
  try {
    expect(within(drawer).getByText(expected)).toBeInTheDocument();
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

it('reacts to live precision and locale changes without decimalizing counts', () => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  const view = renderBand({ bufferCount: 1234, bufferMax: 2000, uniqueSignals: 1001 });
  expect(screen.queryByText('/ 2,000 · 61.70%')).toBeNull();
  expectDrawerGroupText('Buffer size', '/ 2,000 · 61.70%');
  expect(screen.getByText('1,234')).toBeInTheDocument();
  try {
    act(() => {
      setGlobalPrecision(3);
      setGlobalLocale('de-DE');
    });
    expect(screen.queryByText('/ 2.000 · 61,700%')).toBeNull();
    expectDrawerGroupText('Buffer size', '/ 2.000 · 61,700%');
    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getByText('1.001')).toBeInTheDocument();
  } finally {
    view.unmount();
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
  }
});

/** Assert every card label is on screen regardless of the underlying values. */
function expectAllSixLabels() {
  expect(screen.getByText('Connection')).toBeInTheDocument();
  expect(screen.getByText('Signals / sec')).toBeInTheDocument();
  expect(screen.getByText('Buffer size')).toBeInTheDocument();
  expect(screen.getByText('Unique signals')).toBeInTheDocument();
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

  it('renders all six labelled measurements and a decorative review icon', () => {
    const { container } = renderBand();

    expectAllSixLabels();
    // Every card glyph is aria-hidden so a screen reader announces the
    // label + value, never the decorative icon.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(icons).toHaveLength(1);
  });

  it('uses the shared allocation-safe grid without dropping any buffered metric', () => {
    const { container } = renderBand({ connected: false, bufferCount: 123, uniqueSignals: 21 });
    const grid = container.querySelector('[data-operational-brief] [role="list"]');
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass('flex', 'flex-wrap');
    expect(grid).toHaveAttribute('data-columns', '3');
    expectAllSixLabels();
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});

// ── Connection state ──────────────────────────────────────────────────────────

describe('LiveMonitorKpiBand — connection state', () => {
  it('shows connected transport status without inventing a health glyph', () => {
    const { container } = renderBand({ connected: true });

    expect(screen.getAllByText('Connected')).toHaveLength(1);
    assertOperationalBriefDisclosure(screen.getByTestId('live-monitor-summary'), 'Connected');
    expect(screen.queryByText('Disconnected')).toBeNull();
    // The "on" glyph is present; the "off" glyph is not.
    expect(container.querySelector('[data-operational-metric="connection"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('.lucide-wifi-off')).toBeNull();
  });

  it('shows disconnected transport status and retained buffer context', () => {
    const { container } = renderBand({ connected: false });

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).toBeNull();
    assertOperationalBriefDisclosure(screen.getByTestId('live-monitor-summary'), 'Retained source data', { contains: true });
    expect(container.querySelector('[data-operational-metric="connection"]')).toHaveAttribute('data-value-state', 'value');
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
    expect(screen.queryByText(bufferSubtitle('200', '25.00%'))).toBeNull();
    expectDrawerGroupText('Buffer size', bufferSubtitle('200', '25.00%'));
  });
});

// ── Fill clamping (hardened source) ───────────────────────────────────────────

describe('LiveMonitorKpiBand — buffer fill clamping', () => {
  it('caps the fill at 100% when the count exceeds capacity', () => {
    renderBand({ bufferCount: 500, bufferMax: 200 });

    expect(screen.getByText('500')).toBeInTheDocument(); // raw count preserved
    expect(screen.queryByText(bufferSubtitle('200', '100.00%'))).toBeNull();
    expectDrawerGroupText('Buffer size', bufferSubtitle('200', '100.00%'));
  });

  it('floors the fill at 0% for a negative count (never a negative percent)', () => {
    const { container } = renderBand({ bufferCount: -10, bufferMax: 200 });

    // The raw invalid count is omitted, never reported as a measured negative count.
    expect(container.querySelector('[data-operational-metric="buffer"]')).toBeNull();
    const brief = screen.getByTestId('live-monitor-summary');
    assertOperationalMetricUnavailable(brief, 'Buffer size');
    expectHiddenFieldCount('1 empty field is hidden.');
    expect(screen.queryByText('-10')).toBeNull();
    // The pre-hardening "-5%" must never surface.
    expect(screen.queryByText(bufferSubtitle('200', '-5.00%'))).toBeNull();
  });

  it('falls back to /1 capacity when bufferMax is zero (no Infinity/NaN)', () => {
    renderBand({ bufferCount: 3, bufferMax: 0 });

    expect(screen.getByText('3')).toBeInTheDocument();
    // 3 / 1 → clamped to 100%, and the capacity reads "1", never "0".
    expect(screen.queryByText(bufferSubtitle('1', '100.00%'))).toBeNull();
    expectDrawerGroupText('Buffer size', bufferSubtitle('1', '100.00%'));
  });
});

// ── Null-safety ───────────────────────────────────────────────────────────────

describe('LiveMonitorKpiBand — null-safety', () => {
  it('keeps missing numeric fields unknown and preserves the finite capacity caption', () => {
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

    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Numeric')).toBeInTheDocument();
    expect(screen.getByText('Categorical')).toBeInTheDocument();
    const brief = screen.getByTestId('live-monitor-summary');
    for (const label of ['Signals / sec', 'Buffer size', 'Unique signals']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenFieldCount('3 empty fields are hidden.');
    // Surviving fields keep their values.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    // The omitted buffer tile keeps its finite fill out of the DOM entirely.
    expect(screen.queryByText(bufferSubtitle('100', '0.00%'))).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
