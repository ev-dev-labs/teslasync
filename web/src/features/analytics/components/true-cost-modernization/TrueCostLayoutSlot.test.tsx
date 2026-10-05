import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardGrid } from '@/components/layout/layout-reference';
import { TrueCostLayoutSlot } from './TrueCostLayoutSlot';

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children: ReactNode; className?: string }) =>
    <div className={className}>{children}</div>,
}));

afterEach(() => vi.unstubAllGlobals());

describe('True Cost shared grid placement adapter', () => {
  it.each([320, 375, 390, 430, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560])(
    'retains order and shared spans at allocated width %s without another observer',
    width => {
      let callback: ResizeObserverCallback | undefined;
      const observe = vi.fn();
      const disconnect = vi.fn();
      const construct = vi.fn();
      class Observer {
        constructor(next: ResizeObserverCallback) { callback = next; construct(); }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }
      vi.stubGlobal('ResizeObserver', Observer);
      const view = render(<CardGrid label="Source evidence" items={[
        { id: 'first', size: 'half', content: <TrueCostLayoutSlot delay={0.05}><span>First series</span></TrueCostLayoutSlot> },
        { id: 'second', size: 'half', content: <TrueCostLayoutSlot delay={0.06}><span>Second series</span></TrueCostLayoutSlot> },
        { id: 'ledger', size: 'full', content: <TrueCostLayoutSlot delay={0.1}><span>All ledger columns</span></TrueCostLayoutSlot> },
      ]} />);
      const host = view.container.querySelector('[data-card-grid]') as HTMLElement;
      act(() => callback!([{ target: host, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
      const slots = Array.from(host.querySelectorAll('[data-tco-layout-slot]'));
      expect(slots.map(node => node.textContent)).toEqual(['First series', 'Second series', 'All ledger columns']);
      const halfSpan = width < 640 ? '1' : '6';
      const fullSpan = width < 640 ? '1' : width < 1024 ? '6' : '12';
      expect(slots.map(node => node.getAttribute('data-card-resolved-span'))).toEqual([halfSpan, halfSpan, fullSpan]);
      slots.forEach(node => {
        expect(node).toHaveClass('min-w-0');
        expect(node.className).toMatch(/\bcol-span-/);
        expect(node.className).not.toMatch(/max-w-|mx-auto/);
      });
      expect(construct).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledWith(host);
      view.unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
    },
  );
});
