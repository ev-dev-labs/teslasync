import { createPortal } from 'react-dom';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { Button } from '@/components/ui';
import { Activity } from 'lucide-react';
import { PackBoundary, usePackPresentation } from '../widgets/designPacks/PackBoundary';
import { WidgetShell } from '../widgets/WidgetShell';
import { DashboardGrid } from './DashboardGrid';
import type { SavedDashboard } from '../widgets/types';

vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useContainerWidth: () => ({ containerRef: { current: null }, width: 1400 }),
  noCompactor: () => {},
}));

vi.mock('../hooks/useWidgetContentHeights', () => ({
  useWidgetContentHeights: () => new Map(),
}));

vi.mock('../widgets/registry', () => {
  const widgetDef = {
    id: 'test-widget',
    name: 'Test widget',
    description: 'Test widget presentation',
    icon: Activity,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 4, rows: 8 },
    component: function TestWidget() {
      const pack = usePackPresentation();
      const [count, setCount] = useState(0);
      return (
        <WidgetShell title="Test widget">
          <span data-testid="widget-presentation">{pack}</span>
          <span data-testid="widget-count">{count}</span>
          <Button onClick={() => setCount(value => value + 1)}>Increment</Button>
        </WidgetShell>
      );
    },
  };
  return {
    WIDGET_REGISTRY: [widgetDef],
    getWidgetDef: (id: string) => id === widgetDef.id ? widgetDef : undefined,
  };
});

const dashboard: SavedDashboard = {
  id: 'grid-pack-test',
  name: 'Test',
  widgets: [{ id: 'widget-1', widgetId: 'test-widget' }],
  layouts: { lg: [{ i: 'widget-1', x: 0, y: 0, w: 2, h: 2 }] },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const onLayoutChange = vi.fn();

function Grid({ requestedPackId }: { requestedPackId?: unknown }) {
  return (
    <DashboardGrid
      dashboard={dashboard}
      requestedPackId={requestedPackId}
      editMode={false}
      onLayoutChange={onLayoutChange}
      onRemoveWidget={() => {}}
      onOpenSettings={() => {}}
      getWidgetSize={() => ({ cols: 2, rows: 2 })}
    />
  );
}

afterEach(() => {
  cleanup();
  onLayoutChange.mockClear();
});

describe('DashboardGrid pack boundary', () => {
  it('keeps the mounted controller and saved geometry across a pack switch, including fullscreen', () => {
    const view = render(<Grid requestedPackId="classic" />);
    fireEvent.click(screen.getByRole('button', { name: 'Increment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Test widget' }));
    expect(screen.getAllByTestId('widget-presentation').map(node => node.textContent)).toEqual(['classic', 'classic']);

    view.rerender(<Grid requestedPackId="v1" />);
    expect(screen.getAllByTestId('widget-presentation').map(node => node.textContent)).toEqual(['v1', 'v1']);
    expect(screen.getAllByTestId('widget-count')[0]).toHaveTextContent('1');
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(dashboard.layouts.lg[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('carries an inherited viewer choice into a kiosk portal and resolves unknown IDs to Classic', () => {
    const view = render(
      <PackBoundary requestedPackId="v1">
        {createPortal(<div data-testid="kiosk-root"><Grid /></div>, document.body)}
      </PackBoundary>,
    );
    expect(within(screen.getByTestId('kiosk-root')).getByTestId('widget-presentation')).toHaveTextContent('v1');
    view.rerender(
      <PackBoundary requestedPackId="retired">
        {createPortal(<div data-testid="kiosk-root"><Grid /></div>, document.body)}
      </PackBoundary>,
    );
    expect(within(screen.getByTestId('kiosk-root')).getByTestId('widget-presentation')).toHaveTextContent('classic');
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});
