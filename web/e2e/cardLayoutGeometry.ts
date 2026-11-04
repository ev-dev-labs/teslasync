import type { Page } from '@playwright/test';

export interface Box { x: number; y: number; width: number; height: number }
export interface ChartGeometry {
  label: string;
  container: Box;
  frame: Box;
  plot: Box | null;
  viewport: Box | null;
  surfaces: Box[];
}
export interface CardGeometry {
  label: string;
  group: number;
  flow?: 'row' | 'masonry' | 'independent';
  box: Box;
  /** Full row allocation when retained notes and one card form a shared column. */
  allocation?: Box | null;
  allocationContent?: Box[];
  /** Content-box allocation of a transparent native row cell. */
  fill?: Box | null;
  /** Physical surfaces in the complete stack, including nested grid groups. */
  flowMembers?: { label: string; box: Box }[];
  header: Box | null;
  title: Box | null;
  actions: Box | null;
  content: Box | null;
  stats: Box[];
  empty: Box | null;
  emptyArea?: Box | null;
  charts?: ChartGeometry[];
}
export interface CardLayoutViolation {
  kind: 'blank-gap' | 'cell-fill' | 'row-alignment' | 'header-actions' | 'stats-grid' | 'content-offset' | 'empty-centering' | 'chart-fit';
  cards: string[];
  difference: number;
}

/** Geometry only: no route exceptions, CSS class allowlists or data-dependent baselines. */
export function auditCardGeometry(cards: CardGeometry[]): CardLayoutViolation[] {
  const violations: CardLayoutViolation[] = [];
  const bottom = (box: Box) => box.y + box.height;
  const right = (box: Box) => box.x + box.width;
  for (const card of cards) {
    if (card.fill) {
      const difference = Math.max(Math.abs(card.box.y - card.fill.y), Math.abs(bottom(card.box) - bottom(card.fill)));
      if (difference > 4) violations.push({ kind: 'cell-fill', cards: [card.label], difference: Math.round(difference) });
    }
    if (card.allocation) {
      const difference = Math.max(card.allocation.x - card.box.x, card.allocation.y - card.box.y,
        right(card.box) - right(card.allocation), bottom(card.box) - bottom(card.allocation));
      if (difference > 4) violations.push({
        kind: 'row-alignment', cards: [card.label], difference: Math.round(difference),
      });
      const occupied = [card.box, ...(card.allocationContent ?? [])]
        .filter(box => right(box) > card.allocation!.x && box.x < right(card.allocation!))
        .sort((a, b) => a.y - b.y);
      let end = card.allocation.y;
      let gap = 0;
      for (const box of occupied) {
        gap = Math.max(gap, Math.min(box.y, bottom(card.allocation)) - end);
        end = Math.max(end, Math.min(bottom(box), bottom(card.allocation)));
      }
      gap = Math.max(gap, bottom(card.allocation) - end);
      if (gap > 96 && gap > card.allocation.height * 0.2) violations.push({
        kind: 'blank-gap', cards: [card.label], difference: Math.round(gap),
      });
    }
    for (const chart of card.charts ?? []) {
      const allocations: [Box | null, Box, string][] = [
        [chart.frame, chart.container, 'frame'],
        [chart.plot, chart.frame, 'plot'],
        [chart.viewport, chart.plot ?? chart.frame, 'viewport'],
        ...chart.surfaces.map(surface => [surface, chart.viewport ?? chart.frame, 'surface'] as [Box, Box, string]),
      ];
      for (const [child, parent, role] of allocations) {
        if (!child) continue;
        const difference = Math.max(parent.x - child.x, parent.y - child.y,
          right(child) - right(parent), bottom(child) - bottom(parent));
        if (difference > 4) violations.push({
          kind: 'chart-fit', cards: [card.label, `${chart.label} ${role}`], difference: Math.round(difference),
        });
      }
    }
    if (card.flow === 'masonry') {
      const next = [...cards.filter(candidate => candidate.group === card.group), ...(card.flowMembers ?? [])]
        .filter(candidate => Math.abs(candidate.box.x - card.box.x) <= 4 && candidate.box.y > card.box.y)
        .sort((a, b) => a.box.y - b.box.y)[0];
      if (next && next.box.y - bottom(card.box) > 96) {
        violations.push({ kind: 'blank-gap', cards: [card.label, next.label],
          difference: Math.round(next.box.y - bottom(card.box)) });
      }
    }
    if (card.header && card.actions) {
      const gap = right(card.header) - right(card.actions);
      const titleOffset = card.title && card.actions.x >= right(card.title) - 4
        ? Math.abs(card.actions.y - card.title.y) : 0;
      const difference = Math.max(Math.abs(gap), card.header.y - card.actions.y,
        bottom(card.actions) - bottom(card.header), titleOffset);
      if (difference > 4) {
        violations.push({ kind: 'header-actions', cards: [card.label], difference: Math.round(difference) });
      }
    }
    const emptyArea = card.emptyArea ?? card.content;
    if (emptyArea && card.empty && emptyArea.height > card.empty.height + 48) {
      const delta = Math.abs(card.empty.y + card.empty.height / 2 - (emptyArea.y + emptyArea.height / 2));
      if (delta > 24) violations.push({ kind: 'empty-centering', cards: [card.label], difference: Math.round(delta) });
    }
    for (const neighbor of cards) {
      if (neighbor === card || card.group !== neighbor.group || card.box.x >= neighbor.box.x) continue;
      if (card.flow === 'masonry' || card.flow === 'independent') continue;
      // Vertical overlap identifies actual row neighbors, not stacked/mobile cards.
      const first = card.allocation ?? card.box;
      const second = neighbor.allocation ?? neighbor.box;
      if (Math.min(bottom(first), bottom(second)) <= Math.max(first.y, second.y) + 4) continue;
      const topDelta = Math.abs(first.y - second.y);
      if (topDelta > 4) {
        violations.push({ kind: 'row-alignment', cards: [card.label, neighbor.label], difference: Math.round(topDelta) });
        continue;
      }
      const hole = Math.abs(bottom(first) - bottom(second));
      // A three-major-spacing-unit void consuming >20% of its row is not a gutter.
      if (hole > 96 && hole > Math.max(first.height, second.height) * 0.2) {
        violations.push({ kind: 'blank-gap', cards: [card.label, neighbor.label], difference: Math.round(hole) });
      }
      if (card.content && neighbor.content && Math.abs(card.box.width - neighbor.box.width) <= 4) {
        const offset = Math.abs(card.content.y - neighbor.content.y);
        if (offset > 4) violations.push({ kind: 'content-offset', cards: [card.label, neighbor.label], difference: Math.round(offset) });
      }
      if (card.stats.length && card.stats.length === neighbor.stats.length && Math.abs(card.box.width - neighbor.box.width) <= 4) {
        const mismatch = Math.max(...card.stats.map((stat, index) =>
          Math.max(Math.abs(stat.width - neighbor.stats[index].width), Math.abs(stat.y - neighbor.stats[index].y))));
        if (mismatch > 4) violations.push({ kind: 'stats-grid', cards: [card.label, neighbor.label], difference: Math.round(mismatch) });
      }
    }
  }
  return violations;
}

export function collectCardGeometry(): CardGeometry[] {
    const physicalSurface = '[data-surface-variant="standalone"],figure[data-chart-variant="panel"],.widget-panel';
    const column = '[data-card-slot="column"]';
    const surface = `${physicalSurface},${column}`;
    const surfaceCells = (element: Element): Element[] | null => {
      if (element.matches(physicalSurface)) return [element];
      if (element.children.length === 0 || Array.from(element.childNodes).some(
        node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )) return null;
      const children = Array.from(element.children).map(surfaceCells);
      return children.every(Boolean) ? children.flatMap(child => child ?? []) : null;
    };
    const groups: Element[] = [];
    const box = (el: Element | null) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return Array.from(document.querySelectorAll<HTMLElement>(surface)).flatMap(el => {
      const rect = box(el);
      if (!rect || rect.width <= 0 || rect.height <= 0 || el.parentElement?.closest(physicalSurface)
        || el.matches(column) && el.parentElement?.closest(column)) return [];
      let candidate = el.parentElement;
      let group: Element | null = null;
      let rowAllocation: Box | null = null;
      const allocationContent: Box[] = [];
      let flow: 'row' | 'masonry' | 'independent' = 'independent';
      while (candidate && !candidate.matches('main,body')) {
        if (candidate.matches('[data-card-stretch="column"]')) {
          rowAllocation = box(candidate);
          for (const sibling of Array.from(candidate.children)) {
            if (sibling.contains(el)) continue;
            const measured = box(sibling);
            const css = getComputedStyle(sibling);
            const media = 'img,svg,canvas,video,iframe';
            if (measured && !['absolute', 'fixed'].includes(css.position)
              && (sibling.textContent?.trim() || sibling.matches(media) || sibling.querySelector(media))) {
              allocationContent.push(measured);
            }
          }
        }
        const css = getComputedStyle(candidate);
        if (candidate.matches(column)) {
          group = candidate;
          flow = 'masonry';
          break;
        }
        if (Number(css.columnCount) > 1) {
          group = candidate;
          flow = 'masonry';
          break;
        }
        if (candidate.children.length > 1 && !css.display.includes('grid')
          && !(css.display.includes('flex') && css.flexDirection === 'row')) {
          const cells = Array.from(candidate.children).map(surfaceCells);
          const stacked = cells.flatMap(cell => (cell ?? []).flatMap(element => {
            const measured = box(element);
            return measured ? [measured] : [];
          }))
            .sort((a, b) => a.y - b.y);
          if (cells.every(Boolean) && stacked.length > 1 && stacked.every((measured, index) =>
            Math.abs(measured.x - stacked[0].x) <= 4 && Math.abs(measured.width - stacked[0].width) <= 4
            && (index === 0 || measured.y >= stacked[index - 1].y + stacked[index - 1].height - 4))) {
            group = candidate;
            flow = 'masonry';
            break;
          }
        }
        if (css.display.includes('grid') && candidate.children.length > 1
          || css.display.includes('flex') && css.flexDirection === 'row' && candidate.children.length > 1) {
          group = candidate;
          flow = 'row';
          break;
        }
        candidate = candidate.parentElement;
      }
      const grouping = group ?? el;
      if (!groups.includes(grouping)) groups.push(grouping);
      let fill: Box | null = null;
      const cell = el.parentElement;
      if (flow === 'row' && cell?.matches('[data-card-stretch="relay"]') && cell.children.length === 1) {
        const allocation = box(cell);
        if (allocation) {
          const css = getComputedStyle(cell), childCss = getComputedStyle(el);
          const value = (input: string) => Number.parseFloat(input) || 0;
          const top = value(css.paddingTop) + value(css.borderTopWidth) + value(childCss.marginTop);
          const end = value(css.paddingBottom) + value(css.borderBottomWidth) + value(childCss.marginBottom);
          fill = { ...allocation, y: allocation.y + top, height: Math.max(0, allocation.height - top - end) };
        }
      }
      const header = el.querySelector('[data-card-header],header');
      const title = header?.querySelector('h2,h3,h4,[data-card-title]') ?? null;
      const stats = el.querySelector('[data-card-stats],[data-chart-summary]');
      const grid = stats?.querySelector('[data-metric-grid],[data-layout],.grid') ?? stats;
      const content = el.querySelector('[data-chart-viewport]') ?? el.querySelector('[data-card-content],table');
      const figures = [...(el.matches('figure[data-chart-variant]') ? [el] : []),
        ...el.querySelectorAll<HTMLElement>('figure[data-chart-variant]')];
      const charts = figures.flatMap(figure => {
        const frame = box(figure);
        if (!frame) return [];
        let container = document.fullscreenElement === figure ? frame : rect;
        for (let parent = figure.parentElement; parent && parent !== el; parent = parent.parentElement) {
          const css = getComputedStyle(parent);
          if (['auto', 'scroll'].includes(css.overflowY) && parent.scrollHeight > parent.clientHeight + 4) {
            // A real scrolling allocation contains its own content; it is not card spill.
            container = frame;
            break;
          }
        }
        return [{
          label: (document.getElementById(figure.getAttribute('aria-labelledby') ?? '')?.textContent ?? 'Chart').trim(),
          container, frame, plot: box(figure.querySelector('[data-chart-body]')),
          viewport: box(figure.querySelector('[data-chart-viewport]')),
          surfaces: Array.from(figure.querySelectorAll('.recharts-responsive-container,.recharts-wrapper,svg.recharts-surface'))
            .flatMap(element => { const measured = box(element); return measured ? [measured] : []; }),
        }];
      });
      const emptyScope = el.matches(column) ? el : content;
      const empty = emptyScope?.querySelector('[role="status"][data-variant],[data-empty-state]') ?? null;
      const emptyBox = box(empty);
      let allocation = empty?.parentElement;
      while (allocation && allocation !== emptyScope && allocation.parentElement
        && emptyScope?.contains(allocation.parentElement)) {
        const ownChildren = Array.from(allocation.children).filter(child => {
          const style = getComputedStyle(child);
          return box(child) && !['absolute', 'fixed'].includes(style.position);
        });
        if (ownChildren.length !== 1) break;
        const parent = allocation.parentElement;
        const visibleChildren = Array.from(parent.children).filter(child => {
          const style = getComputedStyle(child);
          return box(child) && !['absolute', 'fixed'].includes(style.position);
        });
        if (visibleChildren.length !== 1) break;
        allocation = parent;
      }
      const allocationBox = box(allocation ?? null);
      let emptyArea = allocationBox;
      if (allocation && allocationBox && emptyBox) {
        const css = getComputedStyle(allocation);
        let top = allocationBox.y + (Number.parseFloat(css.paddingTop) || 0);
        let end = allocationBox.y + allocationBox.height - (Number.parseFloat(css.paddingBottom) || 0);
        const gap = Number.parseFloat(css.rowGap) || 0;
        // The empty slot may follow filters/metadata or sit in one evidence column.
        // Its allocation is the remaining local area, not the whole enclosing card.
        for (const sibling of Array.from(allocation.children)) {
          if (sibling === empty) continue;
          const siblingBox = box(sibling);
          const style = getComputedStyle(sibling);
          if (!siblingBox || ['absolute', 'fixed'].includes(style.position)) continue;
          if (siblingBox.x >= emptyBox.x + emptyBox.width || siblingBox.x + siblingBox.width <= emptyBox.x) continue;
          if (siblingBox.y + siblingBox.height <= emptyBox.y) top = Math.max(top, siblingBox.y + siblingBox.height + gap);
          if (siblingBox.y >= emptyBox.y + emptyBox.height) end = Math.min(end, siblingBox.y - gap);
        }
        emptyArea = { ...allocationBox, y: top, height: Math.max(0, end - top) };
      }
      return [{
        label: (title?.textContent ?? el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 100),
        group: groups.indexOf(grouping), flow, box: rect, allocation: rowAllocation, allocationContent, fill,
        flowMembers: flow === 'masonry' && group ? (surfaceCells(group) ?? []).flatMap(member => {
          const measured = box(member);
          return measured ? [{
            label: ((member.querySelector('[data-card-header],header')?.querySelector('h2,h3,h4,[data-card-title]'))?.textContent
              ?? member.getAttribute('aria-label') ?? member.textContent ?? '').trim().slice(0, 100),
            box: measured,
          }] : [];
        }) : [],
        header: box(header), title: box(title),
        actions: box(header?.querySelector('[data-card-actions],[data-chart-toolbar]') ?? el.querySelector('[data-chart-toolbar]')),
        content: box(content), stats: grid ? Array.from(grid.children).flatMap(child => {
          const measured = box(child);
          return measured ? [measured] : [];
        }) : [],
        empty: emptyBox, emptyArea, charts,
      }];
    });
}

export async function measureCardGeometry(page: Page): Promise<CardGeometry[]> {
  return page.evaluate(collectCardGeometry);
}
