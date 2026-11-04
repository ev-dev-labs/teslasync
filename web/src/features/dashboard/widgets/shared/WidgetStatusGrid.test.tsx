/**
 * WidgetStatusGrid — the shared "grid of labelled status chips" primitive used by
 * the dashboard status widgets (Safety, Security, BatteryCells, DoorWindow…).
 *
 * Behaviour surface under test:
 *   1. Empty branch — an empty `cells` array (and, as a hardened regression, a
 *      runtime-`undefined` array that the `data?.field` call-sites can produce)
 *      renders the shared EmptyState with the resolved message + icon instead of
 *      an empty grid or a "Cannot read properties of undefined" crash.
 *   2. Cell rendering — one bordered box per cell (After `.sgi`), the label
 *      always shows, the value shows only when present (as semibold truncated
 *      text with a `title` for clipped content), the status word always shows,
 *      and a supplied icon is rendered.
 *   3. Status → style map — each of the five known statuses paints its status-dot
 *      colour; the box itself stays neutral (border + transparent surface, never
 *      a status-tinted fill).
 *   4. Fail-closed status — a status outside the union (a raw backend string cast
 *      to StatusCell['status']) must NOT dereference `undefined`; it falls back to
 *      the neutral "unknown" styling and still renders the label. This is the
 *      hardened bug: `statusStyles[cell.status]` used to return `undefined` and
 *      the next `.bg` access threw, taking the whole widget (and its dashboard
 *      row) down.
 *   5. Column layout — `cols` selects the container-query grid template, `compact`
 *      forces the 2-up baseline and tightens box padding.
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
  it('renders exactly one box per cell with its label, value and status word', () => {
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
    // The status meaning is text, not colour alone: value cells without a
    // caller statusLabel still carry the generic word (SecurityStatus locks on
    // this via its own suite).
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders the value as semibold truncated text with its full text as title', () => {
    render(<WidgetStatusGrid cells={[makeCell({ label: 'Lock', value: 'Locked' })]} />);

    const value = screen.getByText('Locked');
    expect(value.tagName).toBe('P');
    expect(value.className).toContain('font-semibold');
    expect(value.className).toContain('truncate');
    expect(value).toHaveAttribute('title', 'Locked');
  });

  it('preserves the value and status meaning in compact mode', () => {
    render(<WidgetStatusGrid cells={[makeCell({ label: 'Lock', value: 'Locked' })]} compact />);

    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
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
    render(
      <WidgetStatusGrid
        cells={[makeCell({ icon: <svg data-testid="cell-icon" /> })]}
      />,
    );

    const icon = screen.getByTestId('cell-icon');
    expect(icon).toBeInTheDocument();
    // The icon lives inside an aria-hidden wrapper span.
    const wrapper = icon.closest('span');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toContainElement(icon);
  });
});

describe('WidgetStatusGrid — unframed status readings', () => {
  const cases: Array<[StatusCell['status'], string]> = [
    ['ok', 'bg-[var(--semantic-success)]'],
    ['warning', 'bg-[var(--semantic-warning)]'],
    ['error', 'bg-[var(--semantic-danger)]'],
    ['inactive', 'bg-[var(--text-muted)]'],
    ['unknown', 'bg-[var(--text-muted)]'],
  ];

  it.each(cases)('keeps the %s status dot and text without nested card chrome', (status, dotBg) => {
    const { container } = render(<WidgetStatusGrid cells={[makeCell({ status })]} />);

    const [cell] = getCellNodes(container);
    expect(getDot(cell).className).toContain(dotBg);
    expect(cell).toHaveClass('widget-status-tile', 'py-2');
    expect(cell).not.toHaveClass('border', 'rounded-shape-lg', 'px-2.5');
    expect(cell.className).not.toContain('bg-[var(--semantic');
    expect(cell).toHaveTextContent(status === 'ok' ? 'Healthy' : status === 'warning' ? 'Warning' : status === 'error' ? 'Error' : status === 'inactive' ? 'Inactive' : 'Unknown');
  });

  it('keeps the 8px grid gap between readings', () => {
    const { container } = render(<WidgetStatusGrid cells={[makeCell({ id: 'a' })]} />);
    expect(getGrid(container).className).toContain('gap-2');
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
    expect(cell.className).not.toContain('bg-');
    expect(getDot(cell).className).toContain('bg-[var(--text-muted)]');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
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
    const [cell] = getCellNodes(container);
    expect(cell.className).toContain('py-1.5');
    expect(cell).not.toHaveClass('border', 'rounded-shape-lg', 'px-2.5');
  });
});

describe('WidgetStatusGrid — accessibility', () => {
  it('shows a text status independent of color, including compact and missing-value cells', () => {
    render(<WidgetStatusGrid cells={[makeCell({ status: 'warning' })]} compact />);
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('preserves caller-localized domain status without a runtime casing transform', () => {
    render(<WidgetStatusGrid cells={[makeCell({ status: 'ok', statusLabel: 'MQTT connected' })]} />);
    expect(screen.getByText('MQTT connected')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

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
