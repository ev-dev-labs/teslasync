import { describe, expect, it } from 'vitest';

import type { RGLLayout, WidgetDef } from '../widgets/types';
import {
  applyWidgetArrangeAction,
  widgetArrangeAvailability,
} from './dashboardLayoutActions';

const DEF = {
  minSize: { cols: 1, rows: 1 },
  maxSize: { cols: 4, rows: 8 },
} as WidgetDef;

const stacked = (): RGLLayout[] => [
  { i: 'a', x: 0, y: 0, w: 2, h: 2 },
  { i: 'b', x: 0, y: 2, w: 2, h: 2 },
  { i: 'c', x: 0, y: 4, w: 2, h: 2 },
];

describe('dashboard layout actions', () => {
  it('moves a widget down one neighbour in a single compacted action', () => {
    const result = applyWidgetArrangeAction(stacked(), 'a', DEF, 4, 'move-down', false);
    const a = result.layout.find((item) => item.i === 'a');
    const b = result.layout.find((item) => item.i === 'b');

    expect(result.changed).toBe(true);
    expect(a?.y).toBeGreaterThan(b?.y ?? Number.MAX_SAFE_INTEGER);
    expect(result.layout.every((item) =>
      Number.isInteger(item.x)
      && Number.isInteger(item.y)
      && item.x >= 0
      && item.y >= 0,
    )).toBe(true);
    expect(widgetArrangeAvailability(result.layout, 'a', DEF, 4, false)['move-up']).toBe(true);
  });

  it('moves a widget up one neighbour in a single compacted action', () => {
    const result = applyWidgetArrangeAction(stacked(), 'c', DEF, 4, 'move-up', false);
    const b = result.layout.find((item) => item.i === 'b');
    const c = result.layout.find((item) => item.i === 'c');

    expect(result.changed).toBe(true);
    expect(c?.y).toBeLessThan(b?.y ?? -1);
  });

  it('disables movement where no directional neighbour exists', () => {
    const availability = widgetArrangeAvailability(stacked(), 'a', DEF, 4, false);
    expect(availability['move-up']).toBe(false);
    expect(availability['move-left']).toBe(false);

    const bottom = widgetArrangeAvailability(stacked(), 'c', DEF, 4, false);
    expect(bottom['move-down']).toBe(false);
  });

  it('swaps side-by-side widgets without persisting an overlap', () => {
    const layout: RGLLayout[] = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 2, y: 0, w: 2, h: 2 },
    ];
    const result = applyWidgetArrangeAction(layout, 'a', DEF, 4, 'move-right', false);
    const a = result.layout.find((item) => item.i === 'a');
    const b = result.layout.find((item) => item.i === 'b');

    expect(result.changed).toBe(true);
    expect(a?.x).toBeGreaterThan(b?.x ?? Number.MAX_SAFE_INTEGER);
    expect(a?.y).toBe(b?.y);
  });

  it('preserves one row when swapping side-by-side widgets of unequal widths', () => {
    const layout: RGLLayout[] = [
      { i: 'a', x: 0, y: 0, w: 1, h: 2 },
      { i: 'b', x: 1, y: 0, w: 3, h: 2 },
    ];
    const result = applyWidgetArrangeAction(layout, 'a', DEF, 4, 'move-right', false);
    const a = result.layout.find((item) => item.i === 'a');
    const b = result.layout.find((item) => item.i === 'b');

    expect(result.changed).toBe(true);
    expect(a).toMatchObject({ x: 3, y: 0, w: 1 });
    expect(b).toMatchObject({ x: 0, y: 0, w: 3 });
  });

  it('resizes within widget limits and disables inert mobile sizing', () => {
    const layout: RGLLayout[] = [{ i: 'a', x: 0, y: 0, w: 2, h: 2 }];
    const wider = applyWidgetArrangeAction(layout, 'a', DEF, 4, 'make-wider', false);
    expect(wider.layout[0]?.w).toBe(3);

    const mobile = widgetArrangeAvailability(layout, 'a', DEF, 1, true);
    expect(mobile['make-taller']).toBe(false);
    expect(applyWidgetArrangeAction(layout, 'a', DEF, 1, 'make-taller', true).changed).toBe(false);
  });
});
