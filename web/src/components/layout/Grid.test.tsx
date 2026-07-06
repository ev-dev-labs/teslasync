/**
 * Grid layout behaviour tests.
 *
 * Grid is a presentational wrapper around a CSS grid that maps a responsive
 * `cols` map + numeric `gap` onto static Tailwind utilities. The suite locks
 * in the hardening that landed alongside it:
 *   - every breakpoint (default/sm/md/lg/xl) is applied — `xl` used to be
 *     silently dropped
 *   - out-of-range / dynamic counts never leak a malformed `undefined` class
 *     and clamp to the max supported column count
 *   - the gap map resolves to a real utility (with a sane default fallback)
 *   - a caller-supplied className merges and wins via tailwind-merge
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ComponentProps } from 'react';
import { Grid } from './Grid';

/** Render a Grid and hand back the root grid element for class assertions. */
function getGrid(props: Partial<ComponentProps<typeof Grid>> = {}): HTMLElement {
  const { container } = render(
    <Grid {...props}>
      <span data-testid="cell">cell</span>
    </Grid>,
  );
  return container.firstElementChild as HTMLElement;
}

describe('Grid', () => {
  it('renders its children inside the grid container', () => {
    const el = getGrid();
    const cell = screen.getByTestId('cell');
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveTextContent('cell');
    expect(el).toContainElement(cell);
  });

  it('always applies the base grid class and defaults to a single column', () => {
    const el = getGrid();
    expect(el).toHaveClass('grid');
    expect(el).toHaveClass('grid-cols-1');
    // Default gap is 4.
    expect(el).toHaveClass('gap-4');
  });

  it('applies responsive column utilities for every breakpoint, including xl', () => {
    // Regression: `xl` was declared in the props type but never rendered.
    const el = getGrid({ cols: { default: 2, sm: 3, md: 4, lg: 5, xl: 6 } });
    expect(el).toHaveClass('grid-cols-2');
    expect(el).toHaveClass('sm:grid-cols-3');
    expect(el).toHaveClass('md:grid-cols-4');
    expect(el).toHaveClass('lg:grid-cols-5');
    expect(el).toHaveClass('xl:grid-cols-6');
  });

  it('applies the requested gap and supports a zero gap', () => {
    expect(getGrid({ gap: 6 })).toHaveClass('gap-6');
    const zero = getGrid({ gap: 0 });
    expect(zero).toHaveClass('gap-0');
    expect(zero).not.toHaveClass('gap-4');
  });

  it('falls back to the default gap for an unmapped gap value', () => {
    const el = getGrid({ gap: 999 });
    expect(el).toHaveClass('gap-4');
    expect(el.className).not.toContain('gap-999');
  });

  it('never emits a malformed "undefined" class for an out-of-range count', () => {
    // Regression: a count outside 1–6 used to produce `sm:undefined`.
    const el = getGrid({ cols: { default: 2, sm: 99 } });
    expect(el.className).not.toContain('undefined');
    // Clamps down to the largest supported column count.
    expect(el).toHaveClass('sm:grid-cols-6');
    expect(el).toHaveClass('grid-cols-2');
  });

  it('clamps dynamic counts above the max down to six columns', () => {
    // Mirrors real callers like `cols={{ md: alerts.length }}`.
    const el = getGrid({ cols: { default: 1, md: 8 } });
    expect(el).toHaveClass('md:grid-cols-6');
    expect(el.className).not.toContain('md:grid-cols-8');
  });

  it('ignores non-positive and non-finite column counts', () => {
    const el = getGrid({ cols: { default: 3, sm: 0, md: Number.NaN } });
    expect(el).toHaveClass('grid-cols-3');
    expect(el.className).not.toMatch(/sm:grid-cols/);
    expect(el.className).not.toMatch(/md:grid-cols/);
    expect(el.className).not.toContain('undefined');
  });

  it('rounds fractional counts to the nearest supported column class', () => {
    const el = getGrid({ cols: { default: 3.5 } });
    expect(el).toHaveClass('grid-cols-4');
  });

  it('merges a caller-supplied className with the computed classes', () => {
    const el = getGrid({ className: 'mt-8 border' });
    expect(el).toHaveClass('grid');
    expect(el).toHaveClass('grid-cols-1');
    expect(el).toHaveClass('mt-8');
    expect(el).toHaveClass('border');
  });

  it('lets an explicit className override the computed gap (tailwind-merge wins)', () => {
    const el = getGrid({ gap: 4, className: 'gap-8' });
    expect(el).toHaveClass('gap-8');
    expect(el).not.toHaveClass('gap-4');
  });

  it('renders every child in order', () => {
    const { container } = render(
      <Grid cols={{ default: 2 }}>
        <div>A</div>
        <div>B</div>
        <div>C</div>
      </Grid>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.children).toHaveLength(3);
    expect(el.children[0]).toHaveTextContent('A');
    expect(el.children[2]).toHaveTextContent('C');
  });
});
