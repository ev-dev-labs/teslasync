import { expect, test } from '@playwright/test';
import { connectedRouteVectorGeometry, type RouteVectorSegment } from './widget-design-packs.specialized';

function segment(
  index: number, start: [number, number], end: [number, number], space = 'svg:0',
): RouteVectorSegment {
  return {
    index, space, d: `M${start.join(' ')}L${end.join(' ')}`,
    start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] },
    length: Math.hypot(end[0] - start[0], end[1] - start[1]),
    bounds: {
      x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]),
      width: Math.abs(end[0] - start[0]), height: Math.abs(end[1] - start[1]),
    },
  };
}

test('one connected mobile route retains its full extent across real speed-segment boundaries', () => {
  const segments = [
    segment(0, [230, 229], [202, 195]), segment(1, [202, 195], [175, 161]),
    segment(2, [175, 161], [148, 126]), segment(3, [148, 126], [121, 92]),
  ];
  const routes = connectedRouteVectorGeometry(segments);
  expect(routes).toHaveLength(1);
  expect(routes[0].bounds).toEqual({ x: 121, y: 92, width: 109, height: 137 });
  expect(routes[0].segmentIndices).toEqual([0, 1, 2, 3]);
  expect(routes[0].connections).toHaveLength(3);
  expect(routes.filter(({ bounds }) => bounds.width > 30 && bounds.height > 10)).toHaveLength(1);
});

test('unrelated short vectors cannot manufacture a large whole-route extent', () => {
  const routes = connectedRouteVectorGeometry([
    segment(0, [0, 0], [20, 6]), segment(1, [20.001, 6], [40.001, 12]),
  ]);
  expect(routes).toHaveLength(2);
  expect(routes.filter(({ bounds }) => bounds.width > 30 && bounds.height > 10)).toHaveLength(0);
});

test('reversed and out-of-order segments connect only through exact shared endpoints', () => {
  const routes = connectedRouteVectorGeometry([
    segment(0, [0, 0], [10, 10]), segment(2, [30, 30], [20, 20]),
    segment(1, [10, 10], [20, 20]),
  ]);
  expect(routes).toHaveLength(1);
  expect(routes[0].segmentIndices).toEqual([0, 1, 2]);
  expect(routes[0].connections).toHaveLength(2);
});

test('equal local endpoints in different SVG coordinate spaces do not prove continuity', () => {
  const routes = connectedRouteVectorGeometry([
    segment(0, [0, 0], [20, 6], 'svg:0'), segment(1, [20, 6], [40, 12], 'svg:1'),
  ]);
  expect(routes).toHaveLength(2);
});

test('a degenerate native path cannot become route-vector evidence', () => {
  expect(() => connectedRouteVectorGeometry([segment(0, [0, 0], [0, 0])]))
    .toThrow('finite nondegenerate native geometry');
});
