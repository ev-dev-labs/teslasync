/**
 * StatusBadge contract.
 *
 * A presentational chip that pairs a coloured FSM "dot" with the vehicle status
 * text. The dot colour is sourced from the single-source vehicle FSM theme
 * (@/types/fsm), the text is the raw status (styled `capitalize`), and the chip
 * must fail closed — a nullish, blank, or whitespace-only status renders a
 * neutral em-dash placeholder rather than throwing (getStateDefinition lowercases
 * its argument, so a bare null/undefined used to blow up) or leaving a blank chip.
 *
 * Coverage:
 *   1. Every known vehicle state → its canonical badge-dot colour + raw label.
 *   2. Dot colours are distinct across states (colour actually encodes state).
 *   3. Size variants (sm / md, md default) drive the chip text + dot sizing.
 *   4. Unknown states (e.g. the SystemHealthWidget 'away') fall back to a neutral
 *      grey dot while still surfacing the raw label — never throwing.
 *   5. Fail-closed edges: '', '   ', null, undefined → em-dash + neutral dot, no throw.
 *   6. a11y/structure: the dot is aria-hidden (decorative), the status is conveyed
 *      by text, and the chip is a single inline-flex rounded-full shell of 2 spans.
 *   7. className is merged onto the outer chip.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from './StatusBadge';
import { getStateDefinition } from '@/types/fsm';

function renderBadge(status: string | null | undefined, props: { size?: 'sm' | 'md'; className?: string } = {}) {
  const { container } = render(<StatusBadge status={status} {...props} />);
  const chip = container.firstElementChild as HTMLElement;
  const dot = container.querySelector('[aria-hidden="true"]') as HTMLElement;
  const label = chip.lastElementChild as HTMLElement;
  return { container, chip, dot, label };
}

// Canonical badge-dot colour per vehicle state — mirrors VEHICLE_STATE_ENTRIES
// (@/types/fsm/vehicle) resolved through the variant theme. Offline inherits the
// danger dot (no badgeDot override); asleep/updating/driving/... override it.
const KNOWN_DOTS: Array<[status: string, dot: string]> = [
  ['online', 'bg-green-400'],
  ['driving', 'bg-blue-500'],
  ['charging', 'bg-yellow-400'],
  ['parked', 'bg-cyan-500'],
  ['updating', 'bg-indigo-500'],
  ['asleep', 'bg-purple-500'],
  ['offline', 'bg-red-400'],
];

const NEUTRAL_DOT = 'bg-gray-400';

describe('StatusBadge — status → dot colour', () => {
  it.each(KNOWN_DOTS)('renders %s with its canonical dot colour and raw label', (status, dot) => {
    const { dot: dotEl, label } = renderBadge(status);
    expect(dotEl).toHaveClass(dot);
    // Text is the raw status (not translated / Title-cased); `capitalize` is
    // purely visual so the DOM text node stays lower-case.
    expect(label).toHaveTextContent(status);
    expect(screen.getByText(status)).toBeInTheDocument();
  });

  it('wires the FSM single-source badge-dot into the DOM', () => {
    // Cross-check one state against the source of truth so a future theme change
    // that forgets StatusBadge is caught, without duplicating the whole table.
    const { dot } = renderBadge('charging');
    expect(dot.className).toContain(getStateDefinition('vehicle', 'charging').badgeDot);
  });

  it('assigns a distinct dot colour to each known state', () => {
    const dots = KNOWN_DOTS.map(([status]) => renderBadge(status).dot.className.match(/bg-\S+/)?.[0]);
    expect(new Set(dots).size).toBe(dots.length);
  });
});

describe('StatusBadge — size variants', () => {
  it('uses the md sizing by default', () => {
    const { chip, dot } = renderBadge('online');
    expect(chip).toHaveClass('text-sm');
    expect(dot).toHaveClass('h-2', 'w-2');
  });

  it('applies compact sizing for size="sm"', () => {
    const { chip, dot } = renderBadge('online', { size: 'sm' });
    expect(chip).toHaveClass('text-xs');
    expect(dot).toHaveClass('h-1.5', 'w-1.5');
    expect(chip).not.toHaveClass('text-sm');
  });
});

describe('StatusBadge — unknown & fail-closed states', () => {
  it('falls back to a neutral dot for an unknown status but keeps the raw label', () => {
    // SystemHealthWidget maps a degraded system to 'away', which is not a vehicle
    // FSM state — it must render (grey dot + "away"), never throw.
    const { dot } = renderBadge('away');
    expect(dot).toHaveClass(NEUTRAL_DOT);
    expect(screen.getByText('away')).toBeInTheDocument();
    for (const [, knownDot] of KNOWN_DOTS) {
      expect(dot).not.toHaveClass(knownDot);
    }
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('renders the em-dash placeholder for a %s status without throwing', (_label, status) => {
    expect(() => renderBadge(status)).not.toThrow();
    const { dot } = renderBadge(status);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(dot).toHaveClass(NEUTRAL_DOT);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('fails closed to a neutral placeholder for a %s status (regression: no toLowerCase crash)', (_label, status) => {
    expect(() => render(<StatusBadge status={status} />)).not.toThrow();
    const { dot } = renderBadge(status);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(dot).toHaveClass(NEUTRAL_DOT);
  });

  it('trims a whitespace-padded known status so its colour still resolves', () => {
    const { dot, label } = renderBadge('  charging  ');
    expect(dot).toHaveClass('bg-yellow-400');
    expect(label).toHaveTextContent('charging');
  });
});

describe('StatusBadge — a11y & structure', () => {
  it('marks the colour dot decorative and conveys status via text', () => {
    const { chip, dot } = renderBadge('driving');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // The status is available to assistive tech as text, not colour alone.
    expect(chip).toHaveTextContent('driving');
  });

  it('renders a single inline-flex rounded-full chip wrapping exactly two spans', () => {
    const { container, chip } = renderBadge('parked');
    // Outer chip span + dot span + label span.
    expect(container.querySelectorAll('span')).toHaveLength(3);
    expect(chip.childElementCount).toBe(2);
    expect(chip).toHaveClass('inline-flex', 'rounded-full', 'font-medium');
  });
});

describe('StatusBadge — className passthrough', () => {
  it('merges a caller className onto the outer chip', () => {
    const { chip } = renderBadge('online', { className: 'ml-4 shrink-0' });
    expect(chip).toHaveClass('ml-4', 'shrink-0');
    // Base chip classes are preserved alongside the override.
    expect(chip).toHaveClass('inline-flex', 'items-center');
  });
});
