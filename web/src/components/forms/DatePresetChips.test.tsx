/**
 * DatePresetChips unit tests.
 *
 * Locks in the behavioural contract of the quick-select chip row:
 *   1. Renders one <button> chip per resolvable preset id, using the
 *      shared <Button> (real, keyboard-operable, type="button").
 *   2. Honours the CALLER'S presetIds order — the regression this file
 *      guards against is the old `DATE_PRESETS.filter(...)` which silently
 *      re-ordered chips to the canonical preset order.
 *   3. De-duplicates repeated ids and drops unknown ids.
 *   4. Renders nothing (null) when there is nothing resolvable to show.
 *   5. onSelect fires once per activation with { id, start, end } where
 *      start/end are ISO YYYY-MM-DD strings from the preset's resolve().
 *   6. activeId drives aria-pressed + the primary/ghost variant branch.
 *   7. size, ariaLabel and className props are forwarded/merged.
 *
 * i18n is mocked so `t(key, fallback)` deterministically returns the
 * fallback label (the en bundle has no date.preset.* keys anyway).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DatePresetChips, type DatePresetSelection } from './DatePresetChips';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function chipNames(): string[] {
  return screen.getAllByRole('button').map(b => b.textContent?.trim() ?? '');
}

describe('DatePresetChips — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the default preset set inside a labelled group', () => {
    render(<DatePresetChips onSelect={vi.fn()} />);
    const group = screen.getByRole('group', { name: /quick date range/i });
    expect(group).toBeInTheDocument();
    // DEFAULT_PRESET_IDS = today, 7d, 30d, mtd, ytd, all → 6 chips.
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(6);
    expect(chipNames()).toEqual([
      'Today',
      'Last 7 days',
      'Last 30 days',
      'Month to date',
      'Year to date',
      'All time',
    ]);
  });

  it('renders only the requested subset of presets', () => {
    render(<DatePresetChips presetIds={['today', '7d']} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All time' })).toBeNull();
  });

  it('honours the caller order instead of the canonical DATE_PRESETS order', () => {
    // Reversed vs canonical (today < 7d < 30d). The old filter()-based
    // implementation would have rendered [30d,7d,today] as [today,7d,30d].
    render(
      <DatePresetChips presetIds={['30d', '7d', 'today']} onSelect={vi.fn()} />,
    );
    expect(chipNames()).toEqual(['Last 30 days', 'Last 7 days', 'Today']);
  });

  it('de-duplicates repeated ids (keeping first position)', () => {
    render(
      <DatePresetChips
        presetIds={['7d', 'today', '7d', 'today']}
        onSelect={vi.fn()}
      />,
    );
    expect(chipNames()).toEqual(['Last 7 days', 'Today']);
  });

  it('drops unknown ids but keeps the valid ones', () => {
    render(
      <DatePresetChips
        presetIds={['today', 'not-a-preset', '30d']}
        onSelect={vi.fn()}
      />,
    );
    expect(chipNames()).toEqual(['Today', 'Last 30 days']);
    expect(screen.queryByRole('button', { name: 'not-a-preset' })).toBeNull();
  });

  it('renders nothing when presetIds is empty', () => {
    const { container } = render(
      <DatePresetChips presetIds={[]} onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('renders nothing when every requested id is unknown', () => {
    const { container } = render(
      <DatePresetChips presetIds={['nope', 'zzz']} onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DatePresetChips — selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call onSelect on mount', () => {
    const onSelect = vi.fn();
    render(<DatePresetChips onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls onSelect once with a resolved ISO range for a single-day preset', () => {
    const onSelect = vi.fn();
    render(<DatePresetChips presetIds={['today']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as DatePresetSelection;
    expect(arg.id).toBe('today');
    expect(arg.start).toMatch(ISO);
    expect(arg.end).toMatch(ISO);
    // "Today" resolves to a single calendar day.
    expect(arg.start).toBe(arg.end);
  });

  it('resolves a real multi-day span for the 7-day preset', () => {
    const onSelect = vi.fn();
    render(<DatePresetChips presetIds={['7d']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    const arg = onSelect.mock.calls[0][0] as DatePresetSelection;
    expect(arg.id).toBe('7d');
    expect(arg.start).toMatch(ISO);
    expect(arg.end).toMatch(ISO);
    // start is 6 days before end → strictly earlier (ISO sorts lexically).
    expect(arg.start < arg.end).toBe(true);
  });

  it('reports the clicked preset id when several chips are present', () => {
    const onSelect = vi.fn();
    render(
      <DatePresetChips presetIds={['today', '30d', 'all']} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as DatePresetSelection;
    expect(arg.id).toBe('all');
    // "All time" starts at the fixed history baseline.
    expect(arg.start).toBe('2015-01-01');
  });
});

describe('DatePresetChips — active state & variant branch', () => {
  it('marks only the active chip with aria-pressed=true', () => {
    render(
      <DatePresetChips
        presetIds={['today', '7d', '30d']}
        activeId="7d"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Last 7 days' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Today' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: 'Last 30 days' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the active chip with the primary variant and others as ghost', () => {
    render(
      <DatePresetChips
        presetIds={['today', '7d']}
        activeId="today"
        onSelect={vi.fn()}
      />,
    );
    const active = screen.getByRole('button', { name: 'Today' });
    const inactive = screen.getByRole('button', { name: 'Last 7 days' });
    expect(active.className).toContain('var(--theme-primary)');
    expect(inactive.className).toContain('bg-transparent');
  });

  it('marks no chip active when activeId is absent', () => {
    render(<DatePresetChips presetIds={['today', '7d']} onSelect={vi.fn()} />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

describe('DatePresetChips — accessibility & prop passthrough', () => {
  it('renders native type="button" chips that are keyboard focusable', () => {
    render(<DatePresetChips presetIds={['today']} onSelect={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Today' });
    expect(btn.tagName.toLowerCase()).toBe('button');
    expect(btn).toHaveAttribute('type', 'button');
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('forwards the size prop through to the shared Button', () => {
    const { rerender } = render(
      <DatePresetChips presetIds={['today']} onSelect={vi.fn()} />,
    );
    // Default size is "sm" → Button applies h-8.
    expect(screen.getByRole('button', { name: 'Today' }).className).toContain(
      'h-8',
    );
    rerender(
      <DatePresetChips presetIds={['today']} size="md" onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Today' }).className).toContain(
      'h-10',
    );
  });

  it('uses the supplied ariaLabel as the group accessible name', () => {
    render(
      <DatePresetChips
        presetIds={['today']}
        ariaLabel="Signal time window"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('group', { name: 'Signal time window' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /quick date range/i })).toBeNull();
  });

  it('merges a pass-through className onto the group wrapper', () => {
    render(
      <DatePresetChips
        presetIds={['today']}
        className="mt-2 justify-end"
        onSelect={vi.fn()}
      />,
    );
    const group = screen.getByRole('group');
    expect(group.className).toContain('mt-2');
    expect(group.className).toContain('justify-end');
    // Base layout classes are preserved alongside the override.
    expect(group.className).toContain('flex');
  });
});
