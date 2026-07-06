/**
 * WidgetFlowDiagram — behaviour, hardening & a11y contract.
 *
 * A purely presentational SVG that renders `FlowNode`s at five fixed positions
 * and `FlowArrow`s between them. It has no data hooks and no interactive
 * controls, so this suite drives every branch of its render surface directly:
 *
 *   - the empty state (no nodes → an `EmptyState` with the default / custom
 *     message, role="status", and crucially NO `<svg>` — never a blank panel);
 *   - accessibility: the diagram is exposed as `role="img"` with a localisable
 *     accessible name (default + the new `ariaLabel` override);
 *   - node rendering: one circle per node, an optional icon, the label, and —
 *     the key hardening — the node's caller-formatted `formattedValue` string
 *     (units like `%` / `kW` and the `—` placeholder) INSTEAD of the raw numeric
 *     `value`. The previous implementation piped `value` through `<AnimatedNumber>`
 *     and silently dropped every unit; the sibling `WidgetRankedList` already
 *     renders `formattedValue`, so this aligns the two and restores the units the
 *     callers (EnergyFlowWidget / LivePowerFlowWidget / EnergyFlowAnimatedWidget)
 *     go to the trouble of computing;
 *   - null-safety: a missing `formattedValue` renders `—` (not `undefined`), and
 *     a missing `label` renders empty instead of throwing on `.length`;
 *   - compact mode: labels collapse to a 3-char uppercase code (short labels are
 *     left alone) and only the three largest-magnitude arrows survive;
 *   - arrow semantics: active arrows carry the `flow-active` animation class + a
 *     dash pattern (inactive ones carry neither), colour is derived from the sign
 *     of the value unless an explicit override is supplied, endpoints missing
 *     from the node set are skipped, and stroke width scales with magnitude.
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

function lines(container: HTMLElement): SVGLineElement[] {
  return Array.from(container.querySelectorAll('line'));
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
  it('renders exactly one circle per node', () => {
    const nodes = [
      node({ id: 'battery', position: 'left' }),
      node({ id: 'motor', position: 'right' }),
      node({ id: 'charger', position: 'top' }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });

  it('displays each node formattedValue (units preserved) and not the raw numeric value', () => {
    const nodes = [
      node({ id: 'battery', position: 'left', value: 82, formattedValue: '82%' }),
      node({ id: 'motor', position: 'right', value: 999, formattedValue: '12.5 kW' }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(container).toHaveTextContent('82%');
    expect(container).toHaveTextContent('12.5 kW');
    // Regression guard: the old build rendered `value` via <AnimatedNumber> (→ "82.0")
    // and dropped the unit — the raw number must never leak through.
    expect(container).not.toHaveTextContent('82.0');
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

  it('renders a provided node icon', () => {
    const nodes = [
      node({ id: 'battery', icon: <span data-testid="node-icon">B</span> }),
    ];
    render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    expect(screen.getByTestId('node-icon')).toBeInTheDocument();
  });

  it('is null-safe when a node label is missing (renders without throwing)', () => {
    const nodes = [
      node({ id: 'nolabel', label: undefined as unknown as string, formattedValue: '5 kW' }),
    ];
    const { container } = render(<WidgetFlowDiagram nodes={nodes} arrows={[]} />);

    // The node still renders (circle + value) and no "undefined" text leaks in.
    expect(container.querySelectorAll('circle')).toHaveLength(1);
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
  it('truncates long labels to a 3-char uppercase code', () => {
    render(<WidgetFlowDiagram nodes={[node({ label: 'Battery' })]} arrows={[]} compact />);

    expect(screen.getByText('BAT')).toBeInTheDocument();
    expect(screen.queryByText('Battery')).toBeNull();
  });

  it('leaves short labels (<= 3 chars) untouched', () => {
    render(<WidgetFlowDiagram nodes={[node({ label: 'Hi' })]} arrows={[]} compact />);

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
      arrow({ from: 'c', to: 't', value: 50 }),
      arrow({ from: 'c', to: 'b', value: 40 }),
      arrow({ from: 'c', to: 'l', value: 30 }),
      arrow({ from: 'c', to: 'r', value: 20 }),
      arrow({ from: 't', to: 'b', value: 10 }),
    ];

    const compact = render(<WidgetFlowDiagram nodes={nodes} arrows={arrows} compact />);
    expect(lines(compact.container)).toHaveLength(3);

    // Same data, standard mode → every arrow is drawn.
    const full = render(<WidgetFlowDiagram nodes={nodes} arrows={arrows} />);
    expect(lines(full.container)).toHaveLength(5);
  });
});

// ── Arrows ───────────────────────────────────────────────────────────────────

describe('WidgetFlowDiagram arrows', () => {
  const ab: FlowNode[] = [node({ id: 'a', position: 'left' }), node({ id: 'b', position: 'right' })];

  it('marks active arrows with the flow-active animation class and a dash pattern', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 5, active: true })]} />,
    );

    const line = container.querySelector('line');
    expect(classOf(line)).toContain('flow-active');
    expect(line?.getAttribute('stroke-dasharray')).toBe('4 8');
  });

  it('leaves inactive arrows static (no animation class, no dash pattern)', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 5, active: false })]} />,
    );

    const line = container.querySelector('line');
    expect(classOf(line)).not.toContain('flow-active');
    expect(line?.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('skips arrows whose endpoints are not present in the node set', () => {
    const { container } = render(
      <WidgetFlowDiagram
        nodes={ab}
        arrows={[
          arrow({ from: 'a', to: 'b', value: 5 }),
          arrow({ from: 'a', to: 'ghost', value: 9 }),
        ]}
      />,
    );

    expect(lines(container)).toHaveLength(1);
  });

  it('colours arrows by the sign of their value', () => {
    const nodes: FlowNode[] = [
      node({ id: 'a', position: 'left' }),
      node({ id: 'b', position: 'right' }),
      node({ id: 'c', position: 'top' }),
    ];
    const { container } = render(
      <WidgetFlowDiagram
        nodes={nodes}
        arrows={[
          arrow({ from: 'a', to: 'b', value: 5 }), // positive → emerald
          arrow({ from: 'b', to: 'c', value: -5 }), // negative → red
          arrow({ from: 'c', to: 'a', value: 0 }), // zero → muted var
        ]}
      />,
    );

    const [pos, neg, zero] = lines(container);
    expect(classOf(pos)).toContain('text-emerald-400');
    expect(classOf(neg)).toContain('text-red-400');
    expect(classOf(zero)).toContain('text-[var(--text-muted)]');
  });

  it('prefers an explicit arrow colour override over the sign-derived colour', () => {
    const { container } = render(
      <WidgetFlowDiagram
        nodes={ab}
        arrows={[arrow({ from: 'a', to: 'b', value: 5, color: 'text-amber-400' })]}
      />,
    );

    const line = container.querySelector('line');
    expect(classOf(line)).toContain('text-amber-400');
    expect(classOf(line)).not.toContain('text-emerald-400');
  });

  it('scales stroke width with the arrow magnitude (relative to the max)', () => {
    const nodes: FlowNode[] = [
      node({ id: 'a', position: 'center' }),
      node({ id: 'b', position: 'top' }),
      node({ id: 'c', position: 'bottom' }),
    ];
    const { container } = render(
      <WidgetFlowDiagram
        nodes={nodes}
        arrows={[
          arrow({ from: 'a', to: 'b', value: 10 }), // max → widest (4)
          arrow({ from: 'a', to: 'c', value: 5 }), // half → 2.5
        ]}
      />,
    );

    const [widest, half] = lines(container);
    expect(widest.getAttribute('stroke-width')).toBe('4');
    expect(half.getAttribute('stroke-width')).toBe('2.5');
  });

  it('floors stroke width at the minimum for a lone zero-value arrow', () => {
    const { container } = render(
      <WidgetFlowDiagram nodes={ab} arrows={[arrow({ from: 'a', to: 'b', value: 0 })]} />,
    );

    const line = container.querySelector('line');
    expect(line?.getAttribute('stroke-width')).toBe('1');
    expect(classOf(line)).toContain('text-[var(--text-muted)]');
  });
});
