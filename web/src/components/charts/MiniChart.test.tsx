import { describe, it, expect } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { MiniChart } from './MiniChart';

// Geometry reference (defaults: width=100, height=32, padding=2):
//   x_i = (i / (n - 1)) * (width - 4) + 2      → spans [2, width - 2]
//   y_i = height - 2 - ((v - min) / range) * (height - 4)  (max at top)
const polyline = (c: HTMLElement) => c.querySelector('polyline');
const svg = (c: HTMLElement) => c.querySelector('svg');

describe('MiniChart — guards', () => {
  it('renders nothing for empty data (a trend needs two points)', () => {
    const { container } = render(<MiniChart data={[]} />);
    expect(container.firstChild).toBeNull();
    expect(svg(container)).toBeNull();
  });

  it('renders nothing for a single data point', () => {
    const { container } = render(<MiniChart data={[42]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an svg polyline once there are two or more points', () => {
    const { container } = render(<MiniChart data={[1, 2]} />);
    expect(svg(container)).not.toBeNull();
    expect(polyline(container)).not.toBeNull();
  });
});

describe('MiniChart — geometry', () => {
  it('maps the minimum to the bottom and the maximum to the top', () => {
    const { container } = render(<MiniChart data={[0, 10]} />);
    // v=0 (min) → y = height - padding = 30; v=10 (max) → y = padding = 2.
    expect(polyline(container)?.getAttribute('points')).toBe('2,30 98,2');
  });

  it('emits exactly one coordinate pair per datum', () => {
    const { container } = render(<MiniChart data={[1, 2, 3, 4, 5]} />);
    const points = polyline(container)?.getAttribute('points') ?? '';
    expect(points.split(' ')).toHaveLength(5);
  });

  it('draws a flat baseline for a constant series without producing NaN', () => {
    const { container } = render(<MiniChart data={[5, 5, 5]} />);
    // range collapses to 1 via the `|| 1` guard → every y pins to the baseline.
    const points = polyline(container)?.getAttribute('points') ?? '';
    expect(points).toBe('2,30 50,30 98,30');
    expect(points).not.toContain('NaN');
  });

  it('handles negative values by anchoring the range to the true minimum', () => {
    const { container } = render(<MiniChart data={[-10, 0, 10]} />);
    // min=-10, max=10, range=20 → mid value sits halfway up (y=16).
    expect(polyline(container)?.getAttribute('points')).toBe('2,30 50,16 98,2');
  });

  it('respects custom width and height on both the svg and the geometry', () => {
    const { container } = render(<MiniChart data={[0, 4]} width={50} height={20} />);
    const el = svg(container);
    expect(el?.getAttribute('width')).toBe('50');
    expect(el?.getAttribute('height')).toBe('20');
    expect(polyline(container)?.getAttribute('points')).toBe('2,18 48,2');
  });
});

describe('MiniChart — non-finite sanitisation (regression guard)', () => {
  it('coerces a NaN datum to a finite baseline instead of blanking the line', () => {
    const { container } = render(<MiniChart data={[10, NaN]} />);
    const points = polyline(container)?.getAttribute('points') ?? '';
    // NaN → 0, so min=0/max=10: [10→top, 0→bottom].
    expect(points).toBe('2,2 98,30');
    expect(points).not.toContain('NaN');
  });

  it('coerces ±Infinity to zero so min/max stay finite', () => {
    const { container } = render(<MiniChart data={[Infinity, 0, 10]} />);
    const points = polyline(container)?.getAttribute('points') ?? '';
    expect(points).toBe('2,30 50,30 98,2');
    expect(points).not.toContain('Infinity');
  });

  it('treats null/undefined values (possible at runtime) as zero', () => {
    const dirty = [null, 5, 8] as unknown as number[];
    const { container } = render(<MiniChart data={dirty} />);
    const points = polyline(container)?.getAttribute('points') ?? '';
    expect(points).toBe('2,30 50,12.5 98,2');
    expect(points).not.toContain('NaN');
  });

  it('does not throw when data is undefined at runtime', () => {
    const undef = undefined as unknown as number[];
    expect(() => render(<MiniChart data={undef} />)).not.toThrow();
  });
});

describe('MiniChart — styling', () => {
  it('applies the default blue stroke when no color is given', () => {
    const { container } = render(<MiniChart data={[1, 2]} />);
    expect(polyline(container)?.getAttribute('stroke')).toBe('#3b82f6');
  });

  it('applies a custom stroke color', () => {
    const { container } = render(<MiniChart data={[1, 2]} color="#10b981" />);
    expect(polyline(container)?.getAttribute('stroke')).toBe('#10b981');
  });

  it('renders a rounded, unfilled 1.5px stroke', () => {
    const { container } = render(<MiniChart data={[1, 2]} />);
    const line = polyline(container);
    expect(line?.getAttribute('fill')).toBe('none');
    expect(line?.getAttribute('stroke-width')).toBe('1.5');
    expect(line?.getAttribute('stroke-linecap')).toBe('round');
    expect(line?.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('merges a custom className with the base inline-block wrapper', () => {
    const { container } = render(<MiniChart data={[1, 2]} className="mt-2" />);
    expect(container.firstChild).toHaveClass('inline-block', 'mt-2');
  });
});

describe('MiniChart — accessibility', () => {
  it('is decorative (aria-hidden, no img role) when no label is supplied', () => {
    const { container } = render(<MiniChart data={[1, 2, 3]} />);
    expect(svg(container)?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('exposes an accessible image with the supplied label', () => {
    render(<MiniChart data={[1, 2, 3]} label="Distance trend" />);
    const img = screen.getByRole('img', { name: 'Distance trend' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('MiniChart — ref forwarding', () => {
  it('forwards the ref to the wrapping div element', () => {
    const ref = createRef<HTMLDivElement>();
    render(<MiniChart ref={ref} data={[1, 2, 3]} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.querySelector('svg')).not.toBeNull();
  });

  it('leaves the ref null when the guard short-circuits the render', () => {
    const ref = createRef<HTMLDivElement>();
    render(<MiniChart ref={ref} data={[1]} />);
    expect(ref.current).toBeNull();
  });
});
