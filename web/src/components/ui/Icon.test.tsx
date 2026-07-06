import { forwardRef } from 'react';
import type { SVGProps } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { Icon, type IconProps, type IconSize } from './Icon';
import { Icons, type LucideIcon } from '@/lib/icons';

afterEach(cleanup);

/**
 * A faithful stand-in for a lucide icon: a forwardRef <svg> that spreads every
 * prop it receives so we can assert *exactly* what <Icon> forwards down
 * (className, aria-*, role, focusable, event handlers, arbitrary SVG attrs).
 */
const TestIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  (props, ref) => <svg ref={ref} data-testid="test-icon" {...props} />,
) as unknown as LucideIcon;

function renderIcon(props: Partial<IconProps> = {}) {
  return render(<Icon icon={TestIcon} {...props} />);
}

describe('Icon — rendering', () => {
  it('renders the supplied component as an <svg> with the default md box + shrink-0', () => {
    renderIcon();
    const svg = screen.getByTestId('test-icon');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveClass('h-4', 'w-4', 'shrink-0');
  });

  it('forwards arbitrary SVG props (id, stroke, strokeWidth) to the underlying icon', () => {
    renderIcon({ id: 'my-icon', stroke: 'red', strokeWidth: 3 });
    const svg = screen.getByTestId('test-icon');
    expect(svg.getAttribute('id')).toBe('my-icon');
    expect(svg.getAttribute('stroke')).toBe('red');
    expect(svg.getAttribute('stroke-width')).toBe('3');
  });

  it('forwards a click handler and invokes it on user interaction', () => {
    const onClick = vi.fn();
    renderIcon({ onClick });
    fireEvent.click(screen.getByTestId('test-icon'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('merges caller className and lets tailwind-merge override the size box', () => {
    renderIcon({ className: 'h-6 w-6 text-cyan-300' });
    const svg = screen.getByTestId('test-icon');
    const cls = svg.getAttribute('class') ?? '';
    // tailwind-merge keeps the caller's h-6/w-6 and drops the default h-4/w-4.
    expect(cls).toContain('h-6');
    expect(cls).toContain('w-6');
    expect(cls).toContain('shrink-0');
    expect(cls).toContain('text-cyan-300');
    expect(svg).not.toHaveClass('h-4', 'w-4');
  });
});

describe('Icon — size variants', () => {
  const CASES: Array<[IconSize, string, string]> = [
    ['xs', 'h-3', 'w-3'],
    ['sm', 'h-3.5', 'w-3.5'],
    ['md', 'h-4', 'w-4'],
    ['lg', 'h-5', 'w-5'],
    ['xl', 'h-6', 'w-6'],
  ];

  it.each(CASES)('maps size "%s" to %s %s', (size, h, w) => {
    renderIcon({ size });
    expect(screen.getByTestId('test-icon')).toHaveClass(h, w, 'shrink-0');
  });

  it('falls back to the md box when given an out-of-range size', () => {
    // Simulate a runtime/untyped value that escaped the IconSize union.
    const bad: string = 'gigantic';
    renderIcon({ size: bad as IconSize });
    expect(screen.getByTestId('test-icon')).toHaveClass('h-4', 'w-4', 'shrink-0');
  });
});

describe('Icon — accessibility', () => {
  it('is decorative by default: aria-hidden="true", no role, no aria-label', () => {
    renderIcon();
    const svg = screen.getByTestId('test-icon');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
  });

  it('becomes meaningful (role="img" + label, never hidden) when aria-label is set', () => {
    renderIcon({ 'aria-label': 'Battery level' });
    const svg = screen.getByRole('img', { name: 'Battery level' });
    expect(svg).toHaveAttribute('aria-label', 'Battery level');
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('lets aria-label win even when aria-hidden is also passed', () => {
    renderIcon({ 'aria-label': 'Charging', 'aria-hidden': true });
    const svg = screen.getByRole('img', { name: 'Charging' });
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('respects an explicit aria-hidden={false} for decorative-but-exposed icons', () => {
    renderIcon({ 'aria-hidden': false });
    expect(screen.getByTestId('test-icon')).toHaveAttribute('aria-hidden', 'false');
  });

  it('sets focusable="false" by default so icons are never a legacy tab stop', () => {
    renderIcon();
    expect(screen.getByTestId('test-icon')).toHaveAttribute('focusable', 'false');
  });

  it('lets a caller override focusable when the icon is genuinely focusable', () => {
    renderIcon({ focusable: true });
    expect(screen.getByTestId('test-icon')).toHaveAttribute('focusable', 'true');
  });
});

describe('Icon — robustness', () => {
  it('renders nothing (and does not throw) when the icon reference is nullish', () => {
    let container: HTMLElement | undefined;
    expect(() => {
      container = render(<Icon icon={undefined as unknown as LucideIcon} />).container;
    }).not.toThrow();
    expect(container?.firstChild).toBeNull();
  });
});

describe('Icon — integration with @/lib/icons', () => {
  it('renders a real lucide icon and merges our size class with lucide’s own classes', () => {
    const { container } = render(<Icon icon={Icons.battery} size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const cls = svg?.getAttribute('class') ?? '';
    expect(cls).toContain('lucide');
    expect(cls).toContain('h-5');
    expect(cls).toContain('shrink-0');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes a real lucide icon as role="img" when labelled', () => {
    render(<Icon icon={Icons.battery} aria-label="Battery" />);
    expect(screen.getByRole('img', { name: 'Battery' })).toBeInTheDocument();
  });
});
