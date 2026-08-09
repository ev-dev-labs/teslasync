/**
 * WeekSelector — behaviour, branch, interaction, hardening + a11y cover.
 *
 * Single export: <WeekSelector weekLabel isCurrentWeek onPrevWeek onNextWeek />.
 * It is the navigation band at the top of the Weekly Digest page: a "Previous"
 * ghost button, a calendar glyph + the week-range label, an optional "Current"
 * badge, and a "Next" ghost button that is disabled while viewing the current
 * week (you cannot page into the future). The two week callbacks are wired
 * straight through, so the component owns no data or network surface.
 *
 * Facets covered:
 *   1. RENDER      — the label and both nav buttons surface; a past week shows
 *                    no "Current" badge.
 *   2. PREV        — clicking Previous fires onPrevWeek exactly once and never
 *                    touches onNextWeek.
 *   3. NEXT        — in a past week the Next button is enabled and clicking it
 *                    fires onNextWeek exactly once (and not onPrevWeek).
 *   4. CURRENT     — the current week renders the "Current" badge, disables Next,
 *                    and keeps Previous enabled + clickable (you can always page
 *                    backwards).
 *   5. NO-FUTURE   — the disabled Next is inert: a click never reaches onNextWeek
 *                    (regression guard for accidentally paging past "now").
 *   6. A11Y        — the icon-only-on-mobile buttons expose real text accessible
 *                    names via aria-label, the calendar glyph is decorative
 *                    (aria-hidden), and the label is never hidden from AT.
 *   7. KEYBOARD    — Previous is a genuine native button, so it is focusable
 *                    and keyboard-operable (Enter/Space) out of the box.
 *   8. HARDENING   — an empty label degrades to an em-dash placeholder instead of
 *                    collapsing the band into a blank strip.
 *   9. TRUNCATION  — the (truncate-clipped) label exposes a full-text `title`
 *                    tooltip so the whole range stays discoverable on hover.
 *
 * `react-i18next` is stubbed to the English fallback so copy is deterministic
 * ("Previous" / "Next" / "Current"). No other mocks are needed: WeekSelector
 * reads no settings and touches no network, so a bare render() suffices.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: unknown) => (typeof opts === 'string' ? opts : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { WeekSelector } from './WeekSelector';

afterEach(cleanup);

/** Renders the band with sensible defaults + spies, overridable per case. */
function setup(overrides: Partial<React.ComponentProps<typeof WeekSelector>> = {}) {
  const onPrevWeek = vi.fn();
  const onNextWeek = vi.fn();
  const props = {
    weekLabel: 'Jan 1 – Jan 7',
    isCurrentWeek: false,
    onPrevWeek,
    onNextWeek,
    ...overrides,
  };
  const utils = render(<WeekSelector {...props} />);
  return { ...utils, onPrevWeek, onNextWeek };
}

const prevButton = () => screen.getByRole('button', { name: 'Previous' });
const nextButton = () => screen.getByRole('button', { name: 'Next' });

describe('WeekSelector', () => {
  it('renders the week label and both navigation buttons, with no Current badge in a past week', () => {
    setup({ weekLabel: 'Jan 1 – Jan 7', isCurrentWeek: false });

    expect(screen.getByText('Jan 1 – Jan 7')).toBeInTheDocument();
    expect(prevButton()).toBeInTheDocument();
    expect(nextButton()).toBeInTheDocument();
    // A past week is not "current" — the badge must be absent.
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
  });

  it('fires onPrevWeek exactly once when Previous is clicked, without invoking onNextWeek', () => {
    const { onPrevWeek, onNextWeek } = setup();

    fireEvent.click(prevButton());

    expect(onPrevWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).not.toHaveBeenCalled();
  });

  it('fires onNextWeek exactly once when Next is clicked in a past week', () => {
    const { onPrevWeek, onNextWeek } = setup({ isCurrentWeek: false });

    const next = nextButton();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    expect(onNextWeek).toHaveBeenCalledTimes(1);
    expect(onPrevWeek).not.toHaveBeenCalled();
  });

  it('marks the current week: shows the Current badge, disables Next, keeps Previous usable', () => {
    const { onPrevWeek } = setup({ isCurrentWeek: true });

    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();

    // Previous is never disabled — you can always page backwards from "now".
    const prev = prevButton();
    expect(prev).not.toBeDisabled();
    fireEvent.click(prev);
    expect(onPrevWeek).toHaveBeenCalledTimes(1);
  });

  it('never pages into the future: the disabled Next button does not reach onNextWeek', () => {
    const { onNextWeek } = setup({ isCurrentWeek: true });

    const next = nextButton();
    expect(next).toBeDisabled();
    // A disabled form control suppresses the click — the handler stays untouched.
    fireEvent.click(next);
    expect(onNextWeek).not.toHaveBeenCalled();
  });

  it('exposes accessible names on the icon buttons and keeps the calendar glyph decorative', () => {
    const { container } = setup({ weekLabel: 'Feb 5 – Feb 11' });

    // Icon-only on mobile — the aria-label carries the accessible name.
    expect(prevButton()).toHaveAccessibleName('Previous');
    expect(nextButton()).toHaveAccessibleName('Next');

    // The decorative calendar SVG is hidden from assistive tech...
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // ...but the informative label is NOT hidden.
    expect(screen.getByText('Feb 5 – Feb 11').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('renders Previous as a genuine, focusable native button (keyboard-operable)', () => {
    setup();

    const prev = prevButton();
    // Native button semantics guarantee Enter/Space activation + tab focus.
    expect(prev.tagName).toBe('BUTTON');
    prev.focus();
    expect(prev).toHaveFocus();
  });

  it('degrades an empty label to an em-dash placeholder instead of a blank band', () => {
    const { container } = setup({ weekLabel: '' });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });

  it('exposes the full week range as a title tooltip for the truncated label', () => {
    setup({ weekLabel: 'Dec 25, 2024 – Dec 31, 2024' });

    expect(screen.getByText('Dec 25, 2024 – Dec 31, 2024')).toHaveAttribute(
      'title',
      'Dec 25, 2024 – Dec 31, 2024',
    );
  });
});
