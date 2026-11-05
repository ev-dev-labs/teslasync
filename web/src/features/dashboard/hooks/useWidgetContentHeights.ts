import { useEffect, useState, type RefObject } from 'react';
import type { WidgetInstance } from '../widgets/types';

/** Observe the intrinsic panel, never the grid-sized outer item. */
export function useWidgetContentHeights(
  root: RefObject<HTMLElement | null>, widgets: WidgetInstance[], dashboardId: string,
) {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let panels: HTMLElement[] = [];
    const measure = () => {
      frame = 0;
      const next = new Map<string, number>();
      for (const panel of panels) {
        const id = panel.parentElement?.dataset.widgetId;
        if (id && panel.clientWidth > 0 && panel.offsetHeight > 0) next.set(id, panel.offsetHeight);
      }
      setHeights(previous => previous.size === next.size
        && [...next].every(([id, height]) => previous.get(id) === height) ? previous : next);
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    const connectPanels = () => {
      const next = [...element.querySelectorAll<HTMLElement>('[data-widget-id] > .widget-panel')];
      if (next.length === panels.length && next.every((panel, index) => panel === panels[index])) return;
      panels.filter(panel => !next.includes(panel)).forEach(panel => observer.unobserve(panel));
      next.filter(panel => !panels.includes(panel)).forEach(panel => observer.observe(panel));
      panels = next;
      measure();
    };
    // RGL may replace an item after its own layout effect; keep observers
    // attached to the live panels rather than their discarded DOM nodes.
    const mutations = new MutationObserver(connectPanels);
    mutations.observe(element, { childList: true, subtree: true });
    connectPanels();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, widgets, dashboardId]);
  return heights;
}
