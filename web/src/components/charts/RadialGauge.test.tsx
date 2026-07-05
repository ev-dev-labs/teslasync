/**
 * RadialGauge — behaviour, geometry, robustness and a11y.
 *
 * RadialGauge is a low-level SVG display primitive (no data fetching, no user
 * interaction) so the suite focuses on:
 *   - the visible readout (value / unit / label) and its ARIA `meter` mapping;
 *   - the ring geometry (two concentric circles, dash-array == circumference,
 *     dash-offset encodes the fill fraction);
 *   - clamping (over-max caps to a full ring, negatives to an empty one);
 *   - the two real bugs the hardening pass fixed:
 *       1. an undefined / NaN `value` (or a NaN / zero `max`) produced
 *          `strokeDashoffset={NaN}`, blanking the arc — now coerced to a finite
 *          zero-fill ring;
 *       2. the centred value overlay was `position: absolute` with no
 *          positioned ancestor, so it never sat over the ring — now anchored in
 *          a `relative` box sized to the svg.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { RadialGauge } from './RadialGauge';
import { setGlobalPrecision } from '@/lib/numberFormat';

// ── Geometry references (mirror the source constants). ──
const STROKE_WIDTH = 8;
const RADIUS = (size = 120) => (size - STROKE_WIDTH) / 2;
const CIRC = (size = 120) => 2 * Math.PI * RADIUS(size);

// The gauge renders two concentric <circle>s: [0] is the static track
// (stroke="currentColor"), [1] is the value arc (stroke=color, dash-offset).
const circles = (c: HTMLElement) => Array.from(c.querySelectorAll('circle'));
const track = (c: HTMLElement) => circles(c)[0];
const arc = (c: HTMLElement) => circles(c)[1];
const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr));

describe('RadialGauge — rendering & content', () => {
  it('renders the value, the unit, and the label as distinct text nodes', () => {
    render(<RadialGauge value={72} max={100} label="Battery" unit="%" />);

    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
  });

  it('formats the reading through fmtNumber (locale thousands separators)', () => {
    render(<RadialGauge value={1500} max={2000} label="Range" />);
    expect(screen.getByText('1,500')).toBeInTheDocument();
  });
});

describe('RadialGauge — ARIA meter semantics', () => {
  it('exposes the gauge as a labelled meter with value / min / max / valuetext', () => {
    render(<RadialGauge value={72} max={100} label="Battery" unit="%" />);

    const meter = screen.getByRole('meter', { name: 'Battery' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '72%');
  });

  it('reports the clamped (not raw) value on aria-valuenow', () => {
    render(<RadialGauge value={150} max={100} label="Battery" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('RadialGauge — ring geometry', () => {
  it('draws a static track and a value arc as two concentric circles', () => {
    const { container } = render(<RadialGauge value={50} max={100} label="X" />);

    expect(circles(container)).toHaveLength(2);
    expect(track(container)).toHaveAttribute('stroke', 'currentColor');
    expect(arc(container)).toHaveAttribute('stroke', '#3b82f6');
  });

  it('sets the dash array to the full circumference', () => {
    const { container } = render(<RadialGauge value={50} max={100} label="X" />);
    expect(num(arc(container), 'stroke-dasharray')).toBeCloseTo(CIRC(), 5);
  });

  it('offsets the arc by half the circumference at the midpoint', () => {
    const { container } = render(<RadialGauge value={50} max={100} label="X" />);
    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(CIRC() / 2, 5);
  });

  it('draws an empty ring (offset == circumference) at zero', () => {
    const { container } = render(<RadialGauge value={0} max={100} label="X" />);
    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(CIRC(), 5);
  });

  it('draws a full ring (offset ~ 0) at the maximum', () => {
    const { container } = render(<RadialGauge value={100} max={100} label="X" />);
    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(0, 5);
  });
});

describe('RadialGauge — clamping', () => {
  it('caps an over-max value to a full ring and a capped reading', () => {
    const { container } = render(<RadialGauge value={150} max={100} label="X" />);

    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(0, 5);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('pins a negative value to an empty ring and a zero reading', () => {
    const { container } = render(<RadialGauge value={-25} max={100} label="X" />);

    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(CIRC(), 5);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('RadialGauge — non-finite / missing input (no NaN geometry)', () => {
  it('coerces a NaN value to a finite zero-fill ring', () => {
    const { container } = render(<RadialGauge value={NaN} max={100} label="X" />);

    expect(Number.isNaN(num(arc(container), 'stroke-dashoffset'))).toBe(false);
    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(CIRC(), 5);
    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('guards a zero max (0 / 0) so the arc offset stays finite', () => {
    const { container } = render(<RadialGauge value={5} max={0} label="X" />);

    expect(container.innerHTML).not.toContain('NaN');
    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(CIRC(), 5);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '0');
  });

  it('treats a NaN max as an empty range without NaN', () => {
    const { container } = render(<RadialGauge value={50} max={NaN} label="X" />);

    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '0');
  });

  it('stays finite when value AND max are undefined at runtime', () => {
    const { container } = render(
      <RadialGauge
        value={undefined as unknown as number}
        max={undefined as unknown as number}
        label="X"
      />,
    );

    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(num(arc(container), 'stroke-dashoffset')).toBeCloseTo(CIRC(), 5);
  });

  it('never throws for pathological inputs (Infinity value, negative max)', () => {
    expect(() =>
      render(<RadialGauge value={Infinity} max={-5} label="X" />),
    ).not.toThrow();
  });
});

describe('RadialGauge — decimals', () => {
  // fmtNumber reads a module-global precision; restore the default after each
  // case so the surrounding integer-default tests stay deterministic.
  afterEach(() => setGlobalPrecision(2));

  it('renders integers with no fractional digits by default', () => {
    render(<RadialGauge value={50} max={100} label="X" />);
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('falls back to the global precision for a non-integer value', () => {
    setGlobalPrecision(2);
    render(<RadialGauge value={42.567} max={100} label="X" />);
    expect(screen.getByText('42.57')).toBeInTheDocument();
  });

  it('honours an explicit decimals prop over the integer-zero default', () => {
    render(<RadialGauge value={50} max={100} label="X" decimals={1} />);
    expect(screen.getByText('50.0')).toBeInTheDocument();
  });

  it('treats decimals={0} as an override, not a missing value', () => {
    render(<RadialGauge value={42.9} max={100} label="X" decimals={0} />);
    expect(screen.getByText('43')).toBeInTheDocument();
  });
});

describe('RadialGauge — styling', () => {
  it('applies a custom color to the arc while the track stays currentColor', () => {
    const { container } = render(
      <RadialGauge value={10} max={100} label="X" color="#10b981" />,
    );

    expect(arc(container)).toHaveAttribute('stroke', '#10b981');
    expect(track(container)).toHaveAttribute('stroke', 'currentColor');
  });

  it('sizes the svg and the relative overlay box from the size prop', () => {
    const { container } = render(<RadialGauge value={10} max={100} label="X" size={200} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '200');
    expect(svg).toHaveAttribute('height', '200');

    // The overlay's containing block (the fix for the missing-`relative` bug)
    // is a positioned box sized to the svg so the readout centres over the ring.
    const box = svg?.parentElement as HTMLElement;
    expect(box.className).toContain('relative');
    expect(box.style.width).toBe('200px');
    expect(box.style.height).toBe('200px');
  });

  it('scales the ring geometry with the size prop', () => {
    const { container } = render(<RadialGauge value={100} max={100} label="X" size={200} />);
    expect(num(arc(container), 'stroke-dasharray')).toBeCloseTo(CIRC(200), 5);
  });

  it('merges a custom className onto the meter root', () => {
    render(<RadialGauge value={10} max={100} label="X" className="mt-4" />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveClass('mt-4');
    expect(meter).toHaveClass('inline-flex');
  });
});

describe('RadialGauge — unit handling', () => {
  it('omits the unit suffix from valuetext when no unit is supplied', () => {
    render(<RadialGauge value={7} max={10} label="Count" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '7');
  });

  it('renders the unit and appends it to the accessible valuetext', () => {
    render(<RadialGauge value={7} max={10} label="Count" unit="kWh" />);

    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '7kWh');
  });

  it('treats an empty-string unit as no unit', () => {
    render(<RadialGauge value={7} max={10} label="Count" unit="" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '7');
  });
});

describe('RadialGauge — accessibility', () => {
  it('leaves the gauge svg non-hidden (callers count it as the lone visible svg)', () => {
    const { container } = render(<RadialGauge value={10} max={100} label="X" />);

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('class') ?? '').toContain('-rotate-90');
  });

  it('exposes exactly one meter per gauge, named by its label', () => {
    render(<RadialGauge value={10} max={100} label="Regen" />);

    expect(screen.getAllByRole('meter')).toHaveLength(1);
    expect(screen.getByRole('meter', { name: 'Regen' })).toBeInTheDocument();
  });

  it('drops aria-label when the label is empty rather than naming it ""', () => {
    render(<RadialGauge value={10} max={100} label="" />);
    expect(screen.getByRole('meter')).not.toHaveAttribute('aria-label');
  });
});

describe('RadialGauge — ref forwarding', () => {
  it('forwards the ref to the meter root element', () => {
    const ref = createRef<HTMLDivElement>();
    render(<RadialGauge ref={ref} value={10} max={100} label="X" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveAttribute('role', 'meter');
  });
});
