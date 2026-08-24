/**
 * `<TabNav>` segmented-control contract tests.
 *
 * TabNav is the horizontal view/filter switcher rendered in five pages
 * (analytics domain switcher, dev-tools sections, alerts filter strip,
 * signals chart-layout, command-history status). Its `tabs`/`active` are
 * always data-driven, so these tests lock in:
 *   1. One native <button> per tab, carrying the label (and optional icon).
 *   2. The active tab is exposed programmatically via `aria-pressed`
 *      (colour alone is not a status a screen reader can announce), and
 *      exactly one tab is pressed for a matching `active`.
 *   3. Every button is `type="button"` — the regression guard that stops an
 *      in-form TabNav from submitting its surrounding <form> on tab change.
 *   4. `onChange` fires with the clicked tab's key, including when the
 *      already-active tab is re-clicked (no self-suppression) and never fires
 *      on render.
 *   5. Null-safety: an undefined/empty `tabs` degrades to an empty group
 *      instead of throwing on `.map`.
 *   6. The container is a labelled `role="group"`, the active/inactive style
 *      branches emit their tokens, a visible focus ring is present, and a
 *      caller `className` merges via cn() without leaking `undefined`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TabNav, type TabNavItem } from './TabNav';

afterEach(() => cleanup());

const TABS: TabNavItem[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'driving', label: 'Driving' },
  { key: 'charging', label: 'Charging' },
];

describe('TabNav — rendering', () => {
  it('renders one native <button> per tab carrying its label', () => {
    render(<TabNav tabs={TABS} active="overview" onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(buttons.map((b) => b.textContent)).toEqual(['Overview', 'Driving', 'Charging']);
  });

  it('renders the optional icon node alongside the label', () => {
    const tabs: TabNavItem[] = [
      { key: 'map', label: 'Map', icon: <svg data-testid="map-icon" /> },
      { key: 'list', label: 'List' },
    ];
    render(<TabNav tabs={tabs} active="map" onChange={() => {}} />);
    const icon = screen.getByTestId('map-icon');
    expect(icon).toBeInTheDocument();
    // The icon lives inside its own tab button, not a sibling one.
    expect(screen.getByRole('button', { name: /map/i })).toContainElement(icon);
  });

  it('renders an empty group (no button) for an empty tab list', () => {
    render(<TabNav tabs={[]} active="x" onChange={() => {}} />);
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('TabNav — active state (aria-pressed)', () => {
  it('marks only the active tab as pressed and the rest as not pressed', () => {
    render(<TabNav tabs={TABS} active="driving" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Driving' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Exactly one pressed tab is discoverable by assistive tech.
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2);
  });

  it('presses no tab when `active` matches none of the keys', () => {
    render(<TabNav tabs={TABS} active="does-not-exist" onChange={() => {}} />);
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(3);
  });

  it('applies the active style tokens to the selected tab and muted tokens to the rest', () => {
    render(<TabNav tabs={TABS} active="overview" onChange={() => {}} />);
    const active = screen.getByRole('button', { name: 'Overview' });
    const inactive = screen.getByRole('button', { name: 'Driving' });
    expect(active.className).toContain('bg-[var(--surface-3)]');
    expect(active.className).toContain('text-[var(--text-primary)]');
    expect(inactive.className).toContain('text-[var(--text-muted)]');
    expect(inactive.className).not.toContain('bg-[var(--surface-3)]');
  });
});

describe('TabNav — type="button" form-submission guard', () => {
  it('renders every tab as type="button"', () => {
    render(<TabNav tabs={TABS} active="overview" onChange={() => {}} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  it('does not submit a surrounding <form> when a tab is clicked', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <TabNav tabs={TABS} active="overview" onChange={() => {}} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Driving' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('TabNav — onChange', () => {
  it('fires onChange with the clicked tab key', () => {
    const onChange = vi.fn();
    render(<TabNav tabs={TABS} active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Charging' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('charging');
  });

  it('still fires onChange when the already-active tab is re-clicked', () => {
    const onChange = vi.fn();
    render(<TabNav tabs={TABS} active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(onChange).toHaveBeenCalledWith('overview');
  });

  it('does not fire onChange on initial render', () => {
    const onChange = vi.fn();
    render(<TabNav tabs={TABS} active="overview" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TabNav — container, a11y label, focus + className', () => {
  it('wraps the tabs in a role="group" container', () => {
    render(<TabNav tabs={TABS} active="overview" onChange={() => {}} />);
    const group = screen.getByRole('group');
    expect(group.tagName).toBe('DIV');
    expect(group.className).toContain('rounded-shape-lg');
  });

  it('labels the group when ariaLabel is provided', () => {
    render(
      <TabNav tabs={TABS} active="overview" onChange={() => {}} ariaLabel="Analytics sections" />,
    );
    expect(screen.getByRole('group', { name: 'Analytics sections' })).toBeInTheDocument();
  });

  it('omits aria-label entirely when ariaLabel is not provided', () => {
    render(<TabNav tabs={TABS} active="overview" onChange={() => {}} />);
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-label');
  });

  it('gives every tab a visible focus ring for keyboard users', () => {
    render(<TabNav tabs={TABS} active="overview" onChange={() => {}} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('focus-visible:ring-2');
      expect(button.className).toContain('focus-visible:ring-[var(--focus-ring)]');
    }
  });

  it('merges a caller className onto the group without leaking undefined', () => {
    render(
      <TabNav tabs={TABS} active="overview" onChange={() => {}} className="mt-4 w-full" />,
    );
    const group = screen.getByRole('group');
    expect(group.className).toContain('mt-4');
    expect(group.className).toContain('w-full');
    expect(group.className).toContain('rounded-shape-lg');
    expect(group.className).not.toContain('undefined');
  });
});
