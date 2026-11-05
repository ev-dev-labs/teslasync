import { describe, expect, it } from 'vitest';
import { normalizeDashboard, orderedLayouts, packOrderedWidgets, widgetHeightBounds } from './orderedLayout';
import type { SavedDashboard, WidgetInstance } from '../widgets/types';

const widget = (id: string, sizeClass: WidgetInstance['sizeClass']): WidgetInstance =>
  ({ id, widgetId: 'battery-gauge', sizeClass });

describe('ordered dashboard layouts', () => {
  it('fills earlier shelves with smaller widgets without overlap at every column count', () => {
    const widgets = [widget('a', 'large'), widget('b', 'medium'), widget('c', 'small'), widget('d', 'small')];
    const heights = new Map([['a', 2.5], ['b', 1.75], ['c', 1.25], ['d', 1]]);
    expect(packOrderedWidgets(widgets, 4, heights).find(item => item.i === 'c'))
      .toMatchObject({ x: 3, y: 0 });
    for (const columns of [1, 2, 3, 4]) {
      const layout = packOrderedWidgets(widgets, columns, heights);
      for (const item of layout) {
        expect(item.x + item.w).toBeLessThanOrEqual(columns);
        for (const other of layout.filter(candidate => candidate.i !== item.i)) {
          expect(item.x < other.x + other.w && item.x + item.w > other.x
            && item.y < other.y + other.h && item.y + item.h > other.y).toBe(false);
        }
      }
    }
    expect(widgets.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('migrates the widest saved reading order once, retaining settings and explicit sizes', () => {
    const saved: SavedDashboard = {
      id: 'legacy', name: 'Legacy', createdAt: '', updatedAt: '',
      widgets: [widget('a', 'small'), { ...widget('b', 'small'), config: { showTitle: false } }],
      layouts: {
        lg: [
          { i: 'a', x: 2, y: 5, w: 2, h: 12, userSized: true },
          { i: 'b', x: 0, y: 0, w: 1, h: 8 },
        ],
        xs: [{ i: 'a', x: 0, y: 0, w: 1, h: 12 }, { i: 'b', x: 0, y: 12, w: 1, h: 8 }],
      },
    };
    const migrated = normalizeDashboard(saved);
    expect(migrated.widgets).toEqual([
      { ...saved.widgets[1], sizeClass: 'small' },
      { ...saved.widgets[0], sizeClass: 'medium', heightRows: 12 },
    ]);
    expect(migrated.layoutVersion).toBe(1);
    expect(normalizeDashboard({ ...migrated, layouts: saved.layouts })).toEqual(migrated);
    expect(saved.layoutVersion).toBeUndefined();
  });

  it('keeps canonical order and size classes across narrow and wide layouts', () => {
    const widgets = [widget('c', 'full'), widget('a', 'medium'), widget('b', 'small')];
    const layouts = orderedLayouts(widgets);
    expect(layouts.xs.map(item => item.i)).toEqual(['c', 'a', 'b']);
    expect(layouts.xs.map(item => item.w)).toEqual([1, 1, 1]);
    expect(layouts.lg.map(item => item.w)).toEqual([4, 2, 1]);
    expect(widgets.map(item => item.sizeClass)).toEqual(['full', 'medium', 'small']);
  });

  it('uses explicit resize as a bounded ceiling rather than padding a short card', () => {
    expect(widgetHeightBounds({ ...widget('a', 'small'), heightRows: 2 })).toEqual({ min: 72, max: 176 });
    expect(widgetHeightBounds({ ...widget('a', 'small'), heightRows: 40 }).max).toBe(900);
  });
});
