/**
 * `<Tabs>` primitive contract tests.
 *
 * Tabs implements the WAI-ARIA Tabs pattern with a roving tabindex, so these
 * tests lock in the semantics feature pages depend on:
 *   1. Structure — a `role="tablist"` wrapping one `role="tab"` <button> per
 *      item, each with a stable generated id and an `aria-controls` link.
 *   2. Selection — only the active tab is `aria-selected` and only one tab is a
 *      tab stop (`tabindex=0`); the rest are `tabindex=-1`.
 *   3. Interaction — clicking fires `onChange`; Arrow/Home/End move activation
 *      (with automatic activation firing `onChange` immediately), skipping
 *      disabled tabs and wrapping at the ends; navigation keys `preventDefault`.
 *   4. Disabled — disabled tabs are `disabled`, styled, out of the tab order,
 *      and never fire `onChange`.
 *   5. Hardening / roving fallback — when `activeTab` matches no *enabled* tab
 *      (unknown key, or the selected tab is disabled) the first enabled tab
 *      still becomes the single tab stop so the strip never drops out of the
 *      keyboard tab order.
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` — matching the sibling primitives (Button, Slider,
 * EditableText). `requestAnimationFrame` (used to defer focus) is stubbed to run
 * synchronously so focus assertions are deterministic and no callback dangles
 * past cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Tabs, type TabItem, type TabsProps } from './Tabs';

const TABS: TabItem[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'charging', label: 'Charging' },
  { key: 'history', label: 'History' },
];

function setup(props: Partial<TabsProps> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <Tabs
      tabs={props.tabs ?? TABS}
      activeTab={props.activeTab ?? 'overview'}
      onChange={onChange}
      className={props.className}
      ariaLabel={props.ariaLabel}
    />,
  );
  return { onChange, ...utils };
}

const tab = (name: string) => screen.getByRole('tab', { name });

beforeEach(() => {
  // Run the deferred focus callback synchronously and deterministically.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Tabs', () => {
  describe('structure', () => {
    it('renders a tablist with one native <button> tab per item', () => {
      setup();
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      for (const el of tabs) {
        expect(el.tagName).toBe('BUTTON');
        expect(el).toHaveAttribute('type', 'button');
      }
    });

    it('exposes each tab label as its accessible name', () => {
      setup();
      expect(tab('Overview')).toBeInTheDocument();
      expect(tab('Charging')).toBeInTheDocument();
      expect(tab('History')).toBeInTheDocument();
    });

    it('gives each tab a stable id and links it to its panel via aria-controls', () => {
      setup();
      const overview = tab('Overview');
      const id = overview.getAttribute('id') ?? '';
      const controls = overview.getAttribute('aria-controls') ?? '';
      expect(id).toMatch(/-tab-overview$/);
      expect(controls).toMatch(/-panel-overview$/);
      // Tab id and the panel it controls share the same generated prefix.
      expect(id.replace(/-tab-overview$/, '')).toBe(controls.replace(/-panel-overview$/, ''));
    });
  });

  describe('selection + roving tabindex', () => {
    it('marks only the active tab aria-selected', () => {
      setup({ activeTab: 'charging' });
      expect(tab('Overview')).toHaveAttribute('aria-selected', 'false');
      expect(tab('Charging')).toHaveAttribute('aria-selected', 'true');
      expect(tab('History')).toHaveAttribute('aria-selected', 'false');
    });

    it('puts only the active tab in the document tab order', () => {
      setup({ activeTab: 'charging' });
      expect(tab('Overview')).toHaveAttribute('tabindex', '-1');
      expect(tab('Charging')).toHaveAttribute('tabindex', '0');
      expect(tab('History')).toHaveAttribute('tabindex', '-1');
    });

    it('applies active styling to the selected tab and muted styling to the rest', () => {
      setup({ activeTab: 'overview' });
      const overview = tab('Overview');
      const charging = tab('Charging');
      expect(overview.className).toContain('border-[var(--theme-primary)]');
      expect(overview.className).toContain('text-[var(--text-primary)]');
      expect(charging.className).toContain('text-[var(--text-muted)]');
      expect(charging.className).not.toContain('border-[var(--theme-primary)]');
    });
  });

  describe('mouse interaction', () => {
    it('calls onChange with the tab key when a tab is clicked', () => {
      const { onChange } = setup();
      fireEvent.click(tab('History'));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('history');
    });

    it('does not call onChange when a disabled tab is clicked', () => {
      const tabs: TabItem[] = [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta', disabled: true },
      ];
      const { onChange } = setup({ tabs, activeTab: 'a' });
      fireEvent.click(tab('Beta'));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('ArrowRight activates the next tab and wraps past the end', () => {
      const { onChange } = setup({ activeTab: 'history' });
      fireEvent.keyDown(tab('History'), { key: 'ArrowRight' });
      expect(onChange).toHaveBeenCalledWith('overview');
    });

    it('ArrowLeft activates the previous tab and wraps past the start', () => {
      const { onChange } = setup({ activeTab: 'overview' });
      fireEvent.keyDown(tab('Overview'), { key: 'ArrowLeft' });
      expect(onChange).toHaveBeenCalledWith('history');
    });

    it('Home jumps to the first tab and End jumps to the last', () => {
      const { onChange } = setup({ activeTab: 'charging' });
      fireEvent.keyDown(tab('Charging'), { key: 'Home' });
      expect(onChange).toHaveBeenLastCalledWith('overview');
      fireEvent.keyDown(tab('Charging'), { key: 'End' });
      expect(onChange).toHaveBeenLastCalledWith('history');
    });

    it('skips disabled tabs during arrow navigation', () => {
      const tabs: TabItem[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'charging', label: 'Charging', disabled: true },
        { key: 'history', label: 'History' },
      ];
      const { onChange } = setup({ tabs, activeTab: 'overview' });
      fireEvent.keyDown(tab('Overview'), { key: 'ArrowRight' });
      // Charging is disabled, so ArrowRight lands on History.
      expect(onChange).toHaveBeenCalledWith('history');
      expect(onChange).not.toHaveBeenCalledWith('charging');
    });

    it('prevents default on navigation keys', () => {
      setup({ activeTab: 'overview' });
      const overview = tab('Overview');
      expect(fireEvent.keyDown(overview, { key: 'ArrowRight' })).toBe(false);
      expect(fireEvent.keyDown(overview, { key: 'ArrowLeft' })).toBe(false);
      expect(fireEvent.keyDown(overview, { key: 'Home' })).toBe(false);
      expect(fireEvent.keyDown(overview, { key: 'End' })).toBe(false);
    });

    it('ignores non-navigation keys without firing onChange', () => {
      const { onChange } = setup({ activeTab: 'overview' });
      const overview = tab('Overview');
      expect(fireEvent.keyDown(overview, { key: 'a' })).toBe(true);
      expect(fireEvent.keyDown(overview, { key: 'Tab' })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('moves DOM focus to the newly activated tab', () => {
      const { onChange } = setup({ activeTab: 'overview' });
      fireEvent.keyDown(tab('Overview'), { key: 'ArrowRight' });
      expect(onChange).toHaveBeenCalledWith('charging');
      expect(tab('Charging')).toHaveFocus();
    });
  });

  describe('disabled tabs', () => {
    it('renders disabled tabs as disabled, styled, and out of the tab order', () => {
      const tabs: TabItem[] = [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta', disabled: true },
        { key: 'c', label: 'Gamma' },
      ];
      setup({ tabs, activeTab: 'a' });
      const beta = tab('Beta');
      expect(beta).toBeDisabled();
      expect(beta.className).toContain('cursor-not-allowed');
      expect(beta.className).toContain('opacity-50');
      expect(beta).toHaveAttribute('tabindex', '-1');
    });

    it('is inert when every tab is disabled', () => {
      const tabs: TabItem[] = [
        { key: 'a', label: 'Alpha', disabled: true },
        { key: 'b', label: 'Beta', disabled: true },
      ];
      const { onChange } = setup({ tabs, activeTab: 'a' });
      // No enabled tab → nothing is a tab stop.
      const all = screen.getAllByRole('tab');
      expect(all.every((t) => t.getAttribute('tabindex') === '-1')).toBe(true);
      // The keydown handler bails out early with no enabled targets, so it
      // neither fires onChange nor cancels the event.
      expect(fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('roving fallback + edge cases', () => {
    it('keeps the strip keyboard-reachable when activeTab matches no tab', () => {
      setup({ activeTab: 'does-not-exist' });
      // Nothing is visually selected...
      expect(tab('Overview')).toHaveAttribute('aria-selected', 'false');
      // ...but the first enabled tab is still the single tab stop.
      expect(tab('Overview')).toHaveAttribute('tabindex', '0');
      expect(tab('Charging')).toHaveAttribute('tabindex', '-1');
      expect(tab('History')).toHaveAttribute('tabindex', '-1');
    });

    it('makes the first enabled tab the tab stop when the active tab is disabled', () => {
      const tabs: TabItem[] = [
        { key: 'a', label: 'Alpha', disabled: true },
        { key: 'b', label: 'Beta' },
        { key: 'c', label: 'Gamma' },
      ];
      setup({ tabs, activeTab: 'a' });
      // Alpha is visually selected but disabled and out of the tab order.
      expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Alpha')).toHaveAttribute('tabindex', '-1');
      // Beta (first enabled) becomes the reachable tab stop.
      expect(tab('Beta')).toHaveAttribute('tabindex', '0');
    });

    it('renders an empty tablist without crashing when given no tabs', () => {
      setup({ tabs: [] });
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
    });

    it('merges a custom className onto the tablist and applies the aria-label', () => {
      setup({ className: 'custom-tabs mt-4', ariaLabel: 'Vehicle sections' });
      const tablist = screen.getByRole('tablist', { name: 'Vehicle sections' });
      expect(tablist).toBeInTheDocument();
      expect(tablist.className).toContain('custom-tabs');
      expect(tablist.className).toContain('mt-4');
      // Base structural classes survive the cn() merge.
      expect(tablist.className).toContain('border-b');
    });
  });
});
