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
import { render, screen, cleanup } from '@testing-library/react';
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

  it('wraps with a max width when multiline is set', () => {
    render(
      <Tooltip content="A much longer help body that should wrap" multiline>
        <button>T</button>
      </Tooltip>,
    );
    const cls = screen.getByRole('tooltip').className;
    expect(cls).toContain('whitespace-normal');
    expect(cls).toContain('max-w-[260px]');
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
});
