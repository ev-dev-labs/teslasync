/**
 * WidgetStatusGrid — the shared "grid of labelled status chips" primitive used by
 * the dashboard status widgets (Safety, Security, BatteryCells, DoorWindow…).
 *
 * Behaviour surface under test:
 *   1. Empty branch — an empty `cells` array (and, as a hardened regression, a
 *      runtime-`undefined` array that the `data?.field` call-sites can produce)
 *      renders the shared EmptyState with the resolved message + icon instead of
 *      an empty grid or a "Cannot read properties of undefined" crash.
 *   2. Cell rendering — one chip per cell, the label always shows, the value shows
 *      only when present AND not `compact`, and a supplied icon is rendered.
 *   3. Status → style map — each of the five known statuses paints its chip
 *      background and status-dot colour.
 *   4. Fail-closed status — a status outside the union (a raw backend string cast
 *      to StatusCell['status']) must NOT dereference `undefined`; it falls back to
 *      the neutral "unknown" styling and still renders the label. This is the
 *      hardened bug: `statusStyles[cell.status]` used to return `undefined` and
 *      the next `.bg` access threw, taking the whole widget (and its dashboard
 *      row) down.
 *   5. Column layout — `cols` selects the container-query grid template, `compact`
 *      forces the 2-up baseline and tightens chip padding.
 *   6. a11y — the colour-only status dot and the decorative icon are `aria-hidden`
 *      (the label/value text is the accessible channel), matching StatusBadge.
 *
 * EmptyState is stubbed to a prop-surfacing span so the empty branch is asserted
 * directly (message + icon forwarding) without pulling Router/Typography into the
 * unit. WidgetStatusGrid is pure/presentational — no hooks, no network — so no
 * MSW/query mocking is required here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WidgetStatusGrid, type StatusCell } from './WidgetStatusGrid';

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message, icon }: { message?: string; icon?: ReactNode }) => (
    <div data-testid="empty-state">
      <span data-testid="empty-message">{message}</span>
      {icon != null && <span data-testid="empty-icon">{icon}</span>}
    </div>
  ),
}));

afterEach(cleanup);

function makeCell(overrides: Partial<StatusCell> = {}): StatusCell {
  return { id: 'c1', label: 'Cell', status: 'ok', ...overrides };
}

function getGrid(container: HTMLElement): HTMLElement {
  const grid = container.querySelector('div.grid');
  if (!grid) throw new Error('status grid not rendered');
  return grid as HTMLElement;
}

function getCellNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(getGrid(container).children) as HTMLElement[];
}

function getDot(cell: HTMLElement): HTMLElement {
  const dot = cell.querySelector('span.rounded-full');
  if (!dot) throw new Error('status dot not rendered');
  return dot as HTMLElement;
}

describe('WidgetStatusGrid — empty state', () => {
  it('renders the shared EmptyState with the default message when there are no cells', () => {
    const { container } = render(<WidgetStatusGrid cells={[]} />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-message')).toHaveTextContent('No status data available');
    // No grid is rendered on the empty branch.
    expect(container.querySelector('div.grid')).toBeNull();
  });

  it('forwards a custom emptyMessage and emptyIcon to the EmptyState', () => {
    render(
      <WidgetStatusGrid
        cells={[]}
        emptyMessage="Nothing to report"
        emptyIcon={<svg data-testid="my-empty-icon" />}
      />,
    );

    expect(screen.getByTestId('empty-message')).toHaveTextContent('Nothing to report');
    expect(screen.getByTestId('my-empty-icon')).toBeInTheDocument();
  });

  it('degrades to the empty state (no crash) when cells is a runtime undefined', () => {
    // Prop type is StatusCell[], but real call-sites pass `data?.cells`, which is
    // `undefined` before the first successful fetch. It must land on the empty
    // state, never throw on `.length`/`.map`.
    expect(() =>
      render(<WidgetStatusGrid cells={undefined as unknown as StatusCell[]} />),
    ).not.toThrow();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
});

describe('WidgetStatusGrid — cell rendering', () => {
  it('renders exactly one chip per cell with its label and value', () => {
    const { container } = render(
      <WidgetStatusGrid
        cells={[
          makeCell({ id: 'lock', label: 'Lock', status: 'ok', value: 'Locked' }),
          makeCell({ id: 'sentry', label: 'Sentry', status: 'inactive', value: 'Off' }),
        ]}
      />,
    );

    expect(getCellNodes(container)).toHaveLength(2);
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Sentry')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('hides the value line in compact mode but keeps the label', () => {
    render(<WidgetStatusGrid cells={[makeCell({ label: 'Lock', value: 'Locked' })]} compact />);

    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).toBeNull();
  });

  it('omits the value line entirely when a cell has no value', () => {
    const { container } = render(
      <WidgetStatusGrid cells={[makeCell({ label: 'Lock', status: 'ok' })]} />,
    );

    const [cell] = getCellNodes(container);
    // Only the label paragraph — no value paragraph is emitted.
    expect(cell.querySelectorAll('p')).toHaveLength(1);
    expect(within(cell).getByText('Lock')).toBeInTheDocument();
  });

  it('renders a supplied icon marked decorative (aria-hidden)', () => {
    const { container } = render(
      <WidgetStatusGrid
        cells={[makeCell({ icon: <svg data-testid="cell-icon" /> })]}
      />,
    );

    const icon = screen.getByTestId('cell-icon');
    expect(icon).toBeInTheDocument();
    // The icon lives inside an aria-hidden wrapper span.
    const wrapper = container.querySelector('span.shrink-0');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toContainElement(icon);
  });
});

describe('WidgetStatusGrid — status → style map', () => {
  const cases: Array<[StatusCell['status'], string, string]> = [
    ['ok', 'bg-emerald-500/10', 'bg-emerald-500'],
    ['warning', 'bg-amber-500/10', 'bg-amber-500'],
    ['error', 'bg-red-500/10', 'bg-red-500'],
    ['inactive', 'bg-white/[0.03]', 'bg-[var(--surface-2)]'],
    ['unknown', 'bg-white/[0.03]', 'bg-[var(--surface-2)]'],
  ];

  it.each(cases)('paints the %s status chip and dot with its palette', (status, chipBg, dotBg) => {
    const { container } = render(<WidgetStatusGrid cells={[makeCell({ status })]} />);

    const [cell] = getCellNodes(container);
    expect(cell.className).toContain(chipBg);
    expect(getDot(cell).className).toContain(dotBg);
  });
});

describe('WidgetStatusGrid — fail-closed status (hardened bug)', () => {
  it('does not throw and uses the neutral style for an out-of-union status', () => {
    // A backend string cast to the union (mirrors SystemHealth-style casts) used
    // to make statusStyles[status] === undefined, and `undefined.bg` threw.
    const rogue = makeCell({ label: 'Gateway', status: 'degraded' as StatusCell['status'] });

    let container!: HTMLElement;
    expect(() => {
      container = render(<WidgetStatusGrid cells={[rogue]} />).container;
    }).not.toThrow();

    const [cell] = getCellNodes(container);
    expect(cell.className).toContain('bg-white/[0.03]');
    expect(getDot(cell).className).toContain('bg-[var(--surface-2)]');
    // The label still renders — the widget degrades, it does not blank out.
    expect(screen.getByText('Gateway')).toBeInTheDocument();
  });
});

describe('WidgetStatusGrid — column layout', () => {
  it('uses the 2-up template by default', () => {
    const { container } = render(
      <WidgetStatusGrid cells={[makeCell({ id: 'a' }), makeCell({ id: 'b' })]} />,
    );
    expect(getGrid(container).className).toContain('grid-cols-2');
  });

  it('uses the container-query template for cols=3', () => {
    const { container } = render(
      <WidgetStatusGrid cells={[makeCell({ id: 'a' })]} cols={3} />,
    );
    const cls = getGrid(container).className;
    expect(cls).toContain('grid-cols-1');
    expect(cls).toContain('@xs:grid-cols-2');
    expect(cls).toContain('@sm:grid-cols-3');
  });

  it('uses the container-query template for cols=4', () => {
    const { container } = render(
      <WidgetStatusGrid cells={[makeCell({ id: 'a' })]} cols={4} />,
    );
    const cls = getGrid(container).className;
    expect(cls).toContain('grid-cols-2');
    expect(cls).toContain('@sm:grid-cols-4');
  });

  it('forces the 2-up baseline and tightens padding in compact mode, even with cols=4', () => {
    const { container } = render(
      <WidgetStatusGrid cells={[makeCell({ id: 'a' })]} cols={4} compact />,
    );
    const grid = getGrid(container);
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).not.toContain('@sm:grid-cols-4');
    // Compact chips get the tighter px-2 py-1.5 padding.
    const [cell] = getCellNodes(container);
    expect(cell.className).toContain('px-2');
    expect(cell.className).toContain('py-1.5');
  });
});

describe('WidgetStatusGrid — accessibility', () => {
  it('marks the colour-only status dot decorative (aria-hidden)', () => {
    const { container } = render(<WidgetStatusGrid cells={[makeCell()]} />);
    const [cell] = getCellNodes(container);
    expect(getDot(cell)).toHaveAttribute('aria-hidden', 'true');
  });

  it('conveys the status text (label + value) as real, readable content', () => {
    render(
      <WidgetStatusGrid
        cells={[makeCell({ label: 'Front Left', status: 'warning', value: '38 psi' })]}
      />,
    );
    // The status meaning is available to assistive tech via text, not colour alone.
    expect(screen.getByText('Front Left')).toBeInTheDocument();
    expect(screen.getByText('38 psi')).toBeInTheDocument();
  });
});
