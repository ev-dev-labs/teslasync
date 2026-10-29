/**
 * WidgetFlowDiagram — behaviour, hardening & a11y contract.
 *
 * A purely presentational SVG following the After `flow` language in
 * the approved cockpit preview: rounded instruments with a stacked name
 * and measured reading, and curved S-links
 * between them. It has no data hooks and no interactive controls, so this
 * suite drives every branch of its render surface directly:
 *
 *   - the empty state (no nodes → an `EmptyState` with the default / custom
 *     message, role="status", and crucially NO `<svg>` — never a blank panel);
 *   - accessibility: the diagram is exposed as `role="img"` with a localisable
 *     accessible name (default + the `ariaLabel` override);
 *   - node rendering: one instrument per node, an optional icon, and the key
 *     hardening — the caption renders the caller-formatted `formattedValue`
 *     string (units like `%` / `kW` and the `—` placeholder) as its own
 *     element next to the standalone label, INSTEAD of the raw numeric
 *     `value` (which must never leak through);
 *   - null-safety: a missing `formattedValue` renders `—` (not `undefined`),
 *     a missing `label` renders the reading alone instead of throwing, and an
 *     explicitly blank reading stays blank;
 *   - compact mode: the name collapses to a 3-char uppercase code while the
 *     reading keeps its units, and only the three largest-magnitude arrows
 *     survive;
 *   - arrow semantics: a link animates (the `flow-active` class + a `9 23` dash)
 *     only when it is both `active` and non-zero; idle links are thin neutral
 *     lines with neither. Colour defaults are status-neutral (spec rule 4 —
 *     never sign-derived red/green) unless an explicit override is supplied.
 *     Endpoints missing from the node set are skipped. An optional
 *     caller-formatted `label` is annotated once at the link midpoint.
 *
 * The component pulls in no network, no QueryClient and no Router (the empty
 * state passes no action), so a bare `render()` is sufficient — matching the
 * lightweight presentational-component convention in this folder.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetFlowDiagram, type FlowNode, type FlowArrow } from './WidgetFlowDiagram';

const EM_DASH = '\u2014';

function node(over: Partial<FlowNode> = {}): FlowNode {
  return {
    id: 'battery',
    label: 'Battery',
    value: 0,
    formattedValue: '0%',
    position: 'left',
    ...over,
  };
}

function arrow(over: Partial<FlowArrow> = {}): FlowArrow {
  return { from: 'a', to: 'b', value: 1, active: false, ...over };
}

function paths(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('[data-flow-edge]'));
}

function classOf(el: Element | null): string {
  return el?.getAttribute('class') ?? '';
}

// ── Empty state ──────────────────────────────────────────────────────────────

describe('WidgetFlowDiagram empty state', () => {
  it('renders the default empty message as a status region and NO svg when there are no nodes', () => {
    const { container } = render(<WidgetFlowDiagram nodes={[]} arrows={[]} />);

    expect(screen.getByText('No flow data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Never a blank panel, but also never a phantom (empty) diagram.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('uses a caller-supplied emptyMessage instead of the default', () => {
    render(<WidgetFlowDiagram nodes={[]} arrows={[]} emptyMessage="Nothing flowing" />);

    expect(screen.getByText('Nothing flowing')).toBeInTheDocument();
    expect(screen.queryByText('No flow data available')).toBeNull();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('WidgetFlowDiagram accessibility', () => {
  it('exposes the diagram as an image with the default accessible name', () => {
    render(<WidgetFlowDiagram nodes={[node()]} arrows={[]} />);

    const img = screen.getByRole('img');
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img).toHaveAccessibleName('Energy flow diagram');
  });

  it('honours a localisable ariaLabel override', () => {
    render(<WidgetFlowDiagram nodes={[node()]} arrows={[]} ariaLabel="Power routing" />);

    expect(screen.getByRole('img')).toHaveAccessibleName('Power routing');
    expect(screen.queryByRole('img', { name: 'Energy flow diagram' })).toBeNull();
  });
});

// ── Nodes ────────────────────────────────────────────────────────────────────

describe('WidgetFlowDiagram nodes', () => {
  it('renders exactly one instrument per node', () => {
    const nodes = [
      node({ id: 'battery', position: 'left' }),
      node({ id: 'motor', position: 'right' }),
      node({ id: 'charger', position: 'top' }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(container.querySelectorAll('[data-flow-node]')).toHaveLength(3);
  });

  it('renders the label and formattedValue as separate caption elements (units preserved, raw value hidden)', () => {
    const nodes = [
      node({ id: 'battery', position: 'left', value: 82, formattedValue: '82%' }),
      node({ id: 'motor', label: 'Motor', position: 'right', value: 999, formattedValue: '12.5 kW' }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    // Standalone elements: callers and assistive tech can address each alone.
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('Motor')).toBeInTheDocument();
    expect(screen.getByText('12.5 kW')).toBeInTheDocument();
    // Regression guard: the raw number must never leak through.
    expect(container).not.toHaveTextContent('999');
  });

  it('falls back to an em dash when formattedValue is missing (never "undefined")', () => {
    const nodes = [
      node({ id: 'idle', formattedValue: undefined as unknown as string }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(container).toHaveTextContent(EM_DASH);
    expect(container).not.toHaveTextContent('undefined');
  });

  it('keeps an explicitly blank reading blank (no em dash injected)', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={[node({ label: 'Site', formattedValue: '' })]} arrows={[]} />,
    );

    expect(container).toHaveTextContent('Site');
    expect(container).not.toHaveTextContent(EM_DASH);
  });

  it('renders a provided node icon', () => {
    const nodes = [
      node({ id: 'battery', icon: <span data-testid="node-icon">B</span> }),
    ];
    render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(screen.getByTestId('node-icon')).toBeInTheDocument();
  });

  it('is null-safe when a node label is missing (renders the reading without throwing)', () => {
    const nodes = [
      node({ id: 'nolabel', label: undefined as unknown as string, formattedValue: '5 kW' }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(container.querySelectorAll('[data-flow-node]')).toHaveLength(1);
    expect(container).toHaveTextContent('5 kW');
    expect(container).not.toHaveTextContent('undefined');
  });

  it('renders the full label when not compact', () => {
    render(<WidgetFlowDiagram nodes={[node({ label: 'Battery' })]} arrows={[]} />);

    expect(screen.getByText('Battery')).toBeInTheDocument();
  });
});

// ── Compact mode ─────────────────────────────────────────────────────────────

describe('WidgetFlowDiagram compact mode', () => {
  it('truncates a long name to a 3-char uppercase code but keeps the reading', () => {
    render(<WidgetFlowDiagram nodes={[node({ label: 'Battery', formattedValue: '82%' })]} arrows={[]} compact />);

    expect(screen.getByText('BAT')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.queryByText('Battery')).toBeNull();
  });

  it('leaves short labels (<= 3 chars) untouched', () => {
    render(<WidgetFlowDiagram nodes={[node({ label: 'Hi', formattedValue: '1 kW' })]} arrows={[]} compact />);

    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('limits the diagram to the three largest-magnitude arrows', () => {
    const nodes: FlowNode[] = [
      node({ id: 'c', position: 'center' }),
      node({ id: 't', position: 'top' }),
      node({ id: 'b', position: 'bottom' }),
      node({ id: 'l', position: 'left' }),
      node({ id: 'r', position: 'right' }),
    ];
    const arrows: FlowArrow[] = [
      arrow({ from: 'c', to: 't', value: 50, active: true }),
      arrow({ from: 'c', to: 'b', value: 40, active: true }),
      arrow({ from: 'c', to: 'l', value: 30, active: true }),
      arrow({ from: 'c', to: 'r', value: 20, active: true }),
      arrow({ from: 't', to: 'b', value: 10, active: true }),
    ];

    const compact = render(<WidgetFlowDiagram nodes={nodes} arrows={arrows} compact />);
    expect(paths(compact.container)).toHaveLength(3);

    // Same data, standard mode → every arrow is drawn.
    const full = render(<WidgetFlowDiagram nodes={nodes} arrows={arrows} />);
    expect(paths(full.container)).toHaveLength(5);
  });
});

// ── Arrows ───────────────────────────────────────────────────────────────────

describe('WidgetFlowDiagram arrows', () => {
  const ab: FlowNode[] = [node({ id: 'a', position: 'left' }), node({ id: 'b', position: 'right' })];

  it('animates flowing arrows (active + non-zero) with the flow-active class and a dash pattern', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 5, active: true })]} />,
    );

    const path = container.querySelector('[data-flow-edge]');
    expect(classOf(path)).toContain('flow-active');
    expect(path?.getAttribute('stroke-dasharray')).toBe('9 23');
    expect(path?.getAttribute('stroke-width')).toBe('2.5');
  });

  it('leaves idle arrows static (no animation class, no dash pattern, thin neutral line)', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 5, active: false })]} />,
    );

    const path = container.querySelector('path');
    expect(classOf(path)).not.toContain('flow-active');
    expect(path?.getAttribute('stroke-dasharray')).toBeNull();
    expect(path?.getAttribute('stroke-width')).toBe('1.5');
  });

  it('does not animate an active arrow with zero flow (honest idle)', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 0, active: true })]} />,
    );

    const path = container.querySelector('path');
    expect(classOf(path)).not.toContain('flow-active');
    expect(path?.getAttribute('stroke-dasharray')).toBeNull();
    expect(path?.getAttribute('stroke-width')).toBe('1.5');
  });

  it.each([NaN, Infinity, -Infinity])('does not animate a non-finite reading (%s)', (value) => {
    const { container } = render(<WidgetFlowDiagram nodes={ab} arrows={[arrow({ value, active: true })]} />);
    expect(container.querySelector('.flow-active')).toBeNull();
    expect(paths(container)[0]).not.toHaveAttribute('stroke-dasharray');
  });

  it('skips arrows whose endpoints are not present in the node set', () => {
    const { container } = render(
      <WidgetFlowDiagram
        nodes={ab}
        arrows={[
          arrow({ from: 'a', to: 'b', value: 5, active: true }),
          arrow({ from: 'a', to: 'ghost', value: 9, active: true }),
        ]}
      />,
    );

    expect(paths(container)).toHaveLength(1);
  });

  it('uses status-neutral defaults for both flowing and idle links (never sign-derived red/green)', () => {
    const nodes: FlowNode[] = [
      node({ id: 'a', position: 'left' }),
      node({ id: 'b', position: 'right' }),
      node({ id: 'c', position: 'top' }),
    ];
    const { container } = render(
      <WidgetFlowDiagram
        nodes={nodes}
        arrows={[
          arrow({ from: 'a', to: 'b', value: 5, active: true }),
          arrow({ from: 'b', to: 'c', value: -5, active: true }),
          arrow({ from: 'c', to: 'a', value: 0, active: false }),
        ]}
      />,
    );

    const [pos, neg, zero] = paths(container);
    // Flowing links share one restrained accent default regardless of sign.
    expect(classOf(pos)).toContain('text-[var(--semantic-info)]');
    expect(classOf(neg)).toContain('text-[var(--semantic-info)]');
    expect(classOf(pos)).not.toContain('text-emerald-400');
    expect(classOf(neg)).not.toContain('text-red-400');
    // Idle links are neutral.
    expect(classOf(zero)).toContain('text-[var(--border-default)]');
  });

  it('prefers an explicit arrow colour override over the default', () => {
    const { container } = render(
      <WidgetFlowDiagram
        nodes={ab}
        arrows={[arrow({ from: 'a', to: 'b', value: 5, active: true, color: 'text-amber-400' })]}
      />,
    );

    const path = container.querySelector('[data-flow-edge]');
    expect(classOf(path)).toContain('text-amber-400');
    expect(classOf(path)).not.toContain('text-[var(--semantic-info)]');
  });

  it('annotates a flowing link with its caller-formatted label at the midpoint', () => {
    const { container } = render(
      <WidgetFlowDiagram
        nodes={ab}
        arrows={[arrow({ from: 'a', to: 'b', value: 4.2, active: true, label: '4.2 kW' })]}
      />,
    );

    expect(container).toHaveTextContent('4.2 kW');
  });

  it('renders no link annotation when the caller supplies no label', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 4.2, active: true })]} />,
    );

    expect(screen.getAllByText('Battery')).toHaveLength(2);
    expect(screen.getAllByText('0%')).toHaveLength(2);
    expect(container.querySelectorAll('text')).toHaveLength(0);
  });
});
