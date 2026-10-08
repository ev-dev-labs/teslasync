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
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { BUTTON_BASE, BUTTON_VARIANTS, Button, type ButtonProps } from './Button';

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useMotionPreference).mockReturnValue({ reduce: false, durationMs: 250 });
});

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
    expect(cls).toContain('focus-visible:outline-[var(--focus-ring)]');
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
      danger: 'bg-[var(--semantic-danger-bg)]',
      ghost: 'hover:bg-[var(--control-bg)]',
    };
    const { rerender } = render(<Button variant="primary">x</Button>);
    for (const [variant, cls] of Object.entries(expected) as [Variant, string][]) {
      rerender(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button').className).toContain(cls);
    }
  });

  it('uses the semantic danger foreground for the restrained destructive surface', () => {
    render(<Button variant="danger">Delete</Button>);
    const cls = screen.getByRole('button', { name: 'Delete' }).className;
    expect(cls).toContain('text-[var(--semantic-danger)]');
    expect(cls).not.toContain('text-[var(--text-primary)]');
    expect(cls).toContain('border-[var(--semantic-danger)]');
    expect(cls).toContain('hover:bg-[var(--control-bg-hover)]');
    expect(cls).toContain('active:bg-[var(--control-bg)]');
    expect(cls).not.toMatch(/(?:bg|ring)-red-/);
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

  it('opts into intrinsic multiline height without forwarding presentation props to the DOM', () => {
    const { rerender } = render(<Button wrapLabel size="sm">Complete caller-supplied action label</Button>);
    for (const size of ['sm', 'md', 'lg', 'auto'] as const) {
      rerender(<Button wrapLabel size={size}>Complete caller-supplied action label</Button>);
      const button = screen.getByRole('button', { name: 'Complete caller-supplied action label' });
      expect(button).toHaveClass('h-auto', 'max-w-full', 'whitespace-normal');
      expect(button.querySelector('span')).toHaveClass('min-w-0', 'break-words');
      expect(button).not.toHaveAttribute('wrapLabel');
    }
  });

  it('preserves fixed icon sizing unless label wrapping is explicitly requested', () => {
    render(<Button size="sm" className="h-3 w-1" aria-label="Prepared marker" />);
    expect(screen.getByRole('button', { name: 'Prepared marker' })).toHaveClass('h-3', 'w-1');
    expect(screen.getByRole('button')).not.toHaveClass('min-h-9', 'h-auto');
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

  it('retains the exported variant family and crisp focus treatment for link consumers', () => {
    expect(Object.keys(BUTTON_VARIANTS)).toEqual(['primary', 'secondary', 'outline', 'danger', 'ghost']);
    expect(BUTTON_BASE).toContain('focus-visible:outline-2');
    expect(BUTTON_BASE).toContain('focus-visible:outline-offset-2');
    expect(BUTTON_BASE).toContain('forced-colors:focus-visible:outline-[Highlight]');
    expect(BUTTON_BASE).toContain('motion-reduce:transition-none');
    expect(BUTTON_BASE).not.toContain('focus-visible:ring-');
  });

  it('retains busy feedback without spinning or transitions when motion is reduced', () => {
    vi.mocked(useMotionPreference).mockReturnValue({ reduce: true, durationMs: 0 });
    const { container, rerender } = render(<Button loading wrapLabel>Saving the complete translated action label</Button>);
    const button = screen.getByRole('button', { name: 'Saving the complete translated action label' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('transition-none', 'h-auto');
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    vi.mocked(useMotionPreference).mockReturnValue({ reduce: false, durationMs: 250 });
    rerender(<Button loading wrapLabel>Saving the complete translated action label</Button>);
    expect(container.querySelector('svg')).toHaveClass('animate-spin', 'motion-reduce:animate-none');
    expect(button).not.toHaveClass('transition-none');
  });

  it('preserves wrapped icon separation, numeric zero and absent children', () => {
    const { rerender } = render(<Button wrapLabel icon={<span data-testid="wrapped-icon">*</span>}>{0}</Button>);
    expect(screen.getByRole('button')).toHaveTextContent('0');
    expect(screen.getByTestId('wrapped-icon').parentElement).toHaveClass('shrink-0');
    rerender(<Button wrapLabel aria-label="Empty caller content">{null}</Button>);
    expect(screen.getByRole('button', { name: 'Empty caller content' })).toHaveClass('h-auto');
    expect(screen.queryByTestId('wrapped-icon')).toBeNull();
  });

  it('preserves native form identity, submission overrides and keyboard handlers', () => {
    const onKeyDown = vi.fn();
    render(<Button type="submit" form="settings" name="action" value="save" formNoValidate formAction="/save" onKeyDown={onKeyDown}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('form', 'settings');
    expect(button).toHaveAttribute('name', 'action');
    expect(button).toHaveAttribute('value', 'save');
    expect(button).toHaveAttribute('formnovalidate');
    expect(button).toHaveAttribute('formaction', '/save');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
