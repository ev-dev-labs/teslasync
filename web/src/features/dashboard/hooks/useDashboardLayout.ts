import { useState, useCallback } from 'react';
import type { WidgetInstance, WidgetSize, DashboardLayout } from '../widgets/types';
import { WIDGET_REGISTRY } from '../widgets/registry';

const STORAGE_KEY = 'teslasync-dashboard-layout';

const DEFAULT_LAYOUT: DashboardLayout = {
  id: 'default',
  name: 'Default',
  widgets: [
    { id: '1', widgetId: 'vehicle-hero', position: 0, size: { cols: 2, rows: 2 } },
    { id: '2', widgetId: 'battery-gauge', position: 1, size: { cols: 1, rows: 1 } },
    { id: '3', widgetId: 'climate-status', position: 2, size: { cols: 1, rows: 1 } },
    { id: '4', widgetId: 'recent-drives', position: 3, size: { cols: 2, rows: 2 } },
    { id: '5', widgetId: 'charge-status', position: 4, size: { cols: 2, rows: 1 } },
    { id: '6', widgetId: 'security-status', position: 5, size: { cols: 1, rows: 1 } },
    { id: '7', widgetId: 'quick-nav', position: 6, size: { cols: 4, rows: 1 } },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function loadLayout(): DashboardLayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DashboardLayout;
      const validWidgets = parsed.widgets.filter((w) =>
        WIDGET_REGISTRY.some((def) => def.id === w.widgetId),
      );
      return { ...parsed, widgets: validWidgets };
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_LAYOUT;
}

let nextId = Date.now();
function generateId(): string {
  return `w-${++nextId}`;
}

export const LAYOUT_PRESETS: Record<string, DashboardLayout> = {
  default: DEFAULT_LAYOUT,
  commuter: {
    id: 'commuter',
    name: 'Daily Commuter',
    widgets: [
      { id: 'c1', widgetId: 'battery-gauge', position: 0, size: { cols: 1, rows: 1 } },
      { id: 'c2', widgetId: 'range-estimate', position: 1, size: { cols: 1, rows: 1 } },
      { id: 'c3', widgetId: 'charge-status', position: 2, size: { cols: 2, rows: 1 } },
      { id: 'c4', widgetId: 'climate-status', position: 3, size: { cols: 1, rows: 1 } },
      { id: 'c5', widgetId: 'security-status', position: 4, size: { cols: 1, rows: 1 } },
      { id: 'c6', widgetId: 'location-map', position: 5, size: { cols: 2, rows: 2 } },
      { id: 'c7', widgetId: 'quick-nav', position: 6, size: { cols: 2, rows: 1 } },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  fleet_manager: {
    id: 'fleet_manager',
    name: 'Fleet Manager',
    widgets: [
      { id: 'f1', widgetId: 'fleet-stats', position: 0, size: { cols: 4, rows: 1 } },
      { id: 'f2', widgetId: 'recent-drives', position: 1, size: { cols: 2, rows: 2 } },
      { id: 'f3', widgetId: 'charge-history', position: 2, size: { cols: 2, rows: 2 } },
      { id: 'f4', widgetId: 'drive-score', position: 3, size: { cols: 1, rows: 1 } },
      { id: 'f5', widgetId: 'vehicle-hero', position: 4, size: { cols: 2, rows: 2 } },
      { id: 'f6', widgetId: 'quick-nav', position: 5, size: { cols: 4, rows: 1 } },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  data_nerd: {
    id: 'data_nerd',
    name: 'Data Nerd',
    widgets: [
      { id: 'd1', widgetId: 'live-signals', position: 0, size: { cols: 4, rows: 2 } },
      { id: 'd2', widgetId: 'energy-flow', position: 1, size: { cols: 2, rows: 2 } },
      { id: 'd3', widgetId: 'vehicle-twin', position: 2, size: { cols: 2, rows: 2 } },
      { id: 'd4', widgetId: 'battery-gauge', position: 3, size: { cols: 1, rows: 1 } },
      { id: 'd5', widgetId: 'drive-score', position: 4, size: { cols: 1, rows: 1 } },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout>(loadLayout);
  const [editMode, setEditMode] = useState(false);

  const saveLayout = useCallback((newLayout: DashboardLayout) => {
    const updated = { ...newLayout, updatedAt: new Date().toISOString() };
    setLayout(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const addWidget = useCallback(
    (widgetId: string) => {
      const def = WIDGET_REGISTRY.find((w) => w.id === widgetId);
      if (!def) return;
      const newWidget: WidgetInstance = {
        id: generateId(),
        widgetId,
        position: layout.widgets.length,
        size: { ...def.defaultSize },
      };
      saveLayout({ ...layout, widgets: [...layout.widgets, newWidget] });
    },
    [layout, saveLayout],
  );

  const removeWidget = useCallback(
    (instanceId: string) => {
      const widgets = layout.widgets
        .filter((w) => w.id !== instanceId)
        .map((w, i) => ({ ...w, position: i }));
      saveLayout({ ...layout, widgets });
    },
    [layout, saveLayout],
  );

  const reorderWidgets = useCallback(
    (activeId: string, overId: string) => {
      const widgets = [...layout.widgets].sort((a, b) => a.position - b.position);
      const oldIndex = widgets.findIndex((w) => w.id === activeId);
      const newIndex = widgets.findIndex((w) => w.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const [moved] = widgets.splice(oldIndex, 1);
      widgets.splice(newIndex, 0, moved);
      const reordered = widgets.map((w, i) => ({ ...w, position: i }));
      saveLayout({ ...layout, widgets: reordered });
    },
    [layout, saveLayout],
  );

  const resizeWidget = useCallback(
    (instanceId: string, size: WidgetSize) => {
      const widgets = layout.widgets.map((w) => (w.id === instanceId ? { ...w, size } : w));
      saveLayout({ ...layout, widgets });
    },
    [layout, saveLayout],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = LAYOUT_PRESETS[presetId];
      if (preset) saveLayout({ ...preset, updatedAt: new Date().toISOString() });
    },
    [saveLayout],
  );

  const resetLayout = useCallback(() => {
    saveLayout({ ...DEFAULT_LAYOUT, updatedAt: new Date().toISOString() });
  }, [saveLayout]);

  return {
    layout,
    editMode,
    setEditMode,
    addWidget,
    removeWidget,
    reorderWidgets,
    resizeWidget,
    resetLayout,
    applyPreset,
    saveLayout,
  };
}
