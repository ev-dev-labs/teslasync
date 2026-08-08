/**
 * BipolarBar — zero-centred bar for SIGNED measurements.
 *
 * The component exists because LinearGauge clamps at zero: regenerative
 * braking (negative torque) and reverse (negative axle speed) rendered
 * identically to a stationary car. This suite pins the direction semantics,
 * the asymmetric-scale geometry, the ARIA meter contract, and the null-safety
 * guards that keep the geometry finite for the optional API values callers
 * routinely forward.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BipolarBar } from './BipolarBar';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

beforeAll(() => {
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

/** The value fill is the first child of the track; the zero rule is the second. */
function fill(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[role="meter"] > div > div');
  if (!el) throw new Error('value fill not found');
  return el as HTMLElement;
}

function zeroRule(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[aria-hidden="true"]');
  if (!el) throw new Error('zero rule not found');
  return el as HTMLElement;
}

describe('BipolarBar — ARIA meter semantics', () => {
  it('exposes a labelled meter carrying the signed value and both range ends', () => {
    render(<BipolarBar value={-200} max={1000} min={400} label="Torque" unit=" Nm" />);

    const meter = screen.getByRole('meter', { name: 'Torque' });
    expect(meter).toHaveAttribute('aria-valuenow', '-200');
    expect(meter).toHaveAttribute('aria-valuemin', '-400');
    expect(meter).toHaveAttribute('aria-valuemax', '1000');
    expect(meter).toHaveAttribute('aria-valuetext', '-200 Nm');
  });

  it('defaults to a symmetric scale when min is omitted', () => {
    render(<BipolarBar value={0} max={500} label="Torque" />);

    const meter = screen.getByRole('meter', { name: 'Torque' });
    expect(meter).toHaveAttribute('aria-valuemin', '-500');
    expect(meter).toHaveAttribute('aria-valuemax', '500');
  });

  it('omits the unit from valuetext when none is supplied', () => {
    render(<BipolarBar value={12} max={100} label="Torque" />);
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute(
      'aria-valuetext',
      '12',
    );
  });

  it('drops aria-label when the label is empty rather than naming it ""', () => {
    const { container } = render(<BipolarBar value={1} max={10} label="" />);
    expect(container.querySelector('[role="meter"]')).not.toHaveAttribute('aria-label');
  });
});

describe('BipolarBar — direction (the reason this component exists)', () => {
  it('grows the fill to the RIGHT of the zero rule for a positive value', () => {
    const { container } = render(
      <BipolarBar value={500} max={1000} min={1000} label="Torque" />,
    );
    // Symmetric ±1000 → zero sits at 50%; +500 is half the positive half.
    expect(zeroRule(container)).toHaveStyle({ left: '50%' });
    expect(fill(container)).toHaveStyle({ left: '50%', width: '25%' });
  });

  it('grows the fill to the LEFT of the zero rule for a negative value', () => {
    const { container } = render(
      <BipolarBar value={-500} max={1000} min={1000} label="Torque" />,
    );
    // The fill STARTS 25% left of zero and runs back to it — never clamped
    // away the way the LinearGauge presentation did.
    expect(fill(container)).toHaveStyle({ left: '25%', width: '25%' });
  });

  it('renders a negative and a positive reading differently (regression)', () => {
    const neg = render(<BipolarBar value={-300} max={1000} min={1000} label="Torque" />);
    const negStyle = fill(neg.container as HTMLElement).getAttribute('style');
    neg.unmount();

    const pos = render(<BipolarBar value={300} max={1000} min={1000} label="Torque" />);
    const posStyle = fill(pos.container as HTMLElement).getAttribute('style');

    expect(negStyle).not.toBe(posStyle);
  });

  it('collapses the fill to zero width at exactly zero', () => {
    const { container } = render(
      <BipolarBar value={0} max={1000} min={1000} label="Torque" />,
    );
    expect(fill(container)).toHaveStyle({ width: '0%' });
  });

  it('applies the negative colour only below zero', () => {
    // jsdom normalises hex to rgb() inside the gradient.
    const neg = render(
      <BipolarBar
        value={-10}
        max={100}
        label="Torque"
        positiveColor="#111111"
        negativeColor="#222222"
      />,
    );
    expect(fill(neg.container as HTMLElement).getAttribute('style')).toContain(
      'rgb(34, 34, 34)',
    );
    neg.unmount();

    const pos = render(
      <BipolarBar
        value={10}
        max={100}
        label="Torque"
        positiveColor="#111111"
        negativeColor="#222222"
      />,
    );
    expect(fill(pos.container as HTMLElement).getAttribute('style')).toContain(
      'rgb(17, 17, 17)',
    );
  });
});

describe('BipolarBar — asymmetric scales', () => {
  it('places the zero rule where the real zero is, not at the midpoint', () => {
    // Regen absorbs far less than the drive limit puts down, so a symmetric
    // scale would waste most of the negative half.
    const { container } = render(
      <BipolarBar value={0} max={1000} min={400} label="Torque" />,
    );
    // negSpan / (negSpan + posSpan) = 400 / 1400 ≈ 28.57%
    const left = zeroRule(container).style.left;
    expect(Number.parseFloat(left)).toBeCloseTo(28.571, 2);
  });
});

describe('BipolarBar — clamping', () => {
  it('caps an over-max value to the positive end', () => {
    render(<BipolarBar value={99_999} max={1000} min={1000} label="Torque" />);
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute(
      'aria-valuenow',
      '1000',
    );
  });

  it('caps an under-min value to the negative end', () => {
    render(<BipolarBar value={-99_999} max={1000} min={400} label="Torque" />);
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute(
      'aria-valuenow',
      '-400',
    );
  });
});

describe('BipolarBar — non-finite / missing input (no NaN geometry)', () => {
  it('coerces a NaN value to zero', () => {
    const { container } = render(
      <BipolarBar value={Number.NaN} max={100} label="Torque" />,
    );
    expect(fill(container)).toHaveStyle({ width: '0%' });
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('guards a zero max so the geometry stays finite', () => {
    const { container } = render(<BipolarBar value={5} max={0} label="Torque" />);
    expect(fill(container)).toHaveStyle({ width: '0%' });
    expect(zeroRule(container)).toHaveStyle({ left: '0%' });
  });

  it('treats a NaN max as an empty range without NaN', () => {
    const { container } = render(
      <BipolarBar value={5} max={Number.NaN} label="Torque" />,
    );
    expect(fill(container).getAttribute('style')).not.toContain('NaN');
  });

  it('never throws for pathological inputs', () => {
    expect(() =>
      render(
        <BipolarBar
          value={Number.POSITIVE_INFINITY}
          max={-10}
          min={Number.NaN}
          label="Torque"
        />,
      ),
    ).not.toThrow();
  });

  it('stays finite when value and max are undefined at runtime', () => {
    const { container } = render(
      <BipolarBar
        value={undefined as unknown as number}
        max={undefined as unknown as number}
        label="Torque"
      />,
    );
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('BipolarBar — content', () => {
  it('renders the label, the reading and the unit', () => {
    render(<BipolarBar value={1234} max={5000} label="Front RPM" unit=" RPM" />);
    expect(screen.getByText('Front RPM')).toBeInTheDocument();
    // The reading is a bare text node with the unit nested beside it, so the
    // composed string is asserted through the meter's accessible value text.
    expect(screen.getByRole('meter', { name: 'Front RPM' })).toHaveAttribute(
      'aria-valuetext',
      '1,234 RPM',
    );
    expect(screen.getByText('RPM')).toBeInTheDocument();
  });

  it('honours an explicit decimals prop over the integer-zero default', () => {
    render(<BipolarBar value={12} max={100} label="Torque" decimals={2} />);
    expect(screen.getByText('12.00')).toBeInTheDocument();
  });

  it('renders the direction captions when supplied', () => {
    render(
      <BipolarBar
        value={0}
        max={100}
        label="Torque"
        negativeLabel="Regen"
        positiveLabel="Drive"
      />,
    );
    expect(screen.getByText('Regen')).toBeInTheDocument();
    expect(screen.getByText('Drive')).toBeInTheDocument();
  });

  it('omits the caption row entirely when neither direction label is given', () => {
    render(<BipolarBar value={0} max={100} label="Torque" />);
    expect(screen.queryByText('Regen')).toBeNull();
  });
});
