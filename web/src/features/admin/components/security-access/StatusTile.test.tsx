/**
 * StatusTile contract.
 *
 * <StatusTile> is a token-driven presentational leaf used by the Security &
 * Access status/window grids. It renders an icon chip + label + value (+ an
 * optional description), conveying state via icon *and* text — never colour
 * alone (the chip is decorative / aria-hidden). The behaviour pinned here:
 *
 *   1. Content + structure — the label, value and optional description render
 *      as text; the supplied icon lives inside the decorative chip; the
 *      description line only exists when a description is passed; a caller
 *      className is merged onto the root tile without dropping the base shell.
 *   2. Tone mapping — every one of the seven TileTone values maps to its own
 *      chip background + value accent (mirrors the toneClasses table), and
 *      distinct tones stay visually distinct.
 *   3. Size variants — the value renders at `base` by default and `lg` when
 *      requested, always semibold.
 *   4. a11y — the icon chip is aria-hidden so screen readers hear only the
 *      label + value text.
 *   5. Robustness / hardening — an unrecognised tone leaking past the TS union
 *      fails closed to the neutral muted chip instead of throwing; a nullish
 *      value renders an em-dash placeholder instead of a blank line; a nullish
 *      label degrades without crashing.
 *
 * StatusTile takes already-translated strings and touches no i18n / network /
 * QueryClient, so a bare render() is sufficient — no mocks required.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { TileTone } from './helpers';
import { StatusTile, type StatusTileProps } from './StatusTile';

function renderTile(overrides: Partial<StatusTileProps> = {}) {
  const props: StatusTileProps = {
    icon: <svg data-testid="tile-icon" />,
    label: 'Lock Status',
    value: 'Locked',
    tone: 'green',
    ...overrides,
  };
  const utils = render(<StatusTile {...props} />);
  const root = utils.container.firstElementChild as HTMLElement | null;
  const chip = utils.container.querySelector<HTMLElement>('[aria-hidden="true"]');
  return { ...utils, root, chip, props };
}

// Mirrors the `toneClasses` table in StatusTile.tsx — one chip bg + one value
// accent fragment per tone. `muted` is the neutral/unknown state.
const TONES: Array<{ tone: TileTone; chip: string; value: string }> = [
  { tone: 'green', chip: 'bg-neon-green/10', value: 'text-emerald-300' },
  { tone: 'red', chip: 'bg-neon-red/10', value: 'text-rose-300' },
  { tone: 'amber', chip: 'bg-neon-amber/10', value: 'text-amber-300' },
  { tone: 'blue', chip: 'bg-neon-blue/10', value: 'text-indigo-300' },
  { tone: 'purple', chip: 'bg-neon-purple/10', value: 'text-purple-300' },
  { tone: 'cyan', chip: 'bg-neon-cyan/10', value: 'text-cyan-300' },
  { tone: 'muted', chip: 'bg-white/[0.04]', value: 'text-[var(--text-secondary)]' },
];

// ── Content + structure ──────────────────────────────────────────────────────

describe('StatusTile — content + structure', () => {
  it('renders the label, value and description as visible text', () => {
    renderTile({
      label: 'Sentry Mode',
      value: 'Active',
      description: 'Camera surveillance system',
    });

    expect(screen.getByText('Sentry Mode')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Camera surveillance system')).toBeInTheDocument();
  });

  it('renders the supplied icon inside the decorative chip', () => {
    renderTile();

    const icon = screen.getByTestId('tile-icon');
    const chip = icon.closest('[aria-hidden="true"]');
    expect(chip).not.toBeNull();
    expect(chip?.tagName).toBe('SPAN');
  });

  it('renders only the value line (single <p>) when no description is given', () => {
    const { container } = renderTile({ value: 'Locked' });
    // The value is the sole <p>; a description would add a second one.
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByText('Locked').tagName).toBe('P');
  });

  it('adds the description as a second <p> when provided', () => {
    const { container } = renderTile({
      value: 'Locked',
      description: 'Vehicle lock state',
    });
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByText('Vehicle lock state').tagName).toBe('P');
  });

  it('merges a caller className onto the root tile without dropping the base shell', () => {
    const { root } = renderTile({ className: 'col-span-2' });
    expect(root?.className).toContain('col-span-2');
    expect(root?.className).toContain('rounded-xl');
  });
});

// ── Tone mapping ─────────────────────────────────────────────────────────────

describe('StatusTile — tone mapping', () => {
  it.each(TONES)('maps the "$tone" tone to its chip + value accent', ({ tone, chip, value }) => {
    const { chip: chipEl } = renderTile({ tone, value: `val-${tone}` });
    expect(chipEl?.className).toContain(chip);

    const valueEl = screen.getByText(`val-${tone}`);
    expect(valueEl.className).toContain(value);
  });

  it('gives each tone a distinct chip background (map is not collapsed)', () => {
    const green = renderTile({ tone: 'green' }).chip?.className ?? '';
    const red = renderTile({ tone: 'red' }).chip?.className ?? '';
    const muted = renderTile({ tone: 'muted' }).chip?.className ?? '';

    expect(green).toContain('bg-neon-green/10');
    expect(red).toContain('bg-neon-red/10');
    expect(muted).toContain('bg-white/[0.04]');
    expect(green).not.toEqual(red);
    expect(green).not.toEqual(muted);
  });
});

// ── Size variants ────────────────────────────────────────────────────────────

describe('StatusTile — size variants', () => {
  it('renders the value at base size by default', () => {
    renderTile({ value: 'BaseVal' });
    const el = screen.getByText('BaseVal');
    expect(el.className).toContain('text-base');
    expect(el.className).not.toContain('text-lg');
  });

  it('renders the value at lg size when size="lg"', () => {
    renderTile({ value: 'BigVal', size: 'lg' });
    const el = screen.getByText('BigVal');
    expect(el.className).toContain('text-lg');
    expect(el.className).not.toContain('text-base');
  });

  it('always renders the value with semibold weight', () => {
    renderTile({ value: 'WeightVal' });
    expect(screen.getByText('WeightVal').className).toContain('font-semibold');
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('StatusTile — a11y', () => {
  it('marks the icon chip decorative (aria-hidden) so SR users hear only the text', () => {
    const { chip } = renderTile();
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('aria-hidden', 'true');
  });

  it('conveys status through visible text, never colour alone', () => {
    renderTile({ label: 'Doors', value: 'Closed', tone: 'green' });
    // Both the label and the state value are real, readable text nodes.
    expect(screen.getByText('Doors')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});

// ── Robustness / defensive hardening ─────────────────────────────────────────

describe('StatusTile — robustness', () => {
  it('fails closed to the neutral muted chip for an unrecognised tone (no throw)', () => {
    // Simulate a widened value from an untyped caller leaking past the union.
    const unknownTone = 'chartreuse' as unknown as TileTone;

    let result: ReturnType<typeof renderTile> | undefined;
    expect(() => {
      result = renderTile({ tone: unknownTone, value: 'Fallback' });
    }).not.toThrow();

    expect(result?.chip?.className).toContain('bg-white/[0.04]');
    expect(result?.chip?.className).toContain('text-[var(--text-muted)]');
    // ...and never one of the coloured tone chips.
    expect(result?.chip?.className).not.toContain('bg-neon-green/10');
    expect(screen.getByText('Fallback')).toBeInTheDocument();
  });

  it('renders an em-dash placeholder for a nullish value (never a blank value line)', () => {
    const nullishValue = undefined as unknown as string;
    expect(() => renderTile({ value: nullishValue })).not.toThrow();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('degrades gracefully with a nullish label (no crash, value still shown)', () => {
    const nullishLabel = undefined as unknown as string;
    expect(() => renderTile({ label: nullishLabel, value: 'Locked' })).not.toThrow();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });
});
