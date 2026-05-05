import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { SkipToContent } from '../SkipToContent';

describe('SkipToContent (Phase-46 / 60 — WCAG 2.4.1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an <a> wired through the canonical visually-hidden primitive', () => {
    render(<SkipToContent />);
    const link = screen.getByTestId('skip-to-content');
    expect(link.tagName).toBe('A');
    // The focus-revealing positioning chain proves we kept the
    // visible-on-focus skip-link behavior. The actual hidden styling
    // is the responsibility of <VisuallyHidden> and is asserted in
    // its own test file (which is the only place allowed to mention
    // the literal Tailwind utility — see audit:sr-only).
    expect(link.className).toContain('focus:fixed');
    expect(link.className).toContain('focus:top-4');
  });

  it('points at the #main-content landmark', () => {
    render(<SkipToContent />);
    const link = screen.getByTestId('skip-to-content');
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('renders the localized "Skip to main content" label', () => {
    render(<SkipToContent />);
    expect(
      screen.getByRole('link', { name: /skip to main content/i }),
    ).toBeInTheDocument();
  });

  it('on click, focuses and scrolls the #main-content landmark', () => {
    const main = document.createElement('main');
    main.id = 'main-content';
    main.tabIndex = -1;
    // jsdom does not implement Element.prototype.scrollIntoView, so we
    // assign a stub before spying. focus is implemented natively.
    const scrollFn = vi.fn();
    Object.defineProperty(main, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollFn,
    });
    const focusSpy = vi.spyOn(main, 'focus');
    document.body.appendChild(main);

    render(<SkipToContent />);
    fireEvent.click(screen.getByTestId('skip-to-content'));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: false });
    expect(scrollFn).toHaveBeenCalledTimes(1);
    expect(scrollFn).toHaveBeenCalledWith({ block: 'start' });
  });

  it('does not throw if the #main-content landmark is missing', () => {
    render(<SkipToContent />);
    expect(() =>
      fireEvent.click(screen.getByTestId('skip-to-content')),
    ).not.toThrow();
  });
});
