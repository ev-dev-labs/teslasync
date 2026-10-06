/**
 * SignalLogKpiBand — behaviour + hardening coverage.
 *
 * The band is a pure presenter: it receives the already-derived
 * `SignalLogSummary` and renders the actual six-metric OperationalBrief. Three
 * facets worth pinning:
 *   - initial loading exposes aria-busy without fabricated measured values;
 *     a refetch that already has rows keeps showing the data;
 *   - unknown values before a query runs, distinct from successful empty
 *     results, plus locale-grouped
 *     `fmtInt` values, the "{{count}} with data" subtitle interpolation, and the
 *     accessible region / metric-marker contract;
 *   - the private `formatSpan` helper, exercised end-to-end through the rendered
 *     "Time Span" tile across every unit boundary (seconds → days) and its
 *     defensive branches (null, reversed, unparseable).
 *
 * A hardening facet is also covered: a caller that passes `undefined` for the
 * summary (an async boundary before `summarizeSignalLog` runs) must degrade to
 * missing measurements rather than crash on `summary.totalRecords`.
 *
 * The real shared bridge and OperationalBrief are kept so the accessible DOM
 * and raw value states are exercised for real. No network is involved; the
 * band takes its data purely via props. `react-i18next` is stubbed to the
 * English fallback with {{placeholder}} interpolation so visible copy is
 * asserted directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import './operationalbrief-all/metricPreferencesTestSetup';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via <FadeIn>).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// i18n → English fallback with {{placeholder}} interpolation.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import type { SignalLogSummary } from './signalLogSummary';
import { SignalLogKpiBand } from './SignalLogKpiBand';

// ── Fixtures ─────────────────────────────────────────────────────────
const ZERO: SignalLogSummary = {
  totalRecords: 0,
  signalsSelected: 0,
  distinctSignals: 0,
  numericPoints: 0,
  textPoints: 0,
  boolPoints: 0,
  earliest: null,
  latest: null,
};

function makeSummary(overrides: Partial<SignalLogSummary> = {}): SignalLogSummary {
  return { ...ZERO, ...overrides };
}

/** The six card labels, in render order. */
const LABELS = [
  'Total records',
  'Signals',
  'Numeric points',
  'Text points',
  'Boolean points',
  'Time span',
] as const;

/**
 * Read the big value rendered for a given metric card by label. MetricCard
 * renders `<p><span>{label}</span></p>` immediately followed by the value
 * `<p>`, so the value is the label paragraph's next sibling.
 */
function metricValue(label: string): string {
  return screen.getByText(label).closest('[data-operational-metric]')
    ?.querySelector('[data-operational-value]')?.textContent ?? '';
}

/** ISO string `seconds` after a fixed epoch base. */
const BASE = '2024-01-01T00:00:00.000Z';
function plus(seconds: number): string {
  return new Date(Date.parse(BASE) + seconds * 1000).toISOString();
}

describe('SignalLogKpiBand', () => {
  it('shows unknown result counts on unavailable history while keeping selected-signal scope known', () => {
    render(<SignalLogKpiBand summary={makeSummary({ signalsSelected: 3 })} unavailable />);
    expect(metricValue('Total records')).toBe('—');
    expect(metricValue('Numeric points')).toBe('—');
    expect(metricValue('Text points')).toBe('—');
    expect(metricValue('Boolean points')).toBe('—');
    expect(metricValue('Signals')).toBe('3');
    expect(screen.queryByText('0 with data')).toBeNull();
  });
  it('renders six loading cells without leaking measured values while the first batch loads', () => {
    const { container } = render(<SignalLogKpiBand summary={makeSummary()} loading />);

    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByTestId('signal-log-summary')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    // The labelled region is still announced during loading…
    expect(screen.getByRole('region', { name: 'Query summary' })).toBeInTheDocument();
    // …but none of the metric tiles have rendered yet.
    expect(screen.getByText('Total records')).toBeInTheDocument();
    expect(screen.getByText('Time span')).toBeInTheDocument();
  });

  it('keeps showing data (not skeletons) when a refetch loads over existing rows', () => {
    const { container } = render(
      <SignalLogKpiBand summary={makeSummary({ totalRecords: 5 })} loading />,
    );

    // loading is true but totalRecords > 0 → the guard falls through to data.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByText('Total records')).toBeInTheDocument();
    expect(metricValue('Total records')).toBe('5');
  });

  it('renders all six honest-zero placeholders before any query runs', () => {
    render(<SignalLogKpiBand summary={makeSummary()} />);

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(metricValue('Total records')).toBe('0');
    expect(metricValue('Numeric points')).toBe('0');
    expect(metricValue('Time span')).toBe('—');
    // subtitle: "{{count}} with data" with distinctSignals = 0.
    expect(screen.getByText('0 with data')).toBeInTheDocument();
  });

  it('formats populated counters with locale grouping and interpolates the subtitle', () => {
    render(
      <SignalLogKpiBand
        summary={makeSummary({
          totalRecords: 12500,
          signalsSelected: 8,
          distinctSignals: 6,
          numericPoints: 10000,
          textPoints: 1500,
          boolPoints: 1000,
          earliest: plus(0),
          latest: plus(2 * 3600 + 30 * 60), // 2h 30m
        })}
      />,
    );

    expect(metricValue('Total records')).toBe('12,500');
    expect(metricValue('Signals')).toBe('8');
    expect(metricValue('Numeric points')).toBe('10,000');
    expect(metricValue('Text points')).toBe('1,500');
    expect(metricValue('Boolean points')).toBe('1,000');
    expect(metricValue('Time span')).toBe('2h 30m');
    expect(screen.getByText('6 with data')).toBeInTheDocument();
  });

  it('exposes the region and marks every tile icon as decorative (aria-hidden)', () => {
    const { container } = render(
      <SignalLogKpiBand summary={makeSummary({ totalRecords: 3 })} />,
    );

    expect(screen.getByRole('region', { name: 'Query summary' })).toBeInTheDocument();
    // Six lucide icons, one per tile, all hidden from the a11y tree.
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  });

  // ── Hardening: a missing summary must never crash the band ──────────
  it('degrades to unknown source values when summary is undefined instead of crashing', () => {
    render(
      <SignalLogKpiBand
        summary={undefined as unknown as SignalLogSummary}
      />,
    );

    expect(screen.getByText('Total records')).toBeInTheDocument();
    expect(metricValue('Total records')).toBe('—');
    expect(metricValue('Time span')).toBe('—');
    expect(screen.queryByText('0 with data')).toBeNull();
  });

  it('still renders skeletons (no crash) when summary is undefined while loading', () => {
    const { container } = render(
      <SignalLogKpiBand summary={undefined as unknown as SignalLogSummary} loading />,
    );

    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByTestId('signal-log-summary')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.getByText('Total records')).toBeInTheDocument();
  });

  // ── formatSpan: exercised through the rendered "Time Span" tile ─────
  // [name, earliest, latest, expected] — one it() per row so each unit
  // boundary and defensive branch is an independent, named case.
  const spanCases: ReadonlyArray<
    readonly [string, string | null, string | null, string]
  > = [
    ['null earliest and latest', null, null, '—'],
    ['a present earliest but null latest', BASE, null, '—'],
    ['an unparseable timestamp', 'not-a-date', BASE, '—'],
    ['a reversed range (latest before earliest)', plus(600), plus(0), '—'],
    ['a zero-length span', BASE, BASE, '0s'],
    ['sub-minute spans in seconds', plus(0), plus(45), '45s'],
    ['whole-minute spans', plus(0), plus(5 * 60), '5m'],
    ['hour+minute spans', plus(0), plus(90 * 60), '1h 30m'],
    ['an exact hour without trailing minutes', plus(0), plus(3600), '1h'],
    ['day+hour spans', plus(0), plus(26 * 3600), '1d 2h'],
    ['an exact day without trailing hours', plus(0), plus(48 * 3600), '2d'],
  ];

  for (const [name, earliest, latest, expected] of spanCases) {
    it(`formats the time span for ${name}`, () => {
      render(<SignalLogKpiBand summary={makeSummary({ earliest, latest })} />);
      expect(metricValue('Time span')).toBe(expected);
    });
  }
});
