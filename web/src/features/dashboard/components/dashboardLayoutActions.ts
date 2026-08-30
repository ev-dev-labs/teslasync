import { verticalCompactor } from 'react-grid-layout';

import type { RGLLayout, WidgetDef } from '../widgets/types';

export type WidgetArrangeAction =
  | 'move-up'
  | 'move-down'
  | 'move-left'
  | 'move-right'
  | 'make-narrower'
  | 'make-wider'
  | 'make-shorter'
  | 'make-taller';

export type WidgetArrangeAvailability = Record<WidgetArrangeAction, boolean>;

const NO_ACTIONS: WidgetArrangeAvailability = {
  'move-up': false,
  'move-down': false,
  'move-left': false,
  'move-right': false,
  'make-narrower': false,
  'make-wider': false,
  'make-shorter': false,
  'make-taller': false,
};

type MoveAction = Extract<WidgetArrangeAction, `move-${string}`>;

function horizontallyOverlaps(a: RGLLayout, b: RGLLayout): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

function verticallyOverlaps(a: RGLLayout, b: RGLLayout): boolean {
  return a.y < b.y + b.h && a.y + a.h > b.y;
}

function directionalNeighbour(
  layout: readonly RGLLayout[],
  item: RGLLayout,
  action: MoveAction,
): RGLLayout | undefined {
  const candidates = layout.filter((candidate) => {
    if (candidate.i === item.i) return false;
    if (action === 'move-up') {
      return horizontallyOverlaps(candidate, item) && candidate.y < item.y;
    }
    if (action === 'move-down') {
      return horizontallyOverlaps(candidate, item) && candidate.y > item.y;
    }
    if (action === 'move-left') {
      return verticallyOverlaps(candidate, item) && candidate.x < item.x;
    }
    return verticallyOverlaps(candidate, item) && candidate.x > item.x;
  });

  candidates.sort((a, b) => {
    if (action === 'move-up') return (b.y + b.h) - (a.y + a.h);
    if (action === 'move-down') return a.y - b.y;
    if (action === 'move-left') return (b.x + b.w) - (a.x + a.w);
    return a.x - b.x;
  });
  return candidates[0];
}

function compact(layout: readonly RGLLayout[], cols: number): RGLLayout[] {
  return verticalCompactor.compact(
    layout.map((item) => ({ ...item })),
    cols,
  ) as RGLLayout[];
}

export function widgetArrangeAvailability(
  layout: readonly RGLLayout[],
  instanceId: string,
  def: WidgetDef,
  cols: number,
  mobileStack: boolean,
): WidgetArrangeAvailability {
  const normalized = compact(layout, cols);
  const item = normalized.find((candidate) => candidate.i === instanceId);
  if (!item) return NO_ACTIONS;

  const minW = item.minW ?? def.minSize.cols;
  const maxW = Math.min(cols, item.maxW ?? def.maxSize.cols);
  const minH = item.minH ?? def.minSize.rows;
  const maxH = item.maxH ?? def.maxSize.rows;
  return {
    'move-up': directionalNeighbour(normalized, item, 'move-up') != null,
    'move-down': directionalNeighbour(normalized, item, 'move-down') != null,
    'move-left': directionalNeighbour(normalized, item, 'move-left') != null,
    'move-right': directionalNeighbour(normalized, item, 'move-right') != null,
    'make-narrower': !mobileStack && item.w > minW,
    'make-wider': !mobileStack && item.w < maxW,
    'make-shorter': !mobileStack && item.h > minH,
    'make-taller': !mobileStack && item.h < maxH,
  };
}

export interface WidgetArrangeResult {
  layout: RGLLayout[];
  changed: boolean;
}

export function applyWidgetArrangeAction(
  layout: readonly RGLLayout[],
  instanceId: string,
  def: WidgetDef,
  cols: number,
  action: WidgetArrangeAction,
  mobileStack: boolean,
): WidgetArrangeResult {
  const normalized = compact(layout, cols);
  const current = normalized.map((item) => ({ ...item }));
  const item = current.find((candidate) => candidate.i === instanceId);
  const before = normalized.find((candidate) => candidate.i === instanceId);
  if (!item || !before) return { layout: normalized, changed: false };

  if (action.startsWith('move-')) {
    const neighbour = directionalNeighbour(current, item, action as MoveAction);
    if (!neighbour) return { layout: normalized, changed: false };

    if (action === 'move-up') {
      // A half-row places the item unambiguously before its neighbour; RGL's
      // vertical compactor normalizes the persisted result back to integers.
      item.y = neighbour.y - 0.5;
    } else if (action === 'move-down') {
      item.y = neighbour.y + neighbour.h + 0.5;
    } else {
      const combinedWidth = item.w + neighbour.w;
      if (combinedWidth > cols) return { layout: normalized, changed: false };
      const blockStart = Math.min(
        Math.min(item.x, neighbour.x),
        cols - combinedWidth,
      );
      if (action === 'move-left') {
        item.x = blockStart;
        neighbour.x = blockStart + item.w;
      } else {
        neighbour.x = blockStart;
        item.x = blockStart + neighbour.w;
      }
    }
  } else {
    if (mobileStack) return { layout: normalized, changed: false };
    const minW = item.minW ?? def.minSize.cols;
    const maxW = Math.min(cols, item.maxW ?? def.maxSize.cols);
    const minH = item.minH ?? def.minSize.rows;
    const maxH = item.maxH ?? def.maxSize.rows;
    const requestedW = action === 'make-narrower' ? item.w - 1
      : action === 'make-wider' ? item.w + 1
        : item.w;
    const requestedH = action === 'make-shorter' ? item.h - 1
      : action === 'make-taller' ? item.h + 1
        : item.h;
    item.w = Math.max(minW, Math.min(maxW, requestedW));
    item.h = Math.max(minH, Math.min(maxH, requestedH));
    item.x = Math.min(item.x, Math.max(0, cols - item.w));
  }

  const next = compact(current, cols);
  const after = next.find((candidate) => candidate.i === instanceId);
  const changed = after != null && (
    after.x !== before.x
    || after.y !== before.y
    || after.w !== before.w
    || after.h !== before.h
  );
  return changed
    ? { layout: next, changed: true }
    : { layout: normalized, changed: false };
}
