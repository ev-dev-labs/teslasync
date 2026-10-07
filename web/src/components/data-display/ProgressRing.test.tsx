/**
 * ProgressRing — geometry, null-safety, variants and a11y coverage.
 *
 * The sole export is the <ProgressRing> gauge. It draws two SVG circles: a
 * static track (`stroke="currentColor"`) and a round-capped progress arc whose
 * `stroke-dashoffset` encodes the `value / max` fraction. The tests therefore
 * assert on the real rendered SVG geometry (dasharray / dashoffset / radius),
 * not a smoke render, and pin down the hardening added around the arithmetic:
 *   - non-finite `value` (undefined / NaN / Infinity while data loads),
 *   - `max = 0` (a division-by-zero that used to emit `NaN` dashoffset),
 *   - `strokeWidth > size` (a negative radius → invalid SVG),
 *   - out-of-range `value` clamped to the [empty, full] ends.
 * It also verifies the screen-reader semantics: the ring is exposed as a single
 * labelled `role="img"`, the decorative SVG + centre text are `aria-hidden`.
 *
 * i18n is mocked to echo the English fallback with `{{var}}` interpolation, the
 * same convention the sibling data-display tests use.
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProgressRing } from './ProgressRing';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      let tpl = fallback ?? '';
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
      }
      return tpl;
    },
  }),
}));

// Geometry for the default 48px ring with a 4px stroke: radius (48-4)/2 = 22.
const R_DEFAULT = 22;
const C_DEFAULT = 2 * Math.PI * R_DEFAULT;

/** Split the two SVG circles into the round-capped progress arc + static track. */
function circles(container: HTMLElement): { arc: SVGCircleElement | null; track: SVGCircleElement | null } {
  const all = Array.from(container.querySelectorAll('circle'));
  const arc = (all.find((el) => el.getAttribute('stroke-linecap') === 'round') ?? null) as SVGCircleElement | null;
  const track = (all.find((el) => el.getAttribute('stroke-linecap') !== 'round') ?? null) as SVGCircleElement | null;
  return { arc, track };
}

/** Read an SVG numeric attribute (e.g. stroke-dashoffset) as a JS number. */
function attrNum(el: Element | null, name: string): number {
  return Number(el?.getAttribute(name));
}

describe('ProgressRing — structure', () => {
  it('renders a track circle and a round-capped progress arc', () => {
    const { container } = render(<ProgressRing value={50} />);

    expect(container.querySelector('svg')).not.toBeNull();
    const { arc, track } = circles(container);
    expect(arc).not.toBeNull();
    expect(track).not.toBeNull();
    // The arc carries the progress colour; the track is the neutral rail.
    expect(arc?.getAttribute('stroke')).toBe('#3b82f6');
    expect(track?.getAttribute('stroke')).toBe('currentColor');
  });

  it('centres both circles and shares one radius', () => {
    const { container } = render(<ProgressRing value={50} size={48} strokeWidth={4} />);
    const { arc, track } = circles(container);

    expect(attrNum(arc, 'cx')).toBe(24);
    expect(attrNum(arc, 'cy')).toBe(24);
    expect(attrNum(arc, 'r')).toBe(R_DEFAULT);
    expect(attrNum(track, 'r')).toBe(R_DEFAULT);
    expect(attrNum(arc, 'stroke-dasharray')).toBeCloseTo(C_DEFAULT, 5);
  });
});

describe('ProgressRing — value → arc geometry', () => {
  it('offsets the arc by half the circumference at 50%', () => {
    const { container } = render(<ProgressRing value={50} max={100} />);
    const { arc } = circles(container);
    expect(attrNum(arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT / 2, 5);
  });

  it('draws an empty arc at 0% and a full arc at 100%', () => {
    const { container: empty } = render(<ProgressRing value={0} max={100} />);
    expect(attrNum(circles(empty).arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT, 5);

    const { container: full } = render(<ProgressRing value={100} max={100} />);
    expect(attrNum(circles(full).arc, 'stroke-dashoffset')).toBeCloseTo(0, 5);
  });

  it('respects a non-100 max when computing the fraction', () => {
    // 1 of 4 → 25% → offset is three-quarters of the circumference.
    const { container } = render(<ProgressRing value={1} max={4} />);
    expect(attrNum(circles(container).arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT * 0.75, 5);
  });
});

describe('ProgressRing — clamping & null-safety (bug fixes)', () => {
  it('clamps an over-max value to a full arc', () => {
    const { container } = render(<ProgressRing value={150} max={100} />);
    expect(attrNum(circles(container).arc, 'stroke-dashoffset')).toBeCloseTo(0, 5);
  });

  it('clamps a negative value to an empty arc', () => {
    const { container } = render(<ProgressRing value={-10} max={100} />);
    expect(attrNum(circles(container).arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT, 5);
  });

  it('renders an empty (finite) arc for a NaN value instead of a NaN dashoffset', () => {
    const { container } = render(<ProgressRing value={NaN} max={100} />);
    const arc = circles(container).arc;
    // Regression: NaN used to propagate to stroke-dashoffset and collapse the arc.
    expect(arc?.getAttribute('stroke-dashoffset')).not.toBe('NaN');
    expect(Number.isFinite(attrNum(arc, 'stroke-dashoffset'))).toBe(true);
    expect(attrNum(arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT, 5);
  });

  it('treats an undefined value as zero rather than throwing or emitting NaN', () => {
    const { container } = render(<ProgressRing value={undefined as unknown as number} />);
    const arc = circles(container).arc;
    expect(arc?.getAttribute('stroke-dashoffset')).not.toBe('NaN');
    expect(attrNum(arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT, 5);
  });

  it('never divides by zero when max is 0', () => {
    const { container } = render(<ProgressRing value={50} max={0} />);
    const arc = circles(container).arc;
    // max falls back to the 100 default, so 50 renders at the half mark — the
    // point is that the dashoffset stays finite instead of NaN/Infinity.
    expect(arc?.getAttribute('stroke-dashoffset')).not.toBe('NaN');
    expect(Number.isFinite(attrNum(arc, 'stroke-dashoffset'))).toBe(true);
    expect(attrNum(arc, 'stroke-dashoffset')).toBeCloseTo(C_DEFAULT / 2, 5);
  });

  it('clamps the radius to zero when strokeWidth exceeds size', () => {
    const { container } = render(<ProgressRing value={50} size={20} strokeWidth={40} />);
    const { arc, track } = circles(container);
    // (20 - 40) / 2 = -10 → clamped to 0 so the SVG radius stays valid.
    expect(attrNum(arc, 'r')).toBe(0);
    expect(attrNum(track, 'r')).toBe(0);
    expect(Number.isFinite(attrNum(arc, 'stroke-dashoffset'))).toBe(true);
  });
});

describe('ProgressRing — variants', () => {
  it('applies a custom colour, size and strokeWidth', () => {
    const { container } = render(
      <ProgressRing value={50} color="#ff0000" size={140} strokeWidth={10} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('140');
    expect(svg?.getAttribute('height')).toBe('140');

    const { arc } = circles(container);
    expect(arc?.getAttribute('stroke')).toBe('#ff0000');
    expect(attrNum(arc, 'stroke-width')).toBe(10);
    expect(attrNum(arc, 'r')).toBe(65); // (140 - 10) / 2
  });

  it('renders the centre label and sub-label text', () => {
    render(<ProgressRing value={75} centerLabel="75%" centerSubLabel="fresh" />);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('fresh')).toBeInTheDocument();
  });

  it('renders the legacy label beneath the ring', () => {
    render(<ProgressRing value={50} label="Battery" />);
    expect(screen.getByText('Battery')).toBeInTheDocument();
  });

  it('merges a custom className onto the outer wrapper', () => {
    const { container } = render(<ProgressRing value={50} className="mt-4" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('mt-4');
    expect(root).toHaveClass('inline-flex');
  });

  it('forwards a ref to the outer wrapper element', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ProgressRing value={50} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('inline-flex');
  });
});

describe('ProgressRing — accessibility', () => {
  it('exposes the ring as a single labelled image with a percentage default', () => {
    render(<ProgressRing value={75} max={100} />);
    const gauge = screen.getByRole('img', { name: 'Progress: 75%' });
    expect(gauge).toBeInTheDocument();
    // The decorative SVG must be hidden so the img is the only exposed node.
    expect(gauge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('rounds the percentage in the default label', () => {
    render(<ProgressRing value={1} max={3} />);
    // 1/3 = 33.33% → rounded to 33.
    expect(screen.getByRole('img', { name: 'Progress: 33%' })).toBeInTheDocument();
  });

  it('prefers an explicit ariaLabel over the percentage default', () => {
    render(<ProgressRing value={40} ariaLabel="Signal freshness" />);
    expect(screen.getByRole('img', { name: 'Signal freshness' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Progress: 40%' })).not.toBeInTheDocument();
  });

  it('hides the centre value text from assistive tech', () => {
    render(<ProgressRing value={90} centerLabel="90%" />);
    // The centre text lives inside an aria-hidden container.
    const hidden = screen.getByText('90%').closest('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
  });
});
