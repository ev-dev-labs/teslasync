import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { PageHeaderSticky } from '../PageHeaderSticky';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: motion.reduce, durationMs: motion.reduce ? 0 : 250 }),
}));

type IOEntry = { isIntersecting: boolean; boundingClientRect: { top: number } };
type IOCallback = (entries: Array<IOEntry>) => void;

let lastCb: IOCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();
const options = vi.fn();

class MockIO {
  constructor(cb: IOCallback, init?: IntersectionObserverInit) {
    lastCb = cb;
    options(init);
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
  takeRecords = () => [];
}

beforeEach(() => {
  observe.mockReset();
  disconnect.mockReset();
  options.mockReset();
  motion.reduce = false;
  lastCb = null;
  vi.stubGlobal('IntersectionObserver', MockIO);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function setup(props?: Partial<React.ComponentProps<typeof PageHeaderSticky>>) {
  // Render a target element first so getElementById finds it.
  const target = document.createElement('div');
  target.id = 'hero';
  document.body.appendChild(target);
  return render(
    <PageHeaderSticky targetId="hero" ariaLabel="Sticky bar" {...props}>
      {props?.children ?? <span>Compact summary</span>}
    </PageHeaderSticky>,
  );
}

describe('PageHeaderSticky', () => {
  it('is hidden initially before any intersection event', () => {
    setup();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('becomes visible when the target scrolls out of view', () => {
    setup();
    expect(observe).toHaveBeenCalled();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    expect(screen.getByRole('region', { name: /sticky bar/i })).toBeInTheDocument();
    expect(screen.getByText('Compact summary')).toBeInTheDocument();
  });

  it('hides again when the target re-enters view', () => {
    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    expect(screen.getByRole('region')).toBeInTheDocument();
    act(() => {
      lastCb?.([{ isIntersecting: true, boundingClientRect: { top: 50 } }]);
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('stays hidden when the target is below the viewport (not yet scrolled to)', () => {
    // Long-page guard: if the target is below the viewport on first paint,
    // IntersectionObserver fires with isIntersecting=false but the bar
    // should NOT appear — only when the target scrolls ABOVE the viewport.
    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: 800 } }]);
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('renders a button when scrollToTop is enabled (default)', () => {
    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    expect(screen.getByRole('button', { name: /scroll to top/i })).toBeInTheDocument();
  });

  it('does NOT render a button when scrollToTop is false', () => {
    setup({ scrollToTop: false });
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('scrolls #main-content to the top when present', () => {
    const main = document.createElement('main');
    main.id = 'main-content';
    document.body.appendChild(main);
    const mainScrollSpy = vi.fn();
    main.scrollTo = mainScrollSpy;
    const windowScrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    fireEvent.click(screen.getByRole('button', { name: /scroll to top/i }));

    expect(mainScrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(windowScrollSpy).not.toHaveBeenCalled();
    windowScrollSpy.mockRestore();
  });

  it('falls back to window.scrollTo when #main-content is missing', () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    fireEvent.click(screen.getByRole('button', { name: /scroll to top/i }));
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    scrollSpy.mockRestore();
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = setup();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('preserves the offset, region identity, caller classes and native button type', () => {
    setup({ topOffset: 48, testId: 'summary', className: 'caller-class' });
    expect(options).toHaveBeenCalledWith({ rootMargin: '-48px 0px 0px 0px', threshold: 0 });
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    expect(screen.getByTestId('summary')).toHaveStyle({ top: '48px' });
    expect(screen.getByTestId('summary')).toHaveClass('sticky', 'caller-class');
    expect(screen.getByRole('button', { name: 'Sticky bar — scroll to top' })).toHaveAttribute('type', 'button');
  });

  it('replaces and disconnects the observer when the target or offset changes', () => {
    const nextTarget = document.createElement('div');
    nextTarget.id = 'next-hero';
    document.body.appendChild(nextTarget);
    const { rerender } = setup();
    rerender(<PageHeaderSticky targetId="next-hero" topOffset={24} ariaLabel="Next summary">Summary</PageHeaderSticky>);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenLastCalledWith(nextTarget);
    expect(options).toHaveBeenLastCalledWith({ rootMargin: '-24px 0px 0px 0px', threshold: 0 });
  });

  it('remains hidden when the target is absent', () => {
    setup({ targetId: 'missing' });
    expect(observe).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('retains long summaries with wrapping and logical alignment rather than truncation', () => {
    const summary = 'Long localized summary '.repeat(15);
    setup({ children: summary, scrollToTop: false });
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    const content = screen.getByRole('region').firstElementChild?.firstElementChild;
    expect(content).toHaveTextContent(summary.trim());
    expect(content).toHaveClass('flex-wrap', 'break-words', 'text-start');
    expect(content).not.toHaveClass('truncate');
  });

  it('keeps the native scroll action focusable with a visible focus outline', () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    const button = screen.getByRole('button');
    button.focus();
    expect(button).toHaveFocus();
    expect(button.tabIndex).toBe(0);
    expect(button).toHaveClass('focus-visible:outline', 'focus-visible:outline-[var(--focus-ring)]');
    fireEvent.click(button);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    scrollSpy.mockRestore();
  });

  it.each([true, false])('uses instant scrolling for reduced motion in main=%s', (withMain) => {
    motion.reduce = true;
    const scrollSpy = vi.fn();
    if (withMain) {
      const main = document.createElement('main');
      main.id = 'main-content';
      main.scrollTo = scrollSpy;
      document.body.appendChild(main);
    }
    const windowSpy = vi.spyOn(window, 'scrollTo').mockImplementation(scrollSpy);
    setup();
    act(() => {
      lastCb?.([{ isIntersecting: false, boundingClientRect: { top: -100 } }]);
    });
    fireEvent.click(screen.getByRole('button'));
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(screen.getByRole('button')).toHaveClass('transition-none');
    if (withMain) expect(windowSpy).not.toHaveBeenCalled();
    windowSpy.mockRestore();
  });
});
