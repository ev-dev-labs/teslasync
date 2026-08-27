import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n';
import { patchMatchMedia } from '@/test/setup';
import { FilterSheet } from '../FilterSheet';

/**
 * FilterSheet — collapses filter controls into a mobile bottom sheet below
 * the `md` (768px) breakpoint, and renders them inline unchanged at `md`+.
 *
 * Covers:
 *   - desktop (`md`+): children render inline, no trigger/sheet chrome
 *   - mobile (< `md`): a single 44×44 "Filters" trigger opens the same
 *     children inside `<Modal>`; the active-count badge renders/updates;
 *     "Done" closes the sheet
 *   - children are mounted exactly once per breakpoint (no duplicate ids)
 */

afterEach(() => {
  cleanup();
});

describe('FilterSheet — desktop (md+)', () => {
  it('renders children inline with no trigger button', () => {
    patchMatchMedia((q) => q === '(min-width: 768px)');
    render(
      <FilterSheet activeCount={2}>
        <div data-testid="filter-controls">controls</div>
      </FilterSheet>,
    );
    expect(screen.getByTestId('filter-controls')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
  });
});

describe('FilterSheet — mobile (< md)', () => {
  it('renders a single 44x44-safe trigger instead of inline controls', () => {
    patchMatchMedia(() => false);
    render(
      <FilterSheet>
        <div data-testid="filter-controls">controls</div>
      </FilterSheet>,
    );
    expect(screen.queryByTestId('filter-controls')).toBeNull();
    const trigger = screen.getByRole('button', { name: /filters/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).toMatch(/min-h-\[44px\]/);
    expect(trigger.className).toMatch(/min-w-\[44px\]/);
  });

  it('shows the active-filter count badge and its screen-reader text', () => {
    patchMatchMedia(() => false);
    render(
      <FilterSheet activeCount={3}>
        <div>controls</div>
      </FilterSheet>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('3 active')).toBeInTheDocument();
  });

  it('hides the badge entirely when there are no active filters', () => {
    patchMatchMedia(() => false);
    render(
      <FilterSheet activeCount={0}>
        <div>controls</div>
      </FilterSheet>,
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('opens the sheet with the filter controls and a Done action on trigger click', () => {
    patchMatchMedia(() => false);
    render(
      <FilterSheet title="Drive filters" doneLabel="Apply">
        <div data-testid="filter-controls">controls</div>
      </FilterSheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Drive filters')).toBeInTheDocument();
    expect(screen.getByTestId('filter-controls')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('closes the sheet when Done is clicked, unmounting the controls', () => {
    patchMatchMedia(() => false);
    render(
      <FilterSheet>
        <div data-testid="filter-controls">controls</div>
      </FilterSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the sheet via the Modal close button as well', () => {
    patchMatchMedia(() => false);
    render(
      <FilterSheet>
        <div>controls</div>
      </FilterSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
