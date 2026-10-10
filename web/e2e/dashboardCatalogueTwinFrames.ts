import type { Locator } from '@playwright/test';

export async function captureCatalogueTwinFrames(panel: Locator, chargingMode: boolean) {
  return panel.evaluate(async (element, charging) => {
    const sentry = element.querySelector<SVGEllipseElement>('ellipse[cx="320"][cy="91"]');
    const charge = element.querySelector<SVGEllipseElement>('ellipse[cx="298"][cy="255"]');
    const main = element.closest('main');
    const widget = element.closest('[data-widget-id]');
    if (!sentry || (charging && !charge) || !main || !widget) {
      throw new Error('Missing active twin geometry or scroll/grid ancestors');
    }
    const nodes = [sentry, ...(charging && charge ? [charge] : [])];
    const measure = (node: Element) => {
      const rect = node.getBoundingClientRect();
      const css = getComputedStyle(node);
      return {
        tag: node.tagName, className: node.getAttribute('class'), inlineStyle: node.getAttribute('style'),
        transformAttribute: node.getAttribute('transform'),
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          width: rect.width, height: rect.height, centerX: rect.x + rect.width / 2,
          centerY: rect.y + rect.height / 2 },
        clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
        clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        css: {
          height: css.height, minHeight: css.minHeight, maxHeight: css.maxHeight,
          overflowX: css.overflowX, overflowY: css.overflowY,
          display: css.display, position: css.position, flex: css.flex,
          transform: css.transform, transformOrigin: css.transformOrigin,
          transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration,
          transitionDelay: css.transitionDelay, animationName: css.animationName,
          animationDuration: css.animationDuration, animationDelay: css.animationDelay,
          animationPlayState: css.animationPlayState,
        },
      };
    };
    const capture = () => ({
      timestampMs: performance.now(), wallTimeMs: Date.now(),
      scroll: { mainTop: main.scrollTop, mainLeft: main.scrollLeft,
        windowX: window.scrollX, windowY: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      headers: [...document.querySelectorAll('header')].map(measure),
      main: measure(main), widget: measure(widget), panel: measure(element),
      innerFrames: nodes.map(node => {
        const ancestors = [];
        let ancestor: Element | null = node;
        while (ancestor && ancestor !== element) {
          ancestors.push(measure(ancestor));
          ancestor = ancestor.parentElement;
        }
        return ancestors;
      }),
      layoutStorage: {
        activeId: localStorage.getItem('teslasync-active-dashboard'),
        rowVersion: localStorage.getItem('teslasync-row-height-version'),
        dashboardsRaw: localStorage.getItem('teslasync-dashboards'),
      },
      nodes: nodes.map(node => {
        const bounds = node.getBoundingClientRect();
        return {
          rx: node.rx.baseVal.value, ry: node.ry.baseVal.value,
          x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
          transform: node.parentElement
            ? `${node.parentElement.getAttribute('transform') ?? ''}:${getComputedStyle(node.parentElement).transform}`
            : '',
          circles: [...element.querySelectorAll<SVGCircleElement>('svg circle')]
            .map(circle => Number(circle.getAttribute('r') ?? Number.NaN)),
        };
      }),
    });
    const frames: ReturnType<typeof capture>[] = [];
    for (let frame = 0; frame < 60; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      frames.push(capture());
    }
    return {
      geometry: frames.map(frame => frame.nodes), frames,
      extrema: nodes.map((_, index) => {
        const xs = frames.map(frame => frame.nodes[index].x);
        const ys = frames.map(frame => frame.nodes[index].y);
        return {
          index, minX: Math.min(...xs), maxX: Math.max(...xs),
          minY: Math.min(...ys), maxY: Math.max(...ys),
          deltaX: Math.max(...xs) - Math.min(...xs), deltaY: Math.max(...ys) - Math.min(...ys),
        };
      }),
    };
  }, chargingMode);
}
