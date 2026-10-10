/**
 * `<Tooltip>` contract tests.
 *
 * Tooltip is the shared hover/focus tooltip behind every icon-only control,
 * metric title, and help affordance in the app. Feature code leans on a small
 * but load-bearing contract, so these tests lock it in:
 *
 *   1. It wraps its trigger in a `role="tooltip"` bubble and, when the trigger
 *      is a SINGLE React element, wires the bubble's id into that element's
 *      `aria-describedby` (preserving any pre-existing value) so screen readers
 *      announce the tooltip after the trigger's own name.
 *   2. It degrades gracefully for the two non-element cases — a bare string
 *      child and multiple children — WITHOUT crashing. (Regression guard: the
 *      previous `Children.only` implementation threw on a lone string child
 *      because `Children.count('x') === 1` but a string is not a valid element.)
 *   3. `side` selects the placement class group; `multiline` toggles wrapping.
 *   4. The dev-only sentry warns (once per callsite+class) when `content`
 *      hardcodes a body-text colour that collides with the inverted surface,
 *      and stays silent for decorative shades / plain string content.
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` from `@testing-library/react` — matching every
 * other component test here (SelectableCard, FullscreenButton, Slider, ...).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Tooltip, type TooltipProps } from './Tooltip';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The dev-time sentry logs via console.warn. Silence + capture it so the
  // suite stays quiet and we can assert on call counts / messages. The
  // `import.meta.env.PROD` guard inside the component is `false` under vitest,
  // so the warn path is live here (exactly what we want to exercise).
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  cleanup();
});

describe('Tooltip — structure & content', () => {
  it('renders the trigger children and the content inside a role="tooltip" bubble', () => {
    render(
      <Tooltip content="Battery health">
        <button>Info</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Battery health');
  });

  it('renders JSX content, not just strings', () => {
    render(
      <Tooltip content={<em data-testid="rich">rich body</em>}>
        <button>Info</button>
      </Tooltip>,
    );
    expect(screen.getByTestId('rich')).toHaveTextContent('rich body');
    // The rich node lives inside the tooltip bubble.
    expect(screen.getByRole('tooltip')).toContainElement(screen.getByTestId('rich'));
  });
});

describe('Tooltip — aria-describedby wiring (single element child)', () => {
  it('adds the bubble id to a single element child so it is described by the tip', () => {
    render(
      <Tooltip content="Explains the metric">
        <button>Trigger</button>
      </Tooltip>,
    );
    const tip = screen.getByRole('tooltip');
    const btn = screen.getByRole('button', { name: 'Trigger' });
    expect(tip.id).toBeTruthy();
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
  });

  it('preserves an existing aria-describedby, appending the bubble id space-separated', () => {
    render(
      <Tooltip content="Extra context">
        <button aria-describedby="existing-hint">Trigger</button>
      </Tooltip>,
    );
    const tip = screen.getByRole('tooltip');
    const btn = screen.getByRole('button', { name: 'Trigger' });
    // Existing token must come first, the tooltip id appended after a space.
    expect(btn.getAttribute('aria-describedby')).toBe(`existing-hint ${tip.id}`);
  });
});

describe('Tooltip — non-element children degrade gracefully (no crash)', () => {
  it('does NOT crash when the sole child is a plain string (regression: Children.only threw)', () => {
    // `Children.count('Just text') === 1` but a string is not a valid element,
    // so the previous `Children.only` call threw
    // "React.Children.only expected to receive a single React element child.".
    expect(() =>
      render(<Tooltip content="Tip body">Just text</Tooltip>),
    ).not.toThrow();
    expect(screen.getByText('Just text')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tip body');
  });

  it('does not attempt to attach aria-describedby to a bare string child', () => {
    render(<Tooltip content="Tip body">plain trigger</Tooltip>);
    // There is no element to carry aria-describedby — but the bubble still
    // exists with role="tooltip" so the semantic anchor is present.
    const tip = screen.getByRole('tooltip');
    expect(tip).toBeInTheDocument();
    expect(tip).toHaveAttribute('role', 'tooltip');
  });

  it('does not crash and does not wire describedby when given multiple element children', () => {
    render(
      <Tooltip content="Tip body">
        <button>A</button>
        <button>B</button>
      </Tooltip>,
    );
    const [a, b] = screen.getAllByRole('button');
    // Fallback path — neither trigger is enriched with aria-describedby.
    expect(a).not.toHaveAttribute('aria-describedby');
    expect(b).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('Tooltip — placement (side)', () => {
  it('defaults to the "top" placement class group', () => {
    render(
      <Tooltip content="Tip">
        <button>T</button>
      </Tooltip>,
    );
    // top → bubble sits above the trigger (bottom-full).
    expect(screen.getByRole('tooltip').className).toContain('bottom-full');
  });

  it('applies the matching class group for each explicit side', () => {
    const cases: Array<[NonNullable<TooltipProps['side']>, string]> = [
      ['bottom', 'top-full'],
      ['left', 'right-full'],
      ['right', 'left-full'],
    ];
    for (const [side, expected] of cases) {
      const { unmount } = render(
        <Tooltip content="Tip" side={side}>
          <button>T</button>
        </Tooltip>,
      );
      expect(screen.getByRole('tooltip').className).toContain(expected);
      unmount();
    }
  });
});

describe('Tooltip — multiline', () => {
  it('repositions an unopened tooltip when its initially hidden layout becomes measurable', () => {
    let measuredWidth = 0;
    let notifyResize: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
    });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => measuredWidth);
    const viewport = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 40, 36, 36));
    const { unmount } = render(<Tooltip content="Help" multiline><button>Info</button></Tooltip>);
    try {
      const tip = screen.getByRole('tooltip');
      expect(tip.style.translate).toBe('');
      measuredWidth = 320;
      act(() => notifyResize());
      expect(tip.style.translate).toBe('-140px 0');
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      unmount();
      width.mockRestore();
      viewport.mockRestore();
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('forces a single line (whitespace-nowrap) by default', () => {
    render(
      <Tooltip content="Short tip">
        <button>T</button>
      </Tooltip>,
    );
    const cls = screen.getByRole('tooltip').className;
    expect(cls).toContain('whitespace-nowrap');
    expect(cls).not.toContain('whitespace-normal');
  });

  it('uses a readable width bounded by the viewport when multiline is set', () => {
    render(
      <Tooltip content="A much longer help body that should wrap" multiline>
        <button>T</button>
      </Tooltip>,
    );
    const cls = screen.getByRole('tooltip').className;
    expect(cls).toContain('whitespace-normal');
    expect(cls).toContain('w-80');
    expect(cls).toContain('max-w-tooltip-viewport');
    expect(cls).toContain('leading-relaxed');
    expect(cls).toContain('transition-opacity');
    expect(cls).not.toContain('transition-all');
  });

  it.each(['hover', 'focus'])('keeps a wide tooltip inside the viewport on %s', (interaction) => {
    render(
      <Tooltip content="Long help text" side="bottom" multiline>
        <button>Info</button>
      </Tooltip>,
    );
    const tip = screen.getByRole('tooltip');
    const trigger = screen.getByRole('button', { name: 'Info' });
    const wrapper = trigger.parentElement!;
    const width = vi.spyOn(tip, 'offsetWidth', 'get').mockReturnValue(320);
    const viewport = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    const bounds = vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(340, 40, 36, 36),
    );
    try {
      if (interaction === 'hover') fireEvent.mouseEnter(wrapper);
      else fireEvent.focus(trigger);
      expect(tip.style.translate).toBe('-140px 0');
    } finally {
      width.mockRestore();
      viewport.mockRestore();
      bounds.mockRestore();
    }
  });

  it('positions an unopened tooltip on mount and updates its bounds after resizing', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
    const viewport = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(340, 40, 36, 36),
    );
    try {
      const { unmount } = render(
        <Tooltip content="Long help text" side="bottom" multiline>
          <button>Info</button>
        </Tooltip>,
      );
      const tip = screen.getByRole('tooltip');
      expect(tip.style.translate).toBe('-140px 0');

      width.mockReturnValue(296);
      viewport.mockReturnValue(320);
      bounds.mockReturnValue(new DOMRect(270, 40, 36, 36));
      fireEvent(window, new Event('resize'));
      expect(tip.style.translate).toBe('-128px 0');

      unmount();
      const callsAfterUnmount = bounds.mock.calls.length;
      fireEvent(window, new Event('resize'));
      expect(bounds.mock.calls).toHaveLength(callsAfterUnmount);
    } finally {
      width.mockRestore();
      viewport.mockRestore();
      bounds.mockRestore();
    }
  });
});

describe('Tooltip — dev-time forbidden-text-colour sentry', () => {
  it('warns once when content hardcodes a colliding body-text colour', () => {
    render(
      <Tooltip content={<span className="text-white">bad body text</span>}>
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('text-white');
  });

  it('includes the offending class and a caller hint in the warning message', () => {
    render(
      <Tooltip content={<span className="text-gray-100">bad</span>}>
        <button>T</button>
      </Tooltip>,
    );
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('text-gray-100');
    expect(msg).toContain('tooltip:');
  });

  it('detects a forbidden class on a deeply nested descendant', () => {
    render(
      <Tooltip
        content={
          <div>
            <section>
              <p className="text-gray-200">deep body</p>
            </section>
          </div>
        }
      >
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('text-gray-200');
  });

  it('detects a forbidden class among array-form content children', () => {
    render(
      <Tooltip
        content={[
          <span key="a">ok</span>,
          <span key="b" className="text-gray-300">
            bad
          </span>,
        ]}
      >
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('text-gray-300');
  });

  it('flags the opacity-suffixed variant (text-white/NN)', () => {
    render(
      <Tooltip content={<span className="text-white/70">bad</span>}>
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('text-white/70');
  });

  it('de-duplicates repeat warnings for the same callsite + class across re-renders', () => {
    const { rerender } = render(
      <Tooltip content={<span className="text-gray-400">first</span>}>
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // New content reference, same offending class → same fingerprint → suppressed.
    rerender(
      <Tooltip content={<span className="text-gray-400">second</span>}>
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a decorative semantic colour (text-amber-300)', () => {
    render(
      <Tooltip content={<span className="text-amber-300">severity</span>}>
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent for plain string content', () => {
    render(
      <Tooltip content="just a plain string">
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent when content carries no colour class at all', () => {
    render(
      <Tooltip content={<span className="font-medium">neutral</span>}>
        <button>T</button>
      </Tooltip>,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('Tooltip — typed props surface', () => {
  it('accepts a fully-typed TooltipProps object', () => {
    const props: TooltipProps = {
      content: 'Typed tip',
      side: 'right',
      multiline: true,
      children: <button>Typed</button>,
    };
    render(<Tooltip {...props} />);
    expect(screen.getByRole('button', { name: 'Typed' })).toBeInTheDocument();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Typed tip');
    expect(tip.className).toContain('whitespace-normal');
  });

  describe('Tooltip — restrained motion and dismissal', () => {
    it('dismisses focused help with Escape without replacing the trigger or its descriptions', () => {
      const { rerender } = render(
        <Tooltip content="Complete help"><button aria-describedby="external-hint">Info</button></Tooltip>,
      );
      const trigger = screen.getByRole('button', { name: 'Info' });
      const tip = screen.getByRole('tooltip');
      act(() => trigger.focus());
      expect(document.activeElement).toBe(trigger);
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(tip).toHaveClass('!opacity-0');
      expect(trigger).toHaveAttribute('aria-describedby', `external-hint ${tip.id}`);
      rerender(
        <Tooltip content="Translated complete help"><button aria-describedby="external-hint">Information</button></Tooltip>,
      );
      expect(screen.getByRole('button', { name: 'Information' })).toBe(trigger);
      expect(document.activeElement).toBe(trigger);
      expect(screen.getByRole('tooltip')).toBe(tip);
      expect(tip).toHaveTextContent('Translated complete help');
      fireEvent.blur(trigger);
      fireEvent.focus(trigger);
      expect(tip).not.toHaveClass('!opacity-0');
    });

    it('dismisses hovered help on Escape and allows a new hover to reveal it', () => {
      render(<Tooltip content="Hover help"><button>Info</button></Tooltip>);
      const wrapper = screen.getByRole('button').parentElement!;
      const tip = screen.getByRole('tooltip');
      fireEvent.mouseEnter(wrapper);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(tip).toHaveClass('!opacity-0');
      fireEvent.mouseLeave(wrapper);
      fireEvent.mouseEnter(wrapper);
      expect(tip).not.toHaveClass('!opacity-0');
    });

    it('keeps long content complete and uses only opacity feedback with a reduced-motion safety net', () => {
      const content = 'Full contextual explanation, including its final instruction. '.repeat(30);
      render(<Tooltip content={content} multiline><button>Info</button></Tooltip>);
      const tip = screen.getByRole('tooltip');
      expect(tip.textContent).toBe(content);
      expect(tip).toHaveClass('whitespace-normal', 'break-words', 'motion-reduce:transition-none');
      expect(tip.className).not.toMatch(/scale-|truncate|line-clamp/);
      expect(tip).toHaveClass('bg-[var(--text-primary)]', 'shadow-e2', 'rounded-shape-sm');
    });
  });
});
