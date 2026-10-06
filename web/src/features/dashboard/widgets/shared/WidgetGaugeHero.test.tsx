/**
 * WidgetGaugeHero — comprehensive unit coverage for the shared gauge-hero shell.
 *
 * Exercises every export of WidgetGaugeHero.tsx:
 *   - `WidgetGaugeHero` — the presentational wrapper: the size branch
 *     (compact 70 vs standard 100), the numeric guards it feeds into the
 *     LinearGauge arc math, the conditional stats row, and the conditional
 *     children slot.
 *   - `GaugeHeroConfig` / `GaugeHeroStat` — the exported prop types, referenced
 *     as annotations on the fixtures below so the public contract is pinned.
 *
 * Bugs this pins (each assertion fails on the pre-hardened source):
 *   - A non-positive or non-finite `gauge.max` used to be forwarded verbatim,
 *     making LinearGauge divide by zero → a `NaN` stroke offset and a visually
 *     broken ring. It is now clamped to a safe 100-unit scale.
 *   - A non-finite `gauge.value` (NaN / Infinity / undefined from an optional
 *     upstream field) used to reach the arc math as-is; it now collapses to 0.
 *   - A nullish `stat.value` used to render a blank cell; it now shows an
 *     em-dash. `0` is still preserved (the `??` fix, not `||`).
 *   - Two stats sharing a label used to collide on `key={stat.label}`, emitting
 *     a React duplicate-key warning; the key is now `${label}-${index}`.
 *
 * Strategy:
 *   - LinearGauge is a heavy chart primitive (its barrel re-exports recharts).
 *     It is replaced with a prop-capturing stub so this stays a fast, focused
 *     unit test of WidgetGaugeHero's OWN logic — the exact numbers it forwards
 *     are asserted directly via data-* attributes, which is stronger evidence
 *     of each guard than inferring them from rendered SVG geometry. The stats
 *     row and children slot are WidgetGaugeHero's own DOM and are rendered for
 *     real. There is no network in this component, so nothing else is mocked.
 *   - The component renders no user-visible English of its own (all copy is
 *     supplied by callers via props), so there is no i18n boundary to stub.
 *
 * Compatibility discrepancy: the original numeric-guard assertions below
 * explicitly require fabricated 0/100 defaults. They remain unchanged.
 * The opt-in preservation contract instead forwards unknown readings and
 * invalid scales to the existing LinearGauge, which handles them safely.
 * These adapter tests establish forwarding, not the primitive's rendered
 * accessibility or geometry; all execution awaits consolidated validation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { LinearGauge } from '@/components/charts';
import { WidgetGaugeHero, type GaugeHeroConfig, type GaugeHeroStat } from './WidgetGaugeHero';

// ── LinearGauge stub — records the props WidgetGaugeHero forwards. ────────────
type LinearGaugeStubProps = ComponentProps<typeof LinearGauge>;

vi.mock('@/components/charts', () => ({
  LinearGauge: ({
    value, max, label, unit, color, size, min, ariaLabel, tone, status,
    kind, decimals, hideScale, marker, markerLabel,
  }: LinearGaugeStubProps) => (
    <div
      data-testid="linear-gauge"
      data-value={String(value)}
      data-max={String(max)}
      data-label={label}
      data-unit={unit ?? ''}
      data-color={color ?? ''}
      data-size={String(size)}
      data-min={String(min)}
      data-aria-label={ariaLabel}
      data-tone={tone}
      data-status={status}
      data-kind={kind}
      data-decimals={String(decimals)}
      data-hide-scale={String(hideScale)}
      data-marker={String(marker)}
      data-marker-label={markerLabel}
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
  it('forwards the gauge label, unit, and color to the LinearGauge', () => {
    render(<WidgetGaugeHero gauge={baseGauge} />);

    const gauge = screen.getByTestId('linear-gauge');
    expect(gauge).toHaveAttribute('data-label', 'Battery');
    expect(gauge).toHaveAttribute('data-unit', '%');
    expect(gauge).toHaveAttribute('data-color', '#10b981');
  });

  it('renders the standard size (100) by default and the compact size (70) when compact', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={baseGauge} />);
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-size', '100');

    rerender(<WidgetGaugeHero gauge={baseGauge} compact />);
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-size', '70');
  });

  it('forwards a finite gauge value (including 0) unchanged', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={{ ...baseGauge, value: 73 }} />);
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', '73');

    rerender(<WidgetGaugeHero gauge={{ ...baseGauge, value: 0 }} />);
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', '0');
  });

  it('forwards a valid positive max unchanged', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={{ ...baseGauge, max: 250 }} />);
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-max', '250');

    rerender(<WidgetGaugeHero gauge={{ ...baseGauge, max: 100 }} />);
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-max', '100');
  });
});

// ── Numeric guards (the bug fixes) ───────────────────────────────────────────
describe('WidgetGaugeHero — numeric guards', () => {
  it('collapses a non-finite gauge value to 0 so the arc math never sees NaN', () => {
    for (const badValue of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const { unmount } = render(
        <WidgetGaugeHero gauge={{ ...baseGauge, value: badValue as number }} />,
      );
      expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', '0');
      unmount();
    }
  });

  it('clamps a non-positive or non-finite max to a safe 100-unit scale', () => {
    for (const badMax of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { unmount } = render(<WidgetGaugeHero gauge={{ ...baseGauge, max: badMax }} />);
      // A raw 0/NaN here would make LinearGauge divide by zero → data-max="NaN".
      expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-max', '100');
      unmount();
    }
  });
});

describe('WidgetGaugeHero — preservation contract', () => {
  const preservedGauge: GaugeHeroConfig = {
    ...baseGauge,
    preserveReadingAndScale: true,
  };

  it('preserves unknown readings distinctly from a genuine zero', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={preservedGauge} />);

    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0]) {
      rerender(<WidgetGaugeHero gauge={{ ...preservedGauge, value }} />);
      expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', String(value));
    }
  });

  it('never invents a 100-unit ceiling for an invalid max in preservation mode', () => {
    const { rerender } = render(<WidgetGaugeHero gauge={preservedGauge} />);

    for (const max of [0, -50, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      rerender(<WidgetGaugeHero gauge={{ ...preservedGauge, max }} />);
      expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-max', String(max));
      expect(screen.getByTestId('linear-gauge')).not.toHaveAttribute('data-max', '100');
    }
  });

  it('preserves finite readings and caller interval bounds without conversion', () => {
    render(
      <WidgetGaugeHero gauge={{ ...preservedGauge, value: 120.2, min: 32, max: 302, unit: '°F' }} />,
    );

    const gauge = screen.getByTestId('linear-gauge');
    expect(gauge).toHaveAttribute('data-value', '120.2');
    expect(gauge).toHaveAttribute('data-min', '32');
    expect(gauge).toHaveAttribute('data-max', '302');
    expect(gauge).toHaveAttribute('data-unit', '°F');
  });

  it('forwards semantic, accessible, precision, scale and reference metadata in either mode', () => {
    const metadata: GaugeHeroConfig = {
      ...baseGauge,
      label: '',
      min: 10,
      ariaLabel: 'Battery charge',
      tone: 'warning',
      status: 'Below target',
      kind: 'measurement',
      decimals: 2,
      hideScale: true,
      marker: 90,
      markerLabel: 'Charge limit',
    };
    const { rerender } = render(<WidgetGaugeHero gauge={metadata} />);

    for (const preserveReadingAndScale of [false, true]) {
      rerender(<WidgetGaugeHero gauge={{ ...metadata, preserveReadingAndScale }} />);
      const gauge = screen.getByTestId('linear-gauge');
      expect(gauge).toHaveAttribute('data-label', '');
      expect(gauge).toHaveAttribute('data-min', '10');
      expect(gauge).toHaveAttribute('data-aria-label', 'Battery charge');
      expect(gauge).toHaveAttribute('data-tone', 'warning');
      expect(gauge).toHaveAttribute('data-color', '#10b981');
      expect(gauge).toHaveAttribute('data-status', 'Below target');
      expect(gauge).toHaveAttribute('data-kind', 'measurement');
      expect(gauge).toHaveAttribute('data-decimals', '2');
      expect(gauge).toHaveAttribute('data-hide-scale', 'true');
      expect(gauge).toHaveAttribute('data-marker', '90');
      expect(gauge).toHaveAttribute('data-marker-label', 'Charge limit');
    }
  });

  it('preserves explicit zero precision, false hideScale and count kind', () => {
    render(
      <WidgetGaugeHero gauge={{ ...preservedGauge, min: 0, decimals: 0, hideScale: false, kind: 'count' }} />,
    );
    const gauge = screen.getByTestId('linear-gauge');
    expect(gauge).toHaveAttribute('data-min', '0');
    expect(gauge).toHaveAttribute('data-decimals', '0');
    expect(gauge).toHaveAttribute('data-hide-scale', 'false');
    expect(gauge).toHaveAttribute('data-kind', 'count');
  });

  it('keeps standard stats and children, then suppresses both at compact size with an unknown reading', () => {
    const props = {
      gauge: { ...preservedGauge, value: null },
      stats: [{ label: 'Range', value: 0, unit: 'mi' }],
    };
    const { rerender } = render(
      <WidgetGaugeHero {...props}><div>charging-indicator</div></WidgetGaugeHero>,
    );
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', 'null');
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-size', '100');
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('charging-indicator')).toBeInTheDocument();

    rerender(
      <WidgetGaugeHero {...props} compact><div>charging-indicator</div></WidgetGaugeHero>,
    );
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', 'null');
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-size', '70');
    expect(screen.queryByText('Range')).not.toBeInTheDocument();
    expect(screen.queryByText('charging-indicator')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('linear-gauge')).toBeInTheDocument();
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
    expect(screen.getByTestId('linear-gauge')).toBeInTheDocument();
  });

  it('suppresses both the stats row and the children slot in compact mode (gauge only)', () => {
    const stats: GaugeHeroStat[] = [{ label: 'Range', value: 250, unit: 'mi' }];
    render(
      <WidgetGaugeHero gauge={baseGauge} stats={stats} compact>
        <div>charging-indicator</div>
      </WidgetGaugeHero>,
    );

    // The gauge is always present…
    expect(screen.getByTestId('linear-gauge')).toBeInTheDocument();
    // …but compact drops the stats and children chrome.
    expect(screen.queryByText('Range')).not.toBeInTheDocument();
    expect(screen.queryByText('charging-indicator')).not.toBeInTheDocument();
  });
});
