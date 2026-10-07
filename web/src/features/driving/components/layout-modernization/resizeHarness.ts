import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** Test-only observer delivery exercises the canonical CardGrid boundary,
 * without pretending that jsdom measures a browser's actual CSS geometry. */
export function installResizeHarness() {
  const observers = new Set<TestResizeObserver>();
  class TestResizeObserver implements ResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
    deliver(width: number) {
      const size: ResizeObserverSize = { inlineSize: width, blockSize: 100 };
      const entries: ResizeObserverEntry[] = Array.from(this.targets, target => ({
        target,
        contentRect: new DOMRect(0, 0, width, 100),
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      }));
      this.callback(entries, this);
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  return {
    get observerCount() { return observers.size; },
    resize: (width: number) => act(() => {
      for (const observer of observers) observer.deliver(width);
    }),
  };
}
