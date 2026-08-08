/**
 * Card / CardHeader / CardFooter primitive contract tests.
 *
 * These lock in the behaviour that feature pages depend on:
 *   1. <Card> is a forwardRef <div> that spreads arbitrary DOM props,
 *      merges caller classes via cn() (tailwind-merge conflict
 *      resolution), and maps each `padding` scale to the right spacing
 *      utility — including the `auto` density-aware scale and a defensive
 *      fallback for an out-of-union runtime value.
 *   2. The `hover` affordance only adds the pointer/transition classes
 *      when enabled, and click handlers still fire.
 *   3. The forced-colors boundary override is always present so cards
 *      stay perceivable in Windows High Contrast.
 *   4. <CardHeader> renders an <h3> heading, shows the subtitle only when
 *      it is non-empty, and renders an optional action node.
 *   5. <CardFooter> renders its children and merges caller classes with
 *      the base footer classes.
 *
 * `@testing-library/user-event` is not installed in this repo, so user
 * interactions are driven with `fireEvent` (matching Checkbox.test.tsx).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import type { CardProps } from './Card';
import { Card, CardHeader, CardFooter } from './Card';

describe('Card', () => {
  it('renders a <div> wrapper around its children', () => {
    render(<Card>Body copy</Card>);
    const el = screen.getByText('Body copy');
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveTextContent('Body copy');
  });

  it('applies the default md padding (p-4) when padding is unset', () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/\bp-4\b/);
  });

  it.each([
    ['sm', 'p-3'],
    ['md', 'p-4'],
    ['lg', 'p-6'],
  ] as const)('maps padding="%s" to the "%s" utility', (padding, cls) => {
    render(
      <Card data-testid="card" padding={padding}>
        x
      </Card>,
    );
    expect(screen.getByTestId('card').className).toContain(cls);
  });

  it('emits no padding utility for padding="none"', () => {
    render(
      <Card data-testid="card" padding="none">
        x
      </Card>,
    );
    // The empty string for `none` must be preserved (not coerced to the
    // md fallback), so the card carries no p-* spacing class.
    expect(screen.getByTestId('card').className).not.toMatch(/\bp-\d/);
  });

  it('maps padding="auto" to the density-aware utilities', () => {
    render(
      <Card data-testid="card" padding="auto">
        x
      </Card>,
    );
    const className = screen.getByTestId('card').className;
    expect(className).toContain('px-d-pad-x');
    expect(className).toContain('py-d-pad-y');
  });

  it('falls back to md padding for an out-of-union runtime value', () => {
    // Simulate a caller bypassing the type system (e.g. a value coming
    // from untyped JSON). The card must not render edge-to-edge.
    render(
      <Card data-testid="card" padding={'bogus' as CardProps['padding']}>
        x
      </Card>,
    );
    expect(screen.getByTestId('card').className).toContain('p-4');
  });

  it('adds hover affordance classes only when hover is true', () => {
    const { rerender } = render(
      <Card data-testid="card" hover>
        x
      </Card>,
    );
    const withHover = screen.getByTestId('card').className;
    expect(withHover).toContain('cursor-pointer');
    expect(withHover).toContain('hover:shadow-panel-hover');
    expect(withHover).toContain('hover:border-[var(--panel-border-hover)]');

    rerender(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).not.toContain('cursor-pointer');
  });

  it('always carries the forced-colors boundary override', () => {
    render(<Card data-testid="card">x</Card>);
    const className = screen.getByTestId('card').className;
    expect(className).toContain('forced-colors:border-[CanvasText]');
    expect(className).toContain('forced-colors:bg-[Canvas]');
  });

  it('merges a caller className and resolves padding conflicts via cn()', () => {
    // The caller's p-8 must win over the default md (p-4) because
    // tailwind-merge keeps the last conflicting utility.
    render(
      <Card data-testid="card" className="p-8">
        x
      </Card>,
    );
    const className = screen.getByTestId('card').className;
    expect(className).toContain('p-8');
    expect(className).not.toMatch(/\bp-4\b/);
  });

  it('forwards its ref to the underlying <div>', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Card ref={ref}>x</Card>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('DIV');
  });

  it('spreads arbitrary DOM props (role, aria-label, id)', () => {
    render(
      <Card role="group" aria-label="Fleet stats" id="stats-card">
        x
      </Card>,
    );
    const el = screen.getByRole('group', { name: 'Fleet stats' });
    expect(el.id).toBe('stats-card');
  });

  it('fires onClick when an interactive card is clicked', () => {
    const onClick = vi.fn();
    render(
      <Card data-testid="card" hover onClick={onClick}>
        x
      </Card>,
    );
    fireEvent.click(screen.getByTestId('card'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('CardHeader', () => {
  it('renders the title inside a level-3 heading', () => {
    render(<CardHeader title="Battery Health" />);
    const heading = screen.getByRole('heading', { level: 3, name: 'Battery Health' });
    expect(heading.tagName).toBe('H3');
  });

  it('renders the subtitle when it is provided', () => {
    render(<CardHeader title="Battery" subtitle="Last 30 days" />);
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('does not render a subtitle paragraph when the subtitle is omitted', () => {
    const { container } = render(<CardHeader title="Battery" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('does not render a subtitle paragraph for an empty string', () => {
    const { container } = render(<CardHeader title="Battery" subtitle="" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders an optional action node alongside the title', () => {
    render(
      <CardHeader
        title="Battery"
        action={<span data-testid="hdr-action">Refresh</span>}
      />,
    );
    expect(screen.getByTestId('hdr-action')).toHaveTextContent('Refresh');
    // Title and action coexist inside the header.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Battery');
  });
});

describe('CardFooter', () => {
  it('renders its children', () => {
    render(<CardFooter>Footer content</CardFooter>);
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('merges a caller className with the base footer classes', () => {
    const { container } = render(
      <CardFooter className="justify-start">actions</CardFooter>,
    );
    const footer = container.firstChild as HTMLElement;
    expect(footer.className).toContain('justify-start');
    expect(footer.className).toContain('border-t');
    expect(footer.className).toContain('mt-4');
  });
});
