import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';

// The FilterBar renders exactly one wrapping <div>; grab it for class assertions.
function root(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

describe('FilterBar', () => {
  it('renders its children', () => {
    render(
      <FilterBar>
        <button type="button">Reset</button>
      </FilterBar>,
    );
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('renders multiple children and preserves their order', () => {
    const { container } = render(
      <FilterBar>
        <span>one</span>
        <span>two</span>
        <span>three</span>
      </FilterBar>,
    );
    expect(root(container).textContent).toBe('onetwothree');
    expect(container.querySelectorAll('span')).toHaveLength(3);
  });

  it('applies the default flex-wrap layout classes on a <div>', () => {
    const { container } = render(
      <FilterBar>
        <span>x</span>
      </FilterBar>,
    );
    const el = root(container);
    expect(el.tagName).toBe('DIV');
    for (const cls of ['flex', 'flex-wrap', 'items-center', 'gap-2']) {
      expect(el).toHaveClass(cls);
    }
  });

  it('merges a caller className alongside the defaults', () => {
    const { container } = render(
      <FilterBar className="mb-3">
        <span>x</span>
      </FilterBar>,
    );
    const el = root(container);
    expect(el).toHaveClass('mb-3');
    expect(el).toHaveClass('flex');
    expect(el).toHaveClass('items-center');
  });

  it('lets the caller className win Tailwind conflicts (gap override)', () => {
    const { container } = render(
      <FilterBar className="gap-6">
        <span>x</span>
      </FilterBar>,
    );
    // tailwind-merge de-dupes conflicting gap utilities — gap-6 replaces gap-2.
    expect(root(container).className).toContain('gap-6');
    expect(root(container).className).not.toContain('gap-2');
  });

  it('is presentational (no group role) when no ariaLabel is given', () => {
    render(
      <FilterBar>
        <span>x</span>
      </FilterBar>,
    );
    // A group without an accessible name adds noise; the bar must stay a plain div.
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('exposes a labelled group to assistive tech when ariaLabel is set', () => {
    render(
      <FilterBar ariaLabel="Drive filters">
        <span>x</span>
      </FilterBar>,
    );
    const group = screen.getByRole('group', { name: 'Drive filters' });
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute('aria-label', 'Drive filters');
  });

  it('does not swallow interactions from interactive children', () => {
    const onClick = vi.fn();
    render(
      <FilterBar ariaLabel="Filters">
        <button type="button" onClick={onClick}>
          Apply
        </button>
      </FilterBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an empty container without crashing when children are absent', () => {
    const { container } = render(<FilterBar>{null}</FilterBar>);
    const el = root(container);
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('flex');
    expect(el.childNodes).toHaveLength(0);
  });
});
