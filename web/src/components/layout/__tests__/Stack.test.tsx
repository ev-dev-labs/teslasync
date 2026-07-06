import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps, ReactElement } from 'react';
import { Stack } from '../Stack';

// Render a Stack and hand back its rendered root element so class-name
// assertions don't depend on a forwarded test id.
function renderStack(ui: ReactElement): HTMLElement {
  const { container } = render(ui);
  return container.firstElementChild as HTMLElement;
}

describe('Stack', () => {
  it('renders a <div> with the flex/col/gap defaults and no align/justify', () => {
    const el = renderStack(<Stack>content</Stack>);
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('flex', 'flex-col', 'gap-4');
    // align / justify are opt-in — nothing should be emitted by default.
    expect(el.className).not.toContain('items-');
    expect(el.className).not.toContain('justify-');
    expect(el).toHaveTextContent('content');
  });

  it('switches to flex-row for direction="row" and keeps flex-col for "col"', () => {
    const row = renderStack(<Stack direction="row" />);
    expect(row).toHaveClass('flex', 'flex-row');
    expect(row.className).not.toContain('flex-col');

    const col = renderStack(<Stack direction="col" />);
    expect(col).toHaveClass('flex-col');
    expect(col.className).not.toContain('flex-row');
  });

  // ── gap variants ────────────────────────────────────────────────────
  const GAP_CASES: Array<[1 | 2 | 3 | 4 | 6 | 8, string]> = [
    [1, 'gap-1'],
    [2, 'gap-2'],
    [3, 'gap-3'],
    [4, 'gap-4'],
    [6, 'gap-6'],
    [8, 'gap-8'],
  ];
  it.each(GAP_CASES)('maps gap=%i to the literal class "%s"', (gap, cls) => {
    const el = renderStack(<Stack gap={gap} />);
    expect(el).toHaveClass(cls);
  });

  it('falls back to gap-4 for an out-of-range gap (JS caller / computed value)', () => {
    // The `gap` union guards TS callers, but a runtime value from JS or a
    // computed expression could slip through — it must degrade to gap-4
    // rather than dropping the gap class entirely.
    const el = renderStack(<Stack {...({ gap: 5 } as ComponentProps<typeof Stack>)} />);
    expect(el).toHaveClass('gap-4');
    expect(el.className).not.toContain('gap-5');
  });

  // ── align variants ──────────────────────────────────────────────────
  const ALIGN_CASES: Array<['start' | 'center' | 'end' | 'stretch', string]> = [
    ['start', 'items-start'],
    ['center', 'items-center'],
    ['end', 'items-end'],
    ['stretch', 'items-stretch'],
  ];
  it.each(ALIGN_CASES)('maps align="%s" to the literal class "%s"', (align, cls) => {
    const el = renderStack(<Stack align={align} />);
    expect(el).toHaveClass(cls);
  });

  // ── justify variants ────────────────────────────────────────────────
  const JUSTIFY_CASES: Array<['start' | 'center' | 'end' | 'between', string]> = [
    ['start', 'justify-start'],
    ['center', 'justify-center'],
    ['end', 'justify-end'],
    ['between', 'justify-between'],
  ];
  it.each(JUSTIFY_CASES)('maps justify="%s" to the literal class "%s"', (justify, cls) => {
    const el = renderStack(<Stack justify={justify} />);
    expect(el).toHaveClass(cls);
  });

  it('composes direction + gap + align + justify onto one element', () => {
    const el = renderStack(
      <Stack direction="row" gap={8} align="center" justify="between" />,
    );
    expect(el).toHaveClass(
      'flex',
      'flex-row',
      'gap-8',
      'items-center',
      'justify-between',
    );
  });

  it('renders as a custom semantic element via the `as` prop', () => {
    const el = renderStack(
      <Stack as="ul" aria-label="Tasks">
        <li>one</li>
      </Stack>,
    );
    expect(el.tagName).toBe('UL');
    // Still a real list for assistive tech, with its children intact.
    const list = screen.getByRole('list', { name: 'Tasks' });
    expect(list).toBe(el);
    expect(screen.getByText('one')).toBeInTheDocument();
  });

  it('merges a caller-supplied className with the computed layout classes', () => {
    const el = renderStack(<Stack className="mt-6 rounded-xl" />);
    expect(el).toHaveClass('flex', 'flex-col', 'gap-4', 'mt-6', 'rounded-xl');
  });

  it('forwards arbitrary DOM/ARIA props to the underlying element', () => {
    const el = renderStack(
      <Stack id="toolbar" role="group" aria-label="Filters" title="Filter bar" />,
    );
    expect(el).toHaveAttribute('id', 'toolbar');
    expect(el).toHaveAttribute('title', 'Filter bar');
    const group = screen.getByRole('group', { name: 'Filters' });
    expect(group).toBe(el);
  });

  it('does NOT leak layout-only props onto the rendered DOM element', () => {
    const el = renderStack(
      <Stack direction="row" gap={2} align="center" justify="between" />,
    );
    for (const attr of ['direction', 'gap', 'align', 'justify', 'as']) {
      expect(el.getAttribute(attr)).toBeNull();
    }
  });

  it('fires a forwarded onClick handler on interaction', () => {
    const onClick = vi.fn();
    const el = renderStack(<Stack onClick={onClick}>hit me</Stack>);
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
