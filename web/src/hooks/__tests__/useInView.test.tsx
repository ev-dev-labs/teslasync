import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, screen } from '@testing-library/react';
import { useInView, type UseInViewOptions } from '../useInView';

// ── Controllable IntersectionObserver fake ───────────────────────────────────
// The global test-setup installs a mock IntersectionObserver that fires
// `isIntersecting: true` immediately on observe(). That is handy for components
// that just want to lazy-mount, but useInView needs deterministic, step-by-step
// control over when the browser reports (in)visibility. So each test installs
// this instrumented fake, captures the callback + constructor options, and
// drives intersection events manually inside act().
type IOEntryish = { isIntersecting: boolean };
type IOCallback = (entries: IOEntryish[], observer: unknown) => void;

let instances: MockIO[] = [];

class MockIO {
  cb: IOCallback;
  options?: IntersectionObserverInit;
  observed: Element[] = [];
  observe = vi.fn((node: Element) => {
    this.observed.push(node);
  });
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(cb: IOCallback, options?: IntersectionObserverInit) {
    this.cb = cb;
    this.options = options;
    instances.push(this);
  }
  takeRecords(): IOEntryish[] {
    return [];
  }
}

const OriginalIO = globalThis.IntersectionObserver;

function setIO(value: unknown) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = value;
}

beforeEach(() => {
  instances = [];
  setIO(MockIO);
});

afterEach(() => {
  setIO(OriginalIO);
});

/** Fire an intersection event on the most-recently created observer. */
function fire(isIntersecting: boolean, index = instances.length - 1) {
  const inst = instances[index];
  if (!inst) throw new Error('no IntersectionObserver instance to fire on');
  act(() => {
    inst.cb([{ isIntersecting }], inst);
  });
}

/** Mounts the hook and attaches the ref to a real node so the effect sees
 *  `ref.current`; the current inView flag is mirrored onto a data attribute. */
function Harness({ options }: { options?: UseInViewOptions }) {
  const { ref, inView } = useInView<HTMLDivElement>(options);
  return <div ref={ref} data-testid="target" data-inview={inView ? 'yes' : 'no'} />;
}

/** New inline-array threshold on every render — the reference changes each time
 *  even though the values are equal. Exercises the thresholdKey serialization. */
function InlineThresholdHarness({ tick }: { tick: number }) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: [0, 0.5, 1] });
  return (
    <div ref={ref} data-testid="target" data-tick={tick} data-inview={inView ? 'yes' : 'no'} />
  );
}

/** Threshold value genuinely varies between renders. */
function VaryingThresholdHarness({ threshold }: { threshold: number }) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold });
  return <div ref={ref} data-testid="target" data-inview={inView ? 'yes' : 'no'} />;
}

/** rootMargin varies between renders — used to prove the freeze guard blocks
 *  re-subscription after the element has already been seen. */
function FreezeReuseHarness({ margin }: { margin: string }) {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: margin });
  return <div ref={ref} data-testid="target" data-inview={inView ? 'yes' : 'no'} />;
}

const inViewOf = (el: HTMLElement) => el.getAttribute('data-inview');

describe('useInView', () => {
  it('starts out of view and observes the target with default options', () => {
    render(<Harness />);
    const target = screen.getByTestId('target');

    expect(inViewOf(target)).toBe('no');
    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledTimes(1);
    expect(instances[0].observed[0]).toBe(target);
    expect(instances[0].options).toEqual({ rootMargin: '200px', threshold: 0, root: null });
  });

  it('flips to in-view when the observer reports intersection', () => {
    render(<Harness />);
    const target = screen.getByTestId('target');
    expect(inViewOf(target)).toBe('no');

    fire(true);
    expect(inViewOf(target)).toBe('yes');
  });

  it('freezes on first sighting: disconnects and stays in view even after leaving', () => {
    render(<Harness />);
    const target = screen.getByTestId('target');

    fire(true);
    expect(inViewOf(target)).toBe('yes');
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);

    // A stray "left the viewport" event must not un-freeze the value.
    fire(false);
    expect(inViewOf(target)).toBe('yes');
  });

  it('tracks continuously when freezeOnceVisible is false', () => {
    render(<Harness options={{ freezeOnceVisible: false }} />);
    const target = screen.getByTestId('target');

    fire(true);
    expect(inViewOf(target)).toBe('yes');
    // Non-freezing observers stay connected so they can report leaving.
    expect(instances[0].disconnect).not.toHaveBeenCalled();

    fire(false);
    expect(inViewOf(target)).toBe('no');

    fire(true);
    expect(inViewOf(target)).toBe('yes');
  });

  it('forwards custom rootMargin, threshold and root to the observer', () => {
    const root = document.createElement('section');
    render(<Harness options={{ rootMargin: '0px', threshold: [0, 0.5, 1], root }} />);

    expect(instances[0].options).toEqual({ rootMargin: '0px', threshold: [0, 0.5, 1], root });
  });

  it('does not create an observer when the ref is never attached to a node', () => {
    // renderHook never mounts the ref onto a DOM node, so ref.current stays null
    // and the effect must bail out before constructing an observer.
    const { result } = renderHook(() => useInView());

    expect(result.current.inView).toBe(false);
    expect(instances).toHaveLength(0);
  });

  it('reports in-view immediately when IntersectionObserver is unavailable (SSR / no polyfill)', () => {
    setIO(undefined);
    const { result } = renderHook(() => useInView());

    expect(result.current.inView).toBe(true);
    expect(instances).toHaveLength(0);
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Harness />);
    expect(instances[0].disconnect).not.toHaveBeenCalled();

    unmount();
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty intersection batch without crashing', () => {
    render(<Harness />);
    const target = screen.getByTestId('target');
    const inst = instances[0];

    expect(() => {
      act(() => {
        inst.cb([], inst);
      });
    }).not.toThrow();
    expect(inViewOf(target)).toBe('no');
  });

  it('reuses one observer when an inline-array threshold keeps equal values across renders', () => {
    const { rerender } = render(<InlineThresholdHarness tick={0} />);
    expect(instances).toHaveLength(1);

    rerender(<InlineThresholdHarness tick={1} />);
    rerender(<InlineThresholdHarness tick={2} />);

    // A new array reference each render must NOT thrash the observer.
    expect(instances).toHaveLength(1);
    expect(instances[0].disconnect).not.toHaveBeenCalled();
  });

  it('rebuilds the observer when the threshold value actually changes', () => {
    const { rerender } = render(<VaryingThresholdHarness threshold={0} />);
    expect(instances).toHaveLength(1);
    expect(instances[0].options?.threshold).toBe(0);

    rerender(<VaryingThresholdHarness threshold={0.5} />);
    expect(instances).toHaveLength(2);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(instances[1].options?.threshold).toBe(0.5);
  });

  it('stays frozen and does not re-subscribe after being seen, even if options change', () => {
    const { rerender } = render(<FreezeReuseHarness margin="200px" />);

    fire(true);
    expect(instances).toHaveLength(1);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1); // frozen → disconnected

    // Changing rootMargin would normally re-run the effect, but the freeze
    // guard short-circuits before building a second observer.
    rerender(<FreezeReuseHarness margin="0px" />);
    expect(instances).toHaveLength(1);
    expect(inViewOf(screen.getByTestId('target'))).toBe('yes');
  });
});
