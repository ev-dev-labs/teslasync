import { act, lazy } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DeferredBatterySection from './DeferredBatterySection';

class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];

  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  private readonly callback: IntersectionObserverCallback;
  private target: Element | null = null;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    ControlledIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  disconnect() {}

  unobserve() {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(isIntersecting: boolean) {
    if (!this.target) return;
    this.callback(
      [{
        isIntersecting,
        target: this.target,
        intersectionRatio: isIntersecting ? 1 : 0,
      } as IntersectionObserverEntry],
      this,
    );
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  ControlledIntersectionObserver.instances = [];
});

describe('DeferredBatterySection', () => {
  it('does not load a lazy chart subtree until the section approaches the viewport', async () => {
    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
    let moduleLoads = 0;
    const LazyChart = lazy(async () => {
      moduleLoads++;
      return { default: () => <div>Deferred chart content</div> };
    });

    render(
      <DeferredBatterySection
        testId="deferred-chart"
        fallback={<div>Chart placeholder</div>}
      >
        <LazyChart />
      </DeferredBatterySection>,
    );

    expect(screen.getByText('Chart placeholder')).toBeInTheDocument();
    expect(screen.queryByText('Deferred chart content')).not.toBeInTheDocument();
    expect(moduleLoads).toBe(0);

    await act(async () => {
      ControlledIntersectionObserver.instances[0]?.emit(true);
    });

    expect(await screen.findByText('Deferred chart content')).toBeInTheDocument();
    expect(moduleLoads).toBe(1);
  });
});
