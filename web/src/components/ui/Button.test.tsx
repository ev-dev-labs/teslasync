/**
 * Button primitive contract tests.
 *
 * Button is one of the most widely-consumed shared primitives, so these tests
 * lock in the user-facing semantics feature pages rely on:
 *   1. It always renders a native <button> and forwards children/refs/attrs.
 *   2. Every `variant` and `size` maps to its distinctive utility class, and
 *      `className` is merged through cn() (tailwind-merge resolves conflicts).
 *   3. `loading` swaps the icon for a spinner, disables the control, and marks
 *      it aria-busy — while the spinner stays out of the accessibility tree.
 *   4. `disabled` (and `loading`) block click handlers.
 *   5. Icon-only buttons expose an accessible name via aria-label.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Button, type ButtonProps } from './Button';

type Variant = NonNullable<ButtonProps['variant']>;
type Size = NonNullable<ButtonProps['size']>;

describe('Button', () => {
  it('renders a native <button> with its children as the accessible name', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveTextContent('Save');
  });

  it('always applies the base structural classes', () => {
    render(<Button>x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('inline-flex');
    expect(cls).toContain('rounded-shape-sm');
    expect(cls).toContain('font-medium');
    expect(cls).toContain('transition');
    // Focus ring is unified on the accent token so it stays visible on all
    // 140 theme presets rather than depending on the variant.
    expect(cls).toContain('focus-visible:ring-[var(--focus-ring)]');
    expect(cls).toContain('disabled:bg-[var(--surface-2)]');
    expect(cls).toContain('disabled:text-[var(--text-secondary)]');
    expect(cls).toContain('disabled:opacity-100');
    expect(cls).not.toContain('disabled:opacity-50');
  });

  it('defaults to the primary variant and the md size', () => {
    render(<Button>x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('bg-[var(--theme-primary)]');
    expect(cls).toContain('text-[var(--theme-on-primary)]');
    expect(cls).toContain('h-10');
    expect(cls).toContain('px-4');
    expect(cls).toContain('text-sm');
  });

  it('applies the distinctive class for every variant', () => {
    // Neutral variants resolve from the `--control-*` tokens, not Tailwind's
    // fixed `gray-*` ramp, so they track whichever of the 140 presets is live.
    const expected: Record<Variant, string> = {
      primary: 'bg-[var(--theme-primary)]',
      secondary: 'bg-[var(--control-bg)]',
      outline: 'border-[var(--control-border)]',
      danger: 'bg-red-600',
      ghost: 'hover:bg-[var(--control-bg)]',
    };
    const { rerender } = render(<Button variant="primary">x</Button>);
    for (const [variant, cls] of Object.entries(expected) as [Variant, string][]) {
      rerender(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button').className).toContain(cls);
    }
  });

  it('uses the fixed on-accent foreground for the solid danger surface', () => {
    render(<Button variant="danger">Delete</Button>);
    const cls = screen.getByRole('button', { name: 'Delete' }).className;
    expect(cls).toContain('text-[var(--text-on-accent)]');
    expect(cls).not.toContain('text-[var(--text-primary)]');
  });

  it('applies the distinctive class for every size', () => {
    const expected: Record<Size, string> = {
      sm: 'h-9',
      md: 'h-10',
      lg: 'h-12',
      auto: 'min-h-d-row',
    };
    const { rerender } = render(<Button size="sm">x</Button>);
    for (const [size, cls] of Object.entries(expected) as [Size, string][]) {
      rerender(<Button size={size}>x</Button>);
      expect(screen.getByRole('button').className).toContain(cls);
    }
  });

  it('merges a custom className and lets it win conflicts via cn()', () => {
    render(
      <Button size="md" className="px-8 custom-xyz">
        x
      </Button>,
    );
    const cls = screen.getByRole('button').className;
    // tailwind-merge keeps the caller's padding and drops the size default.
    expect(cls).toContain('px-8');
    expect(cls).not.toContain('px-4');
    // Non-conflicting custom classes are preserved.
    expect(cls).toContain('custom-xyz');
  });

  it('renders the provided icon and no spinner when not loading', () => {
    const { container } = render(
      <Button icon={<span data-testid="btn-icon">*</span>}>Go</Button>,
    );
    expect(screen.getByTestId('btn-icon')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBeNull();
  });

  it('swaps the icon for a decorative spinner while loading', () => {
    const { container } = render(
      <Button loading icon={<span data-testid="btn-icon">*</span>}>
        Go
      </Button>,
    );
    // Icon is replaced by the spinner.
    expect(screen.queryByTestId('btn-icon')).toBeNull();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Spinner is decorative — hidden from the accessibility tree.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    // Children still render alongside the spinner.
    expect(screen.getByRole('button')).toHaveTextContent('Go');
  });

  it('disables the control and sets aria-busy while loading', () => {
    render(<Button loading>Go</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('is neither disabled nor busy in the default state', () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire onClick while loading (even without an explicit disabled)', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards the ref to the underlying <button> element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Go</Button>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('passes through arbitrary button attributes (type, name, data-*)', () => {
    render(
      <Button type="submit" name="save" data-testid="save-btn">
        Go
      </Button>,
    );
    const btn = screen.getByTestId('save-btn') as HTMLButtonElement;
    expect(btn.getAttribute('type')).toBe('submit');
    expect(btn.name).toBe('save');
  });

  it('exposes an accessible name via aria-label for icon-only buttons', () => {
    render(<Button aria-label="Delete" icon={<span data-testid="btn-icon">x</span>} />);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId('btn-icon')).toBeInTheDocument();
  });
});
