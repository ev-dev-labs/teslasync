import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardGrid, useCardPlacement, type CardGridItem } from '@/components/layout/layout-reference';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function PlacementProbe({ id }: { id: string }) {
  const placement = useCardPlacement();
  return <div data-testid={id} data-span={placement?.span} className={placement?.className}>{id}</div>;
}

describe('guard placement uses the shared single observer/packer', () => {
  it('keeps source order and mounted identities at all contract widths using one observer', () => {
    let resize: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const constructed = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { constructed(); resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const ids = ['guard-live-map', 'guard-controls', 'guard-settings', 'guard-status', 'guard-events'];
    const items: CardGridItem[] = ids.map(id => ({
      id, size: id === 'guard-events' ? 'full' : 'half', content: <PlacementProbe id={id} />,
    }));
    const view = render(<CardGrid label="Guard panels" items={items} />);
    const nodes = ids.map(id => screen.getByTestId(id));
    const boundary = view.container.querySelector('[data-card-grid]')!;
    for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
      act(() => resize?.([{ target: boundary, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
      expect(ids.map(id => screen.getByTestId(id))).toEqual(nodes);
      expect(Array.from(view.container.querySelectorAll('[data-span]')).map(node => node.textContent)).toEqual(ids);
      expect(nodes.map(node => Number(node.dataset.span))).toEqual(
        width < 640 ? [1, 1, 1, 1, 1] : width < 1024 ? [6, 6, 6, 6, 6] : [6, 6, 6, 6, 12],
      );
    }
    expect(constructed).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledOnce();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
