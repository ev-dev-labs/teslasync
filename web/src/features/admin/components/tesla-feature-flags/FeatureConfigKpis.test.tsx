/**
 * FeatureConfigKpis — feature-config KPI band contract.
 *
 * A pure presentational band that turns a `FeatureFlagSummary` into four
 * MetricCards (total / enabled / disabled / enabled-rate). It has three
 * mutually-exclusive render modes and these tests pin every one:
 *   - loading  → a layout-preserving StatGridSkeleton (no metric labels yet),
 *     and loading wins over a concurrent error so the row never flashes dashes;
 *   - error    → every value degrades to an em-dash (a fetch failure is never
 *     dressed up as a truthful "0 features"), while the labels stay put;
 *   - resolved → truthful, locale-formatted integer counts + an "N%" rate,
 *     with a genuine empty summary rendering honest zeros (distinct from the
 *     error em-dash) and a nullish summary tolerated without throwing.
 * Also covers locale integer grouping (fmtInt), the falsy-error passthrough,
 * and that the metric icons are decorative (aria-hidden), so assistive tech
 * announces the labels/values, not the glyphs. Nothing touches the network —
 * the component is pure and only reads i18n resources.
 */
import { type ComponentProps } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';

import { FeatureConfigKpis } from './FeatureConfigKpis';
import type { FeatureFlagSummary } from './parseFeatureFlags';

type KpisProps = ComponentProps<typeof FeatureConfigKpis>;

const SUMMARY: FeatureFlagSummary = { total: 4, enabled: 2, disabled: 2, enabledRate: 50 };
const ZEROED: FeatureFlagSummary = { total: 0, enabled: 0, disabled: 0, enabledRate: 0 };

const ALL_LABELS = ['Total Features', 'Enabled', 'Disabled', 'Enabled Rate'];
/** The em-dash (U+2014) the band renders for an unknown value under error. */
const EM_DASH = '—';

function renderKpis(overrides: Partial<KpisProps> = {}) {
  const props: KpisProps = {
    summary: SUMMARY,
    isLoading: false,
    ...overrides,
  };
  return render(<FeatureConfigKpis {...props} />);
}

/**
 * Read the value a MetricCard renders for a given label. MetricCard emits
 * `<p class="metric-label"><span>{label}</span></p>` immediately followed by
 * `<p class="text-xl">{value}</p>`, so we hop label span → parent → next
 * sibling without coupling to brittle class selectors on the value node.
 */
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  return labelSpan.parentElement?.nextElementSibling?.textContent ?? '';
}

describe('FeatureConfigKpis — loading', () => {
  it('renders a layout-preserving skeleton grid with no metric labels while loading', () => {
    const { container } = renderKpis({ isLoading: true });

    expect(
      screen.getByRole('status', { name: /loading stat cards/i }),
    ).toBeInTheDocument();
    // Four placeholder cards keep the row's footprint so data landing does
    // not shift the layout.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
    // The real MetricCards (and their labels) must not render yet.
    expect(screen.queryByText('Total Features')).toBeNull();
  });

  it('gives loading precedence over error — a skeleton, never em-dashes', () => {
    renderKpis({ isLoading: true, error: new Error('boom') });

    expect(
      screen.getByRole('status', { name: /loading stat cards/i }),
    ).toBeInTheDocument();
    // isLoading short-circuits before the error branch is considered.
    expect(screen.queryByText(EM_DASH)).toBeNull();
    expect(screen.queryByText('Total Features')).toBeNull();
  });
});

describe('FeatureConfigKpis — resolved', () => {
  it('renders all four labels and truthful, locale-formatted values', () => {
    renderKpis({ summary: SUMMARY });

    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(metricValue('Total Features')).toBe('4');
    expect(metricValue('Enabled')).toBe('2');
    expect(metricValue('Disabled')).toBe('2');
    expect(metricValue('Enabled Rate')).toBe('50%');
    // Truthful data → no fabricated em-dash placeholders.
    expect(screen.queryByText(EM_DASH)).toBeNull();
  });

  it('formats large counts with locale separators and the rate as a whole percent', () => {
    renderKpis({
      summary: { total: 12345, enabled: 10000, disabled: 2345, enabledRate: 81 },
    });

    expect(metricValue('Total Features')).toBe('12,345');
    expect(metricValue('Enabled')).toBe('10,000');
    expect(metricValue('Disabled')).toBe('2,345');
    // fmtPercent(..., 0) drops the decimals → "81%", not "81.00%".
    expect(metricValue('Enabled Rate')).toBe('81%');
  });

  it('renders honest zeros for a genuinely empty (but successful) summary', () => {
    renderKpis({ summary: ZEROED });

    expect(metricValue('Total Features')).toBe('0');
    expect(metricValue('Enabled')).toBe('0');
    expect(metricValue('Disabled')).toBe('0');
    expect(metricValue('Enabled Rate')).toBe('0%');
    // A known-empty payload is a real 0, distinct from the error em-dash.
    expect(screen.queryByText(EM_DASH)).toBeNull();
  });

  it('treats a falsy error (null) as no error and shows the data', () => {
    renderKpis({ summary: SUMMARY, error: null });

    expect(metricValue('Total Features')).toBe('4');
    expect(metricValue('Enabled Rate')).toBe('50%');
    expect(screen.queryByText(EM_DASH)).toBeNull();
  });
});

describe('FeatureConfigKpis — error', () => {
  it('degrades every value to an em-dash without fabricating zeros when the source errored', () => {
    renderKpis({ summary: SUMMARY, error: new Error('down') });

    // Labels stay so the row is still self-describing.
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Every metric collapses to the unknown placeholder...
    expect(screen.getAllByText(EM_DASH)).toHaveLength(4);
    // ...and the real values (and any fabricated 0) are suppressed.
    expect(screen.queryByText('4')).toBeNull();
    expect(screen.queryByText('50%')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('FeatureConfigKpis — null-safety & a11y', () => {
  it('degrades to truthful zeros without throwing when summary is nullish', () => {
    // A misbehaving caller hands over no summary at all.
    renderKpis({ summary: undefined as unknown as FeatureFlagSummary });

    expect(metricValue('Total Features')).toBe('0');
    expect(metricValue('Enabled')).toBe('0');
    expect(metricValue('Enabled Rate')).toBe('0%');
    expect(screen.queryByText(EM_DASH)).toBeNull();
  });

  it('marks the metric icons as decorative so assistive tech skips the glyphs', () => {
    const { container } = renderKpis({ summary: SUMMARY });

    // One decorative icon per card, each hidden from the accessibility tree.
    const decorativeIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(decorativeIcons).toHaveLength(4);
    // No icon is exposed as meaningful content that would be announced.
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });
});
