// Behavioural coverage for <StateBadge> — the pill that renders an FSM
// state name with a theme-resolved colour (background, text, and a leading
// status dot) for the State Machine Debugger, snapshot inspector, and
// sub-FSM panels.
//
// The colour contract is owned by getStateColor() in @/types/fsm; these
// tests pin the *component's* responsibilities on top of it:
//   - it resolves and applies the themed bg/text/dot classes for a state,
//   - it is case-insensitive and whitespace-tolerant when looking up colour,
//   - unknown states/FSM types degrade to the neutral default (never throw),
//   - a nullish/blank state renders an em-dash placeholder (never an empty
//     pill and never a `.toLowerCase()` crash on undefined), and
//   - the leading dot is decorative (aria-hidden), so the label carries the
//     accessible meaning.
//
// Nothing here touches the network — StateBadge is a pure presentational
// leaf, so no i18n runtime or query client is mocked.

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';

import { StateBadge } from './StateBadge';

// Neutral-default classes come from DEFAULT_STATE in @/types/fsm/theme.ts.
const NEUTRAL_TEXT = 'text-[var(--text-muted)]';
const NEUTRAL_BG = 'bg-gray-500/10';
const NEUTRAL_DOT = 'bg-gray-400';

/** The single decorative dot inside a rendered badge. */
function dotOf(container: HTMLElement): HTMLElement {
  const dot = container.querySelector('span[aria-hidden="true"]');
  if (!dot) throw new Error('expected a decorative dot span');
  return dot as HTMLElement;
}

afterEach(() => cleanup());

describe('StateBadge', () => {
  it('renders the state label and applies that state\'s themed bg/text/dot classes', () => {
    // vehicle.online = success variant → green theme (no per-state override).
    const { container } = render(<StateBadge state="online" fsmType="vehicle" />);

    const badge = screen.getByText('online');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.className).toContain('bg-green-500/10');
    expect(badge.className).toContain('text-green-400');
    expect(dotOf(container).className).toContain('bg-green-400');
  });

  it('themes each state distinctly — parked resolves the purple override, not green', () => {
    // vehicle.parked = info variant with a purple override; proves the badge
    // reads per-state overrides rather than a single hard-coded colour.
    const { container } = render(<StateBadge state="parked" fsmType="vehicle" />);

    const badge = screen.getByText('parked');
    expect(badge.className).toContain('bg-purple-500/10');
    expect(badge.className).toContain('text-purple-400');
    expect(badge.className).not.toContain('text-green-400');
    expect(dotOf(container).className).toContain('bg-purple-400');
  });

  it('matches state colour case-insensitively while preserving the original label casing', () => {
    render(<StateBadge state="DRIVING" fsmType="vehicle" />);

    // Display keeps the caller's casing…
    const badge = screen.getByText('DRIVING');
    expect(badge.textContent).toBe('DRIVING');
    // …but colour resolution lower-cases the key, so it still hits the theme.
    expect(badge.className).toContain('text-green-400');
    expect(badge.className).not.toContain(NEUTRAL_TEXT);
  });

  it('trims surrounding whitespace so a padded state still resolves its colour', () => {
    // Without trimming, getStateColor("  driving  ") misses the map and the
    // badge would fall back to the neutral grey — this is the padded-input bug.
    render(<StateBadge state="  driving  " fsmType="vehicle" />);

    const badge = screen.getByText('driving');
    expect(badge.textContent).toBe('driving');
    expect(badge.className).toContain('text-green-400');
    expect(badge.className).not.toContain(NEUTRAL_BG);
  });

  it('falls back to the neutral default for an unknown state name', () => {
    const { container } = render(<StateBadge state="teleporting" fsmType="vehicle" />);

    const badge = screen.getByText('teleporting');
    expect(badge.className).toContain(NEUTRAL_BG);
    expect(badge.className).toContain(NEUTRAL_TEXT);
    expect(dotOf(container).className).toContain(NEUTRAL_DOT);
  });

  it('falls back to the vehicle FSM when the fsmType is unknown', () => {
    // getStateColor defaults an unknown fsmType to the vehicle registry, so a
    // vehicle state name still resolves its real colour.
    render(<StateBadge state="driving" fsmType="totally-not-an-fsm" />);

    const badge = screen.getByText('driving');
    expect(badge.className).toContain('text-green-400');
  });

  it('renders an em-dash placeholder (neutral) for a null state without throwing', () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(<StateBadge state={null} fsmType="vehicle" />).container;
    }).not.toThrow();

    const badge = screen.getByText('—');
    expect(badge.className).toContain(NEUTRAL_TEXT);
    expect(badge.className).toContain(NEUTRAL_BG);
    // The decorative dot is still present, just neutral-coloured.
    expect(dotOf(container).className).toContain(NEUTRAL_DOT);
  });

  it('renders the placeholder for undefined and blank/whitespace-only states', () => {
    const { rerender } = render(<StateBadge state={undefined} fsmType="vehicle" />);
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(<StateBadge state="" fsmType="vehicle" />);
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(<StateBadge state="   " fsmType="vehicle" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('marks the leading status dot as decorative so the label carries the meaning', () => {
    const { container } = render(<StateBadge state="charging" fsmType="vehicle" />);

    // Exactly one aria-hidden dot; the visible text is the accessible name.
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden).toHaveLength(1);
    expect(hidden[0].tagName).toBe('SPAN');
    expect(screen.getByText('charging')).toBeInTheDocument();
  });
});
