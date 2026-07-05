// TransitionArrow unit tests.
//
// TransitionArrow renders a compact "from → to" state-transition label. The
// middle glyph is decorative, so the whole control is exposed to assistive
// tech as a single role="img" carrying a translated "{from} to {to}" label,
// while each side degrades to an em-dash placeholder when its value is
// missing (null / undefined / blank / — defensively — a non-string that leaks
// through loosely-typed API data) instead of leaving a blank gap.
//
// Facets covered:
//   1. Happy-path rendering + child order (from, arrow glyph, to).
//   2. Typography classes preserved + custom className merged.
//   3. testId hook.
//   4. a11y: one labelled role="img"; the label interpolates the real values;
//      every visible part is aria-hidden so AT announces the transition once.
//   5. Null-safety branches: null, undefined, empty, whitespace-only, and
//      non-string runtime values all render the placeholder without crashing.
//   6. A value with surrounding whitespace keeps its original content.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransitionArrow } from './TransitionArrow';

// Deterministic i18n: return the inline default, substituting {{var}} from opts.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

describe('TransitionArrow — rendering', () => {
  it('renders from, the arrow glyph, and to in order with no stray text', () => {
    const { container } = render(<TransitionArrow from="parked" to="driving" />);
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toBe('parked→driving');
  });

  it('preserves the mono/size typography classes and merges a custom className', () => {
    const { container } = render(
      <TransitionArrow from="a" to="b" className="opacity-70" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('font-mono');
    expect(root.className).toContain('text-xs');
    expect(root.className).toContain('opacity-70');
  });

  it('forwards a testId hook to the root element', () => {
    render(<TransitionArrow from="a" to="b" testId="ta" />);
    expect(screen.getByTestId('ta')).toBeInTheDocument();
  });
});

describe('TransitionArrow — accessibility', () => {
  it('announces the transition once via a single labelled role="img"', () => {
    render(<TransitionArrow from="parked" to="driving" />);
    const img = screen.getByRole('img', { name: 'parked to driving' });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('parked to driving');
  });

  it('marks the arrow glyph and both labels as decorative (aria-hidden)', () => {
    const { container } = render(<TransitionArrow from="parked" to="driving" />);
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden).toHaveLength(3);
    expect(Array.from(hidden).map((el) => el.textContent)).toEqual([
      'parked',
      '→',
      'driving',
    ]);
  });

  it('reflects placeholder values in the accessible label when a side is missing', () => {
    render(<TransitionArrow from={null} to="driving" />);
    expect(screen.getByRole('img', { name: '— to driving' })).toBeInTheDocument();
  });
});

describe('TransitionArrow — null safety / placeholders', () => {
  it('renders an em-dash when from is null', () => {
    const { container } = render(<TransitionArrow from={null} to="driving" />);
    expect(container.textContent).toBe('—→driving');
  });

  it('renders an em-dash when to is undefined', () => {
    const { container } = render(<TransitionArrow from="parked" to={undefined} />);
    expect(container.textContent).toBe('parked→—');
  });

  it('treats empty and whitespace-only strings as missing', () => {
    const { container } = render(<TransitionArrow from="" to="   " />);
    expect(container.textContent).toBe('—→—');
  });

  it('does not crash on non-string runtime values and shows placeholders', () => {
    // Simulate loosely-typed API data leaking a non-string through the boundary.
    const { container } = render(
      <TransitionArrow
        from={42 as unknown as string}
        to={{} as unknown as string}
      />,
    );
    expect(container.textContent).toBe('—→—');
    expect(screen.getByRole('img', { name: '— to —' })).toBeInTheDocument();
  });

  it('keeps the original content of a value that has surrounding whitespace', () => {
    const { container } = render(<TransitionArrow from="  parked  " to="driving" />);
    const fromSpan = container.querySelectorAll('span[aria-hidden="true"]')[0];
    expect(fromSpan.textContent).toBe('  parked  ');
  });
});
