import { type ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollapsibleCommandGroup } from './CollapsibleCommandGroup';
import type { CommandCategory } from '../commands';

// Deterministic i18n: return the provided fallback string so text assertions
// don't depend on the runtime translation catalogue (mirrors the repo's
// StateTimeline / status-card test convention).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

type GroupProps = ComponentProps<typeof CollapsibleCommandGroup>;

function renderGroup(overrides: Partial<GroupProps> = {}) {
  const props: GroupProps = {
    category: 'security',
    vehicleKey: 1,
    count: 3,
    children: <span data-testid="cmd-child">CHILD TILE</span>,
    ...overrides,
  };
  return render(<CollapsibleCommandGroup {...props} />);
}

describe('CollapsibleCommandGroup', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders collapsed by default: label + count shown, panel hidden, aria-expanded=false, no aria-controls', () => {
    renderGroup({ count: 3 });
    const button = screen.getByRole('button', { name: /security & access/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(button.textContent).toContain('(3)');
    // Panel (children) is not mounted while collapsed.
    expect(screen.queryByTestId('cmd-child')).toBeNull();
  });

  it('expands on click: children mount, aria-expanded flips true, aria-controls points at the panel, state persisted', () => {
    renderGroup({ vehicleKey: 1, category: 'security' });
    const button = screen.getByRole('button');

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panelId = 'teslasync-cmdgroup-1-security';
    expect(button).toHaveAttribute('aria-controls', panelId);

    const child = screen.getByTestId('cmd-child');
    expect(child).toBeInTheDocument();
    // aria-controls references a real element that actually contains the tiles.
    const panel = document.getElementById(panelId);
    expect(panel).not.toBeNull();
    expect(panel).toContainElement(child);

    // Open state is persisted under the vehicle+category session key.
    expect(sessionStorage.getItem('teslasync-cat-1-security')).toBe('true');
  });

  it('honours defaultOpen and collapses (persisting "false") on click', () => {
    renderGroup({ vehicleKey: 5, category: 'charging', defaultOpen: true });
    expect(screen.getByTestId('cmd-child')).toBeInTheDocument();
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('cmd-child')).toBeNull();
    expect(sessionStorage.getItem('teslasync-cat-5-charging')).toBe('false');
  });

  it('restores a persisted OPEN state from sessionStorage, overriding defaultOpen=false', () => {
    sessionStorage.setItem('teslasync-cat-7-charging', 'true');
    // defaultOpen omitted → false, but the stored value wins.
    renderGroup({ vehicleKey: 7, category: 'charging' });
    expect(screen.getByTestId('cmd-child')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('restores a persisted CLOSED state from sessionStorage, overriding defaultOpen=true', () => {
    sessionStorage.setItem('teslasync-cat-2-climate', 'false');
    renderGroup({ vehicleKey: 2, category: 'climate', defaultOpen: true });
    expect(screen.queryByTestId('cmd-child')).toBeNull();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks both decorative icons aria-hidden so the accessible name comes from the visible label', () => {
    renderGroup({ category: 'security', count: 4 });
    const button = screen.getByRole('button');
    // Category icon + chevron are both decorative.
    const hiddenIcons = button.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenIcons.length).toBe(2);
    expect(button).toHaveAccessibleName(/security & access/i);
  });

  it('defends against a missing count with a "(0)" fallback instead of rendering "()"', () => {
    renderGroup({ count: undefined as unknown as number });
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('(0)');
    expect(button.textContent).not.toContain('()');
  });

  it('renders nothing for an unknown category rather than crashing on meta.icon', () => {
    const { container } = renderGroup({ category: 'does-not-exist' as CommandCategory });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('falls back to defaultOpen when sessionStorage.getItem throws (private mode / disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    renderGroup({ vehicleKey: 9, category: 'drive', defaultOpen: true });
    expect(screen.getByTestId('cmd-child')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not throw and still toggles when sessionStorage.setItem fails (quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    renderGroup({ vehicleKey: 3, category: 'doors' });
    const button = screen.getByRole('button');

    expect(() => fireEvent.click(button)).not.toThrow();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('cmd-child')).toBeInTheDocument();
  });
});
