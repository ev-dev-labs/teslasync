/**
 * `<GlassPanel>` primitive contract tests.
 *
 * GlassPanel is the glassmorphism surface used in 200+ call sites (cards,
 * sections, hero panels) and is frequently driven by runtime data
 * (`glow={HEALTH_GLOW[status]}`, `glow={active ? 'green' : 'none'}`,
 * `padding="none"`). These tests lock in:
 *   1. The semantic element (a native <div>), children pass-through, and the
 *      `data-print-card` hook the export/print pipeline selects on.
 *   2. The base surface + forced-colors (Windows High Contrast) classes are
 *      always present so a panel is never invisible.
 *   3. `glow` is gated behind `hover`: colour tokens only apply when hover is on,
 *      and each glow maps to its own hover-border/shadow token.
 *   4. Every `padding` scale maps to its token; `none`/omitted add no padding.
 *   5. Null-safety: an out-of-union `glow`/`padding` (which reaches the component
 *      at runtime from index lookups) degrades to the no-glow / no-padding tokens
 *      rather than leaking `undefined` into the class list.
 *   6. cn()/tailwind-merge conflict resolution, className merge, ref forwarding,
 *      arbitrary HTML/ARIA attribute + event handler pass-through, displayName.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { GlassPanel } from './GlassPanel';

const CYAN_GLOW = 'hover:border-cyan-400/30';
const GREEN_GLOW = 'hover:border-green-400/30';
const PURPLE_GLOW = 'hover:border-purple-400/30';

describe('GlassPanel — element + children', () => {
  it('renders a native <div> carrying its children', () => {
    render(<GlassPanel data-testid="panel">Panel body</GlassPanel>);
    const panel = screen.getByTestId('panel');
    expect(panel.tagName).toBe('DIV');
    expect(panel.textContent).toBe('Panel body');
  });

  it('renders complex nested children', () => {
    render(
      <GlassPanel data-testid="panel">
        <h2>Battery</h2>
        <span data-testid="value">73%</span>
      </GlassPanel>,
    );
    expect(screen.getByRole('heading', { name: 'Battery' })).toBeInTheDocument();
    expect(screen.getByTestId('value').textContent).toBe('73%');
  });

  it('exposes the data-print-card hook for the export/print pipeline', () => {
    const { container } = render(<GlassPanel>x</GlassPanel>);
    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel?.tagName).toBe('DIV');
  });
});

describe('GlassPanel — base surface + forced-colors', () => {
  it('always carries the glass surface base classes', () => {
    render(<GlassPanel data-testid="panel">x</GlassPanel>);
    const cls = screen.getByTestId('panel').className;
    expect(cls).toContain('bg-[var(--surface-2)]');
    expect(cls).toContain('backdrop-blur-sm');
    expect(cls).toContain('border-[var(--border-subtle)]');
    expect(cls).toContain('rounded-xl');
  });

  it('retains the forced-colors overrides for Windows High Contrast mode', () => {
    render(<GlassPanel data-testid="panel">x</GlassPanel>);
    const cls = screen.getByTestId('panel').className;
    // Under forced-colors the rgba border/bg collapse into Canvas — the system
    // colour overrides keep the surface perceivable for low-vision users.
    expect(cls).toContain('forced-colors:border-[CanvasText]');
    expect(cls).toContain('forced-colors:bg-[Canvas]');
  });
});

describe('GlassPanel — hover + glow gating', () => {
  it('adds no transition or glow by default (hover=false, glow=none)', () => {
    render(<GlassPanel data-testid="panel">x</GlassPanel>);
    const cls = screen.getByTestId('panel').className;
    expect(cls).not.toContain('transition-all');
    expect(cls).not.toContain(CYAN_GLOW);
    expect(cls).not.toContain(GREEN_GLOW);
    expect(cls).not.toContain(PURPLE_GLOW);
  });

  it('adds the transition affordance when hover is enabled', () => {
    render(
      <GlassPanel hover data-testid="panel">
        x
      </GlassPanel>,
    );
    expect(screen.getByTestId('panel').className).toContain('transition-all duration-normal');
  });

  it.each([
    ['cyan', CYAN_GLOW],
    ['green', GREEN_GLOW],
    ['purple', PURPLE_GLOW],
  ] as const)('applies the %s hover-border glow token when hover is on', (glow, expected) => {
    render(
      <GlassPanel hover glow={glow} data-testid="panel">
        x
      </GlassPanel>,
    );
    expect(screen.getByTestId('panel').className).toContain(expected);
  });

  it('suppresses the glow tokens when glow is set but hover is off', () => {
    // glow is a hover affordance — without `hover` the coloured hover-border
    // utility must NOT be emitted (branch: `hover && glowClasses[glow]`).
    render(
      <GlassPanel glow="cyan" data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).not.toContain(CYAN_GLOW);
    expect(cls).not.toContain('transition-all');
  });

  it('adds the transition but no coloured glow for glow="none" + hover', () => {
    render(
      <GlassPanel hover glow="none" data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).toContain('transition-all');
    expect(cls).not.toContain(CYAN_GLOW);
    expect(cls).not.toContain(GREEN_GLOW);
    expect(cls).not.toContain(PURPLE_GLOW);
  });

  it('degrades an out-of-union glow to no glow (null-safety, no undefined leak)', () => {
    // Data-driven call sites forward index lookups (`glow={HEALTH_GLOW[status]}`)
    // that can escape the compile-time union. The panel must fall back to the
    // no-glow tokens rather than injecting an `undefined` class.
    render(
      <GlassPanel hover glow={'amber' as never} data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).not.toContain('undefined');
    expect(cls).not.toContain(CYAN_GLOW);
    expect(cls).not.toContain(GREEN_GLOW);
    expect(cls).not.toContain(PURPLE_GLOW);
    // The hover transition still applies — only the colour degrades.
    expect(cls).toContain('transition-all');
  });
});

describe('GlassPanel — padding scale', () => {
  it.each([
    ['sm', 'p-3'],
    ['md', 'p-4'],
    ['lg', 'p-6'],
  ] as const)('maps padding="%s" to its token', (padding, expected) => {
    render(
      <GlassPanel padding={padding} data-testid="panel">
        x
      </GlassPanel>,
    );
    expect(screen.getByTestId('panel').className).toContain(expected);
  });

  it('maps padding="auto" to the density-aware utilities', () => {
    render(
      <GlassPanel padding="auto" data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).toContain('px-d-pad-x');
    expect(cls).toContain('py-d-pad-y');
  });

  it('adds no padding token for padding="none"', () => {
    render(
      <GlassPanel padding="none" data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).not.toContain('p-3');
    expect(cls).not.toContain('p-4');
    expect(cls).not.toContain('p-6');
    expect(cls).not.toContain('px-d-pad-x');
  });

  it('adds no padding token when padding is omitted', () => {
    render(<GlassPanel data-testid="panel">x</GlassPanel>);
    const cls = screen.getByTestId('panel').className;
    expect(cls).not.toContain('p-3');
    expect(cls).not.toContain('p-4');
    expect(cls).not.toContain('p-6');
    expect(cls).not.toContain('px-d-pad-x');
  });

  it('degrades an out-of-union padding to no padding (null-safety)', () => {
    render(
      <GlassPanel padding={'huge' as never} data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).not.toContain('undefined');
    expect(cls).not.toContain('p-3');
    expect(cls).not.toContain('px-d-pad-x');
  });
});

describe('GlassPanel — className merge + cn() conflict resolution', () => {
  it('merges a caller className alongside the base classes', () => {
    render(
      <GlassPanel className="my-custom-surface" data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).toContain('my-custom-surface');
    expect(cls).toContain('bg-[var(--surface-2)]');
  });

  it('lets a caller className win a Tailwind conflict via tailwind-merge', () => {
    // cn() runs twMerge, so a caller rounding utility replaces the base
    // `rounded-xl` instead of both surviving (last-wins conflict resolution).
    render(
      <GlassPanel className="rounded-lg" data-testid="panel">
        x
      </GlassPanel>,
    );
    const cls = screen.getByTestId('panel').className;
    expect(cls).toContain('rounded-lg');
    expect(cls).not.toContain('rounded-xl');
  });
});

describe('GlassPanel — ref + prop pass-through', () => {
  it('forwards refs to the underlying <div>', () => {
    const ref = createRef<HTMLDivElement>();
    render(<GlassPanel ref={ref}>Ref target</GlassPanel>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('DIV');
    expect(ref.current?.getAttribute('data-print-card')).not.toBeNull();
  });

  it('passes through arbitrary HTML and ARIA attributes', () => {
    render(
      <GlassPanel id="hero-panel" role="region" aria-label="Battery health" title="tip">
        content
      </GlassPanel>,
    );
    const panel = screen.getByRole('region', { name: 'Battery health' });
    expect(panel.id).toBe('hero-panel');
    expect(panel.getAttribute('title')).toBe('tip');
  });

  it('invokes forwarded event handlers', () => {
    const onClick = vi.fn();
    render(
      <GlassPanel onClick={onClick} data-testid="panel">
        Click me
      </GlassPanel>,
    );
    fireEvent.click(screen.getByTestId('panel'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes the expected displayName for devtools', () => {
    expect(GlassPanel.displayName).toBe('GlassPanel');
  });
});
