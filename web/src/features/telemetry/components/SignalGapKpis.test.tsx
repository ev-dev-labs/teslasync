/**
 * SignalGapKpis — behaviour + hardening coverage.
 *
 * SignalGapKpis is the pure-render KPI band for the Signal Gap Detector. It
 * owns NO data — every figure is a prop (`buckets` / `freshnessPct`) gated by a
 * `hasVehicle` flag — and its actual Brief retains the shared Review drawer.
 * These
 * specs drive it purely through props and assert its OWN behaviour:
 *
 *   1. Populated (hasVehicle=true): the six cards render with their accessible
 *      labels and derive the right figure from `buckets` + the freshness
 *      percentage; genuine zero counts show `0` (a live vehicle with no signals
 *      yet) rather than the em-dash.
 *   2. No vehicle (hasVehicle=false): every value collapses to the em-dash
 *      placeholder regardless of the numbers handed in.
 *   3. Resilience / formatting: undefined buckets and missing fields remain
 *      missing; NaN freshness remains invalid, never fictitious measured 0%.
 *   4. Accessibility: the band is a labelled region with metric/value markers.
 *
 * The real shared bridge and OperationalBrief are rendered — react-i18next is
 * mocked to resolve the developer fallback strings, matching
 * ./LiveSignalTail.test.tsx / ./SignalCompareControls.test.tsx. The component
 * keeps the actual Review interaction, covered by RetainedBands.test.tsx.
 */
import { type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import './operationalbrief-all/metricPreferencesTestSetup';

// jsdom lacks matchMedia; framer-motion (<FadeIn> via useReducedMotion) reads
// it during render. Install a benign stub before any module imports it.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback string so assertions read like the
// English UI (the real en.json values are identical to these fallbacks).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
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
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

import { SignalGapKpis } from './SignalGapKpis';
import type { GapBuckets } from '../signalGapUtils';

type Props = ComponentProps<typeof SignalGapKpis>;

// The literal em-dash the band collapses to when there is no vehicle / data.
const DASH = '—';

// The six card labels, in render order, keyed by the facet they surface.
const LABELS = {
  total: 'Total signals',
  active: 'Active (<30s)',
  aging: 'Aging (<5min)',
  stale: 'Stale (>5min)',
  never: 'Never received',
  freshness: 'Freshness',
} as const;

function makeBuckets(over: Partial<GapBuckets> = {}): GapBuckets {
  return { total: 0, active: 0, aging: 0, stale: 0, never: 0, ...over };
}

function renderKpis(over: Partial<Props> = {}) {
  const props: Props = {
    buckets: makeBuckets(),
    freshnessPct: 100,
    hasVehicle: true,
    ...over,
  };
  return render(<SignalGapKpis {...props} />);
}

// Scope a query to a single MetricCard by its label — the card root carries the
// `data-role="metric-card"` semantic hook, so we climb to it and search within.
function card(label: string) {
  const root = screen.getByText(label).closest('[data-operational-metric]') as HTMLElement;
  return within(root);
}

function expectHiddenFieldCount(expected: string) {
  const brief = screen.getByTestId('signal-gap-summary');
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const drawer = screen.getByRole('dialog');
  try {
    expect(within(drawer).getByText(expected)).toBeInTheDocument();
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

function lastMetricStates(): Array<string | undefined> {
  const results = vi.mocked(useOperationalMetrics).mock.results;
  const last = results[results.length - 1];
  if (last?.type !== 'return') throw new Error('missing operational metrics result');
  return last.value.map(metric => metric.valueState);
}

describe('SignalGapKpis — populated (hasVehicle=true)', () => {
  it('distinguishes unavailable source counts from a successful empty catalog', () => {
    const { container } = renderKpis({ unavailable: true, buckets: makeBuckets(), freshnessPct: 0 });
    const brief = screen.getByTestId('signal-gap-summary');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(brief).toHaveTextContent('No metric values are available yet.');
    for (const label of Object.values(LABELS)) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenFieldCount('6 empty fields are hidden.');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });
  it('renders all six labelled KPI cards', () => {
    renderKpis();
    for (const label of Object.values(LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('surfaces each bucket count and the freshness percentage in its own card', () => {
    renderKpis({
      buckets: makeBuckets({ total: 42, active: 30, aging: 8, stale: 3, never: 1 }),
      freshnessPct: 87,
    });

    expect(card(LABELS.total).getByText('42')).toBeInTheDocument();
    expect(card(LABELS.active).getByText('30')).toBeInTheDocument();
    expect(card(LABELS.aging).getByText('8')).toBeInTheDocument();
    expect(card(LABELS.stale).getByText('3')).toBeInTheDocument();
    expect(card(LABELS.never).getByText('1')).toBeInTheDocument();
    expect(card(LABELS.freshness).getByText('87%')).toBeInTheDocument();
  });

  it('renders genuine zero counts as 0 (live vehicle, no signals yet) — not the em-dash', () => {
    renderKpis({ buckets: makeBuckets(), freshnessPct: 0 });

    expect(card(LABELS.total).getByText('0')).toBeInTheDocument();
    expect(card(LABELS.never).getByText('0')).toBeInTheDocument();
    expect(card(LABELS.freshness).getByText('0%')).toBeInTheDocument();
    // A live-but-empty vehicle must NOT look like the no-vehicle posture.
    expect(screen.queryByText(DASH)).not.toBeInTheDocument();
  });
});

describe('SignalGapKpis — no vehicle (hasVehicle=false)', () => {
  it('collapses every value to the em-dash placeholder, ignoring the numbers', () => {
    renderKpis({
      buckets: makeBuckets({ total: 42, active: 30, aging: 8, stale: 3, never: 1 }),
      freshnessPct: 87,
      hasVehicle: false,
    });

    // All six tiles are omitted; the real numbers never leak through.
    const brief = screen.getByTestId('signal-gap-summary');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of Object.values(LABELS)) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenFieldCount('6 empty fields are hidden.');
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect(screen.queryByText('87%')).not.toBeInTheDocument();
  });
});

describe('SignalGapKpis — resilience + formatting', () => {
  it('renders unknowns instead of throwing when buckets is undefined but a vehicle is selected', () => {
    expect(() =>
      renderKpis({ buckets: undefined as unknown as GapBuckets, freshnessPct: 50 }),
    ).not.toThrow();

    const brief = screen.getByTestId('signal-gap-summary');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of Object.values(LABELS)) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenFieldCount('6 empty fields are hidden.');
  });

  it('renders the em-dash without throwing when buckets is undefined and no vehicle is selected', () => {
    expect(() =>
      renderKpis({ buckets: undefined as unknown as GapBuckets, hasVehicle: false }),
    ).not.toThrow();

    const brief = screen.getByTestId('signal-gap-summary');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of Object.values(LABELS)) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenFieldCount('6 empty fields are hidden.');
  });

  it('keeps a missing bucket field unknown rather than silently measuring zero', () => {
    // A partial payload (only `total`) must not leave `.aging`/`.never` blank.
    renderKpis({
      buckets: { total: 5, active: 2 } as unknown as GapBuckets,
      freshnessPct: 40,
    });

    expect(card(LABELS.total).getByText('5')).toBeInTheDocument();
    expect(card(LABELS.active).getByText('2')).toBeInTheDocument();
    const brief = screen.getByTestId('signal-gap-summary');
    for (const label of [LABELS.aging, LABELS.stale, LABELS.never]) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenFieldCount('3 empty fields are hidden.');
  });

  it('marks NaN freshness invalid instead of reporting 0%', () => {
    renderKpis({ freshnessPct: Number.NaN });

    expect(lastMetricStates()).toEqual(['value', 'value', 'value', 'value', 'value', 'invalid']);
    const brief = screen.getByTestId('signal-gap-summary');
    assertOperationalMetricUnavailable(brief, LABELS.freshness);
    expectHiddenFieldCount('1 empty field is hidden.');
    expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('keeps undefined freshness missing instead of reporting 0%', () => {
    renderKpis({ freshnessPct: undefined as unknown as number });

    expect(lastMetricStates()).toEqual(['value', 'value', 'value', 'value', 'value', 'missing']);
    const brief = screen.getByTestId('signal-gap-summary');
    assertOperationalMetricUnavailable(brief, LABELS.freshness);
    expectHiddenFieldCount('1 empty field is hidden.');
    expect(screen.queryByText('undefined%')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('SignalGapKpis — accessibility', () => {
  it('exposes the band as a labelled region', () => {
    renderKpis();
    expect(
      screen.getByRole('region', { name: 'Signal health summary' }),
    ).toBeInTheDocument();
  });

  it('marks every metric icon decorative so screen readers announce the labels, not the glyphs', () => {
    const { container } = renderKpis();
    const icons = container.querySelectorAll('svg');

    // One decorative icon per card, and none of them expose an a11y name.
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(icons).toHaveLength(1);
    expect(Array.from(icons).every((svg) => svg.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
  });
});
