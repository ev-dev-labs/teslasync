// BatteryPill unit tests.
//
// Facets covered:
//   1. Renders the label + fmtInt-formatted percentage.
//   2. Exposes the gauge as a labelled ARIA `meter` with the correct
//      valuenow/min/max/valuetext.
//   3. Traffic-light colour bands (>=60 good, 30-59 warning, <30 critical)
//      drive the fill colour.
//   4. Over-100 levels clamp the *track* to 100% while still reporting the
//      real reading.
//   5. Negative levels clamp the track to 0% and flag critical.
//   6. Non-finite runtime input (NaN) is coerced to 0 instead of producing a
//      `NaN%` width (regression guard).
//   7. Fractional levels round for display but keep a precise track width.
//   8. Custom className merges onto the panel without dropping base layout.
//   9. The decorative icon + fill stay out of the accessibility tree.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BatteryPill } from './BatteryPill';
import { STATUS_COLORS } from '@/lib/colors';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { BatteryPanel } from '../weekly-digest-modernization/BatteryPanel';
import type { WeeklyDigestMetrics } from './useWeeklyDigest';
import type { StatPeriod } from '@/lib/metric-reference';

function fill(): HTMLElement {
  const meter = screen.getByRole('meter');
  const child = meter.firstElementChild as HTMLElement | null;
  if (!child) throw new Error('battery meter is missing its fill element');
  return child;
}

describe('BatteryPill', () => {
  it('renders the label and the fmtInt-formatted percentage', () => {
    render(<BatteryPill level={72} label="Front Left" />);

    expect(screen.getByText('Front Left')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('exposes the gauge as a labelled meter with clamped value + valuetext', () => {
    render(<BatteryPill level={72} label="Front Left" />);

    const meter = screen.getByRole('meter', { name: 'Front Left' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '72%');
  });

  it('paints the fill green in the healthy band (level >= 60)', () => {
    render(<BatteryPill level={85} label="Pack" />);

    expect(fill()).toHaveStyle({ width: '85%' });
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.good });
  });

  it('paints the fill amber in the warning band (30 <= level < 60)', () => {
    render(<BatteryPill level={45} label="Pack" />);

    expect(fill()).toHaveStyle({ width: '45%' });
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.warning });
  });

  it('paints the fill red in the critical band (level < 30)', () => {
    render(<BatteryPill level={12} label="Pack" />);

    expect(fill()).toHaveStyle({ width: '12%' });
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.critical });
  });

  it('clamps an over-100 level to a full track but reports the real reading', () => {
    render(<BatteryPill level={150} label="Pack" />);

    const meter = screen.getByRole('meter');
    expect(fill()).toHaveStyle({ width: '100%' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    // The textual readout is still the raw value, not the clamped track.
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.good });
  });

  it('clamps a negative level to an empty track and flags it critical', () => {
    render(<BatteryPill level={-10} label="Pack" />);

    const meter = screen.getByRole('meter');
    expect(fill()).toHaveStyle({ width: '0%' });
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(fill()).toHaveStyle({ backgroundColor: STATUS_COLORS.critical });
  });

  it('coerces a non-finite runtime level to 0 instead of a NaN width', () => {
    // Regression guard: the prop is typed `number` but real data can be NaN.
    render(<BatteryPill level={NaN} label="Pack" />);

    const meter = screen.getByRole('meter');
    expect(fill()).toHaveStyle({ width: '0%' });
    expect(fill().style.width).not.toContain('NaN');
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('rounds fractional levels for display but keeps a precise track width', () => {
    render(<BatteryPill level={85.7} label="Pack" />);

    // fmtInt rounds 85.7 -> "86" for the human-readable readout...
    expect(screen.getByText('86%')).toBeInTheDocument();
    // ...while the track geometry stays exact.
    expect(fill()).toHaveStyle({ width: '85.7%' });
  });

  it('merges a custom className onto the panel and keeps the base layout', () => {
    const { container } = render(
      <BatteryPill level={50} label="Pack" className="my-custom-pill" />,
    );

    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass('my-custom-pill');
    expect(panel).toHaveClass('flex', 'items-center', 'gap-3');
  });

  it('keeps the decorative fill out of the accessibility tree', () => {
    render(<BatteryPill level={50} label="Pack" />);

    expect(fill()).toHaveAttribute('aria-hidden', 'true');
    // Exactly one accessible gauge is exposed for the pill.
    expect(screen.getAllByRole('meter')).toHaveLength(1);
  });
});

describe('BatteryPill native quantitative integration', () => {
  it('uses the existing meter, original readout and compatible native consumers for all complete profiles', () => {
    const rules: postcss.Rule[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      .walkRules(rule => { rules.push(rule); });
    const { container } = render(<BatteryPill level={85.7} label="Average battery" />);
    container.setAttribute('data-app-design-preview', '');
    const meter = screen.getByRole('meter', { name: 'Average battery' });
    const reading = screen.getByText('86%');
    const label = screen.getByText('Average battery');
    expect(reading).toHaveAttribute('data-app-part', 'metric-reading');
    expect(label).toHaveAttribute('data-app-part', 'metric-label');
    expect(reading.parentElement).toHaveAttribute('aria-hidden', 'true');
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        expect(meter).toHaveAttribute('data-app-part', 'metric');
        expect(meter).toHaveAttribute('data-app-metric', 'bar');
        expect(meter).toHaveAttribute('data-metric-track');
        expect(meter).toHaveClass('ml-auto', 'h-2', 'w-16', 'overflow-hidden', 'rounded-full', 'bg-[var(--surface-3)]');
        expect(meter).toHaveAttribute('aria-valuenow', '85.7');
        expect(meter).toHaveAttribute('aria-valuetext', '86%');
        expect(fill()).toHaveAttribute('data-metric-fill');
        expect(fill()).toHaveAttribute('aria-hidden', 'true');
        expect(fill()).toHaveStyle({ width: '85.7%', backgroundColor: STATUS_COLORS.good });
        for (const [element, property] of [[meter, 'outline'], [fill(), 'min-inline-size'],
          [reading, 'font-variant-numeric'], [label, 'overflow-wrap']] as const) {
          const candidates = property === 'outline' || property === 'min-inline-size'
            ? rules.filter(rule => rule.selector.includes('[data-app-metric="bar"][data-metric-track]'))
            : rules;
          expect(candidates.some(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === property)
            && rule.selectors.some(selector => element.matches(selector)))).toBe(true);
        }
      } finally { release(); }
    }
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it.each([0, NaN, Infinity, -Infinity, undefined, null])('preserves the existing direct runtime %s fallback without inventing an unknown state', level => {
    render(<BatteryPill level={level as number} label="Runtime input" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('meter')).toHaveAttribute('data-metric-track');
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(fill()).toHaveStyle({ width: '0%', backgroundColor: STATUS_COLORS.critical });
  });

  it('keeps the real route presenter’s known-zero, missing readouts, rounding and feedback alternatives', () => {
    const metrics: WeeklyDigestMetrics = {
      totalDistanceM: 0, prevDistanceM: 0, totalDrives: 0, prevDriveCount: 0,
      energyUsedWh: 0, prevEnergyWh: 0, chargingCost: 0, prevChargingCost: 0,
      co2Saved: 0, prevCo2: 0, avgEfficiencyWhPerM: 0, prevAvgEfficiencyWhPerM: 0,
      totalDurationS: 0, topDrive: undefined, chargeEnergyAddedWh: null, prevChargeEnergyWh: null,
      avgChargePowerW: 0, chargingSessionCount: 1, batteryStart: 0, batteryEnd: null,
      alertsByType: {}, alertTotal: 0,
    };
    const period: StatPeriod = { kind: 'analysis', label: 'Selected week', start: '2026-11-02T00:00:00Z',
      endExclusive: '2026-11-09T00:00:00Z', timezone: 'UTC', completeness: 'unknown', provenance: 'Available history' };
    const tree = (overrides: Partial<Parameters<typeof BatteryPanel>[0]> = {}) => (
      <MemoryRouter><BatteryPanel metrics={metrics} period={period} {...overrides} /></MemoryRouter>
    );
    const { container, rerender } = render(tree());
    expect(screen.getAllByRole('meter')).toHaveLength(1);
    expect(screen.getByRole('meter', { name: 'Avg battery at charge start' })).toHaveAttribute('aria-valuenow', '0');
    const missingEnd = screen.getByText('Avg battery at charge end').closest('[data-app-part~="panel"]')!;
    expect(missingEnd).toHaveTextContent('—');
    expect(missingEnd.querySelector('[data-metric-track]')).toBeNull();
    rerender(tree({ metrics: { ...metrics, batteryStart: null } }));
    expect(container.querySelector('[data-metric-track]')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    rerender(tree({ metrics: { ...metrics, batteryStart: 20.4, batteryEnd: 80.6 } }));
    expect(screen.getAllByRole('meter').map(meter => meter.getAttribute('aria-valuetext'))).toEqual(['20%', '81%']);
    expect(container.querySelectorAll('[data-metric-track] > [data-metric-fill]')).toHaveLength(2);
    rerender(tree({ metrics: { ...metrics, chargingSessionCount: 0 } }));
    expect(screen.getByText('No battery data is available for this week.')).toBeInTheDocument();
    expect(container.querySelector('[data-metric-track]')).toBeNull();
    rerender(tree({ isLoading: true }));
    expect(container.querySelector('[data-metric-track]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Battery health' })).toBeInTheDocument();
    rerender(tree({ isError: true, error: new Error('History failed') }));
    expect(container.querySelector('[data-metric-track]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Battery health' })).toBeInTheDocument();
    rerender(tree());
    expect(screen.getByRole('meter', { name: 'Avg battery at charge start' })).toHaveAttribute('data-metric-track');
  });
});
