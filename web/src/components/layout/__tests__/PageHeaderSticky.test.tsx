import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { PageHeaderSticky } from '../PageHeaderSticky';

type IOEntry = { isIntersecting: boolean; boundingClientRect?: { top: number } };
type IOCallback = (entries: Array<IOEntry>) => void;

let lastCb: IOCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class MockIO {
  constructor(cb: IOCallback) {
    lastCb = cb;
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
  takeRecords = () => [];
}

beforeEach(() => {
  observe.mockReset();
  disconnect.mockReset();
  lastCb = null;
  (globalThis as unknown as { IntersectionObserver: typeof MockIO }).IntersectionObserver = MockIO;
});

afterEach(() => {
  document.body.innerHTML = '';
});

function setup(props?: Partial<React.ComponentProps<typeof PageHeaderSticky>>) {
  // Render a target element first so getElementById finds it.
  const target = document.createElement('div');
  target.id = 'hero';
  document.body.appendChild(target);
  return render(
    <PageHeaderSticky targetId="hero" ariaLabel="Sticky bar" {...props}>
      <span>Compact summary</span>
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
    main.scrollTo = mainScrollSpy as unknown as typeof main.scrollTo;
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
});
