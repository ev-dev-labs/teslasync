import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassPanel, Heading, Button } from '@/components/ui';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehiclePanelCell } from './VehiclePanelCell';

afterEach(() => vi.unstubAllGlobals());

describe('vehicle panels through the shared container grid', () => {
  it('reflows allocated hosts without sorting, remounting or adding a second panel surface', () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { observers.set(target, this.callback) }
      disconnect() {}
    });
    const action = vi.fn();
    const { container } = render(<VehiclePanelGrid label="synthetic panel cohort" items={[
      { id: 'battery', size: 'half', content: <GlassPanel><Heading level="panel">Battery source</Heading><Button onClick={action}>Inspect battery</Button></GlassPanel> },
      { id: 'status', size: 'half', content: <GlassPanel><Heading level="panel">Status source</Heading></GlassPanel> },
      { id: 'history', size: 'half', content: <GlassPanel><Heading level="panel">History source</Heading></GlassPanel> },
    ]} />);
    const mounts = Array.from(container.querySelectorAll('[data-vehicle-panel]'));
    const surfaces = Array.from(container.querySelectorAll('[data-print-card]'));
    const control = screen.getByRole('button', { name: 'Inspect battery' });
    expect(observers.size).toBe(1);
    expect(Array.from(observers.keys())).toEqual([container.querySelector('[data-card-grid]')]);
    control.focus();
    function resize(width: number) {
      act(() => {
        for (const [target, callback] of observers) {
          callback([{ target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
        }
      });
    }
    // Window width does not choose the layout; a drawer can allocate 520px
    // even on a 1920px display. Actual CSS geometry still needs native review.
    resize(1280);
    expect(mounts.map(node => node.getAttribute('data-card-resolved-span'))).toEqual(['6', '6', '12']);
    resize(520);
    expect(mounts.map(node => node.getAttribute('data-card-resolved-span'))).toEqual(['1', '1', '1']);
    resize(768);
    expect(mounts.map(node => node.getAttribute('data-card-resolved-span'))).toEqual(['6', '6', '6']);
    expect(Array.from(container.querySelectorAll('[data-vehicle-panel]'))).toEqual(mounts);
    expect(Array.from(container.querySelectorAll('[data-print-card]'))).toEqual(surfaces);
    expect(surfaces).toHaveLength(3);
    expect(screen.getAllByRole('heading').map(node => node.textContent)).toEqual(['Battery source', 'Status source', 'History source']);
    expect(control).toHaveFocus();
    fireEvent.click(control);
    expect(action).toHaveBeenCalledOnce();
  });

  it('keeps every cell in an incomplete fleet row and in the supplied pin order', () => {
    const { container, rerender } = render(<VehiclePanelGrid label="synthetic fleet" items={[
      { id: 'pinned-2', size: 'quarter', content: <Heading level="panel">Pinned vehicle</Heading> },
      { id: 'vehicle-1', size: 'quarter', content: <Heading level="panel">First vehicle</Heading> },
      { id: 'vehicle-3', size: 'quarter', content: <Heading level="panel">Third vehicle</Heading> },
    ]} />);
    expect(Array.from(container.querySelectorAll('[data-vehicle-panel]')).map(node => node.getAttribute('data-vehicle-panel')))
      .toEqual(['pinned-2', 'vehicle-1', 'vehicle-3']);
    expect(screen.getAllByRole('heading')).toHaveLength(3);
    rerender(<VehiclePanelGrid label="synthetic fleet" items={[]} />);
    expect(screen.getByRole('group', { name: 'synthetic fleet' })).toBeInTheDocument();
  });

  it('uses one canonical allocated-width observer across all ten contract widths and disconnects it', () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    const constructed = vi.fn();
    const disconnected = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      private target?: Element;
      constructor(private callback: ResizeObserverCallback) { constructed() }
      observe(target: Element) { this.target = target; observers.set(target, this.callback) }
      disconnect() {
        disconnected();
        if (this.target) observers.delete(this.target);
      }
    });
    const { container, unmount } = render(<VehiclePanelGrid label="synthetic canonical placement" items={[
      { id: 'first', size: 'half', content: <GlassPanel><Heading level="panel">First fact</Heading></GlassPanel> },
      { id: 'second', size: 'half', content: <GlassPanel><Heading level="panel">Second fact</Heading></GlassPanel> },
      { id: 'third', size: 'half', content: <GlassPanel><Heading level="panel">Third fact</Heading></GlassPanel> },
    ]} />);
    const cells = Array.from(container.querySelectorAll('[data-vehicle-panel]'));
    expect(constructed).toHaveBeenCalledOnce();
    expect(Array.from(observers.keys())).toEqual([container.querySelector('[data-card-grid]')]);
    for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
      act(() => {
        for (const [target, callback] of observers) {
          callback([{ target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
        }
      });
      const expected = width < 640 ? ['1', '1', '1'] : width < 1024 ? ['6', '6', '6'] : ['6', '6', '12'];
      expect(cells.map(cell => cell.getAttribute('data-card-resolved-span'))).toEqual(expected);
      expect(Array.from(container.querySelectorAll('[data-vehicle-panel]'))).toEqual(cells);
      expect(screen.getAllByRole('heading').map(heading => heading.textContent)).toEqual(['First fact', 'Second fact', 'Third fact']);
      expect(constructed).toHaveBeenCalledOnce();
      expect(observers.size).toBe(1);
    }
    unmount();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(observers.size).toBe(0);
  });

  it('preserves standalone single-span semantics and content without observing an outer host', () => {
    const constructed = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor() { constructed() }
      observe() {}
      disconnect() {}
    });
    const { container } = render(<VehiclePanelCell id="standalone" size="half">
      <GlassPanel><Heading level="panel">Standalone source</Heading><Button>Inspect standalone source</Button></GlassPanel>
    </VehiclePanelCell>);
    const cell = container.querySelector('[data-vehicle-panel="standalone"]');
    expect(cell).toHaveAttribute('data-card-size', 'half');
    expect(cell).toHaveAttribute('data-card-resolved-span', '1');
    expect(screen.getByRole('heading', { name: 'Standalone source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect standalone source' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(1);
    expect(constructed).not.toHaveBeenCalled();
  });
});
