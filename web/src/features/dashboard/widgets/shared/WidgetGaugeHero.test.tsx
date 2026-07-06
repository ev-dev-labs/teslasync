/**
 * WidgetGaugeHero — comprehensive unit coverage for the shared gauge-hero shell.
 *
 * Exercises every export of WidgetGaugeHero.tsx:
 *   - `WidgetGaugeHero` — the presentational wrapper: the size branch
 *     (compact 70 vs standard 100), the numeric guards it feeds into the
 *     RadialGauge arc math, the conditional stats row, and the conditional
 *     children slot.
 *   - `GaugeHeroConfig` / `GaugeHeroStat` — the exported prop types, referenced
 *     as annotations on the fixtures below so the public contract is pinned.
 *
 * Bugs this pins (each assertion fails on the pre-hardened source):
 *   - A non-positive or non-finite `gauge.max` used to be forwarded verbatim,
 *     making RadialGauge divide by zero → a `NaN` stroke offset and a visually
 *     broken ring. It is now clamped to a safe 100-unit scale.
 *   - A non-finite `gauge.value` (NaN / Infinity / undefined from an optional
 *     upstream field) used to reach the arc math as-is; it now collapses to 0.
 *   - A nullish `stat.value` used to render a blank cell; it now shows an
 *     em-dash. `0` is still preserved (the `??` fix, not `||`).
 *   - Two stats sharing a label used to collide on `key={stat.label}`, emitting
 *     a React duplicate-key warning; the key is now `${label}-${index}`.
 *
 * Strategy:
 *   - RadialGauge is a heavy chart primitive (its barrel re-exports recharts).
 *     It is replaced with a prop-capturing stub so this stays a fast, focused
 *     unit test of WidgetGaugeHero's OWN logic — the exact numbers it forwards
 *     are asserted directly via data-* attributes, which is stronger evidence
 *     of each guard than inferring them from rendered SVG geometry. The stats
 *     row and children slot are WidgetGaugeHero's own DOM and are rendered for
 *     real. There is no network in this component, so nothing else is mocked.
 *   - The component renders no user-visible English of its own (all copy is
 *     supplied by callers via props), so there is no i18n boundary to stub.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WidgetGaugeHero, type GaugeHeroConfig, type GaugeHeroStat } from './WidgetGaugeHero';

// ── RadialGauge stub — records the props WidgetGaugeHero forwards. ────────────
interface RadialGaugeStubProps {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
}

vi.mock('@/components/charts', () => ({
  RadialGauge: ({ value, max, label, unit, color, size }: RadialGaugeStubProps) => (
    <div
      data-testid="radial-gauge"
      data-value={String(value)}
      data-max={String(max)}
      data-label={label}
      data-unit={unit ?? ''}
      data-color={color ?? ''}
      data-size={String(size)}
    />
  ),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────
const baseGauge: GaugeHeroConfig = {
  value: 85,
  max: 100,
  label: 'Battery',
  unit: '%',
  color: '#10b981',
};

afterEach(() => cleanup());

// ── Gauge prop forwarding ────────────────────────────────────────────────────
describe('WidgetGaugeHero — gauge forwarding', () => {
  it('forwards the gauge label, unit, and color to the RadialGauge', () => {
    render(<WidgetGaugeHero gauge={baseGauge} />);

    const gauge = screen.getByTestId('radial-gauge');
    expect(gauge).toHaveAttribute('data-label', 'Battery');
    expect(gauge).toHaveAttribute('data-unit', '%');
    expect(gauge).toHaveAttribute('data-color', '#10b981');
  });

  it('renders the standard size (100) by default and the compact size (70) when compact', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={baseGauge} />);
    expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-size', '100');

    rerender(<WidgetGaugeHero gauge={baseGauge} compact />);
    expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-size', '70');
  });

  it('forwards a finite gauge value (including 0) unchanged', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={{ ...baseGauge, value: 73 }} />);
    expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-value', '73');

    rerender(<WidgetGaugeHero gauge={{ ...baseGauge, value: 0 }} />);
    expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-value', '0');
  });

  it('forwards a valid positive max unchanged', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={{ ...baseGauge, max: 250 }} />);
    expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-max', '250');

    rerender(<WidgetGaugeHero gauge={{ ...baseGauge, max: 100 }} />);
    expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-max', '100');
  });
});

// ── Numeric guards (the bug fixes) ───────────────────────────────────────────
describe('WidgetGaugeHero — numeric guards', () => {
  it('collapses a non-finite gauge value to 0 so the arc math never sees NaN', () => {
    for (const badValue of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const { unmount } = render(
        <WidgetGaugeHero gauge={{ ...baseGauge, value: badValue as number }} />,
      );
      expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-value', '0');
      unmount();
    }
  });

  it('clamps a non-positive or non-finite max to a safe 100-unit scale', () => {
    for (const badMax of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { unmount } = render(<WidgetGaugeHero gauge={{ ...baseGauge, max: badMax }} />);
      // A raw 0/NaN here would make RadialGauge divide by zero → data-max="NaN".
      expect(screen.getByTestId('radial-gauge')).toHaveAttribute('data-max', '100');
      unmount();
    }
  });
});

// ── Stats row ────────────────────────────────────────────────────────────────
describe('WidgetGaugeHero — stats row', () => {
  it('renders every stat label, value, and unit when not compact', () => {
    const stats: GaugeHeroStat[] = [
      { label: 'Range', value: 250, unit: 'mi' },
      { label: 'Cycles', value: '1.2k' },
    ];
    render(<WidgetGaugeHero gauge={baseGauge} stats={stats} />);

    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('Cycles')).toBeInTheDocument();
    expect(screen.getByText('1.2k')).toBeInTheDocument();
  });

  it('does not render a stats row when stats is empty or omitted', () => {
    const { container, rerender } = render(<WidgetGaugeHero gauge={baseGauge} />);
    // The stats wrapper is the only `.flex-wrap` element in the tree.
    expect(container.querySelector('.flex-wrap')).toBeNull();

    rerender(<WidgetGaugeHero gauge={baseGauge} stats={[]} />);
    expect(container.querySelector('.flex-wrap')).toBeNull();

    // The gauge still renders in both cases (never a blank panel).
    expect(screen.getByTestId('radial-gauge')).toBeInTheDocument();
  });

  it('renders an em-dash for a stat whose value is nullish (never a blank cell)', () => {
    const stats = [{ label: 'Range', value: undefined }] as unknown as GaugeHeroStat[];
    render(<WidgetGaugeHero gauge={baseGauge} stats={stats} />);

    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an em-dash for a stat whose label is nullish while still showing its value', () => {
    const stats = [{ label: undefined, value: 42 }] as unknown as GaugeHeroStat[];
    render(<WidgetGaugeHero gauge={baseGauge} stats={stats} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('preserves a zero stat value instead of coercing it to the em-dash fallback', () => {
    const stats: GaugeHeroStat[] = [{ label: 'Errors', value: 0 }];
    render(<WidgetGaugeHero gauge={baseGauge} stats={stats} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('uses stable unique keys for stats that share a label (no React duplicate-key warning)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stats: GaugeHeroStat[] = [
      { label: 'Phase', value: 'A' },
      { label: 'Phase', value: 'B' },
    ];

    render(<WidgetGaugeHero gauge={baseGauge} stats={stats} />);

    // Both duplicate-labelled rows still render…
    expect(screen.getAllByText('Phase')).toHaveLength(2);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();

    // …and React did NOT warn about a non-unique key (the pre-fix
    // key={stat.label} collided for identical labels).
    const warnedOnKeys = errSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && /same key/i.test(a)),
    );
    expect(warnedOnKeys).toBe(false);

    errSpy.mockRestore();
  });
});

// ── Children slot + compact suppression ──────────────────────────────────────
describe('WidgetGaugeHero — children slot', () => {
  it('renders children below the gauge when not compact', () => {
    render(
      <WidgetGaugeHero gauge={baseGauge}>
        <div>charging-indicator</div>
      </WidgetGaugeHero>,
    );

    expect(screen.getByText('charging-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('radial-gauge')).toBeInTheDocument();
  });

  it('suppresses both the stats row and the children slot in compact mode (gauge only)', () => {
    const stats: GaugeHeroStat[] = [{ label: 'Range', value: 250, unit: 'mi' }];
    render(
      <WidgetGaugeHero gauge={baseGauge} stats={stats} compact>
        <div>charging-indicator</div>
      </WidgetGaugeHero>,
    );

    // The gauge is always present…
    expect(screen.getByTestId('radial-gauge')).toBeInTheDocument();
    // …but compact drops the stats and children chrome.
    expect(screen.queryByText('Range')).not.toBeInTheDocument();
    expect(screen.queryByText('charging-indicator')).not.toBeInTheDocument();
  });
});
