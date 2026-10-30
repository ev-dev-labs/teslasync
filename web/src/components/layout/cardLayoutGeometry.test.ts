import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditCardGeometry, collectCardGeometry, type CardGeometry } from '../../../e2e/cardLayoutGeometry';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function card(overrides: Partial<CardGeometry> = {}): CardGeometry {
  return {
    label: 'Chart', group: 0, box: { x: 0, y: 0, width: 400, height: 400 },
    header: { x: 16, y: 16, width: 368, height: 44 },
    title: { x: 16, y: 16, width: 200, height: 24 },
    actions: { x: 340, y: 16, width: 44, height: 44 },
    content: { x: 16, y: 80, width: 368, height: 300 },
    stats: [], empty: null, ...overrides,
  };
}
const neighbor = (overrides: Partial<CardGeometry> = {}) => card({
  label: 'Sibling', box: { x: 416, y: 0, width: 400, height: 400 }, ...overrides,
});

describe('shared card layout geometry guard', () => {
  it('does not report populated nested grid sections as blank space in their surrounding stacked card sequence', () => {
    document.body.innerHTML = `<section data-box="0,0,400,1000">
      <div data-surface-variant="standalone" data-box="0,0,400,200">Summary</div>
      <div style="display:grid" data-box="0,224,400,424">
        <div id="nested-observations" data-surface-variant="standalone" data-box="0,224,400,200">Populated observations</div>
        <div id="nested-history" data-surface-variant="standalone" data-box="0,448,400,200">Populated history</div>
      </div>
      <div id="following-source" data-surface-variant="standalone" data-box="0,672,400,200">Source directory</div>
    </section>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
    document.getElementById('nested-observations')!.dataset.box = '0,420,400,200';
    document.getElementById('nested-history')!.dataset.box = '0,644,400,200';
    document.getElementById('following-source')!.dataset.box = '0,868,400,200';
    expect(auditCardGeometry(collectCardGeometry()))
      .toContainEqual({ kind: 'blank-gap', cards: ['Summary', 'Populated observations'], difference: 220 });
  });

  it('compares a genuine annotated column allocation without treating its retained preface as vertical card displacement', () => {
    document.body.innerHTML = `<div style="display:grid" data-box="0,0,820,600">
      <div data-surface-variant="standalone" data-box="0,0,400,600">Main source</div>
      <section data-card-stretch="column" data-box="420,0,400,600">
        <p data-box="420,0,400,84">Retained setup scope</p>
        <div data-surface-variant="standalone" data-box="420,84,400,516">Secondary source</div>
      </section>
    </div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
    document.querySelector<HTMLElement>('[data-surface-variant="standalone"]:last-child')!.dataset.box = '420,84,400,300';
    expect(auditCardGeometry(collectCardGeometry()))
      .toContainEqual({ kind: 'blank-gap', cards: ['Secondary source'], difference: 216 });
    document.querySelector<HTMLElement>('[data-surface-variant="standalone"]:last-child')!.dataset.box = '420,84,400,600';
    expect(auditCardGeometry(collectCardGeometry()))
      .toContainEqual({ kind: 'row-alignment', cards: ['Secondary source'], difference: 84 });
    document.querySelector<HTMLElement>('[data-surface-variant="standalone"]:last-child')!.dataset.box = '420,84,400,516';
    document.querySelector<HTMLElement>('[data-card-stretch="column"]')!.dataset.box = '420,24,400,600';
    expect(auditCardGeometry(collectCardGeometry()))
      .toContainEqual({ kind: 'row-alignment', cards: ['Main source', 'Secondary source'], difference: 24 });
  });

  it('rejects a collapsed chart allocation whose viewport and SVG spill across later cards', () => {
    const collapsed = card({
      box: { x: 0, y: 0, width: 400, height: 198 },
      charts: [{
        label: 'Power profile',
        container: { x: 0, y: 0, width: 400, height: 198 },
        frame: { x: 16, y: 180, width: 368, height: 0 },
        plot: { x: 16, y: 180, width: 368, height: 0 },
        viewport: { x: 16, y: 180, width: 368, height: 300 },
        surfaces: [{ x: 16, y: 180, width: 368, height: 300 }],
      }],
    });
    expect(auditCardGeometry([collapsed]).some(hit => hit.kind === 'chart-fit')).toBe(true);
  });
  it('accepts contained chart frames and catches a Recharts surface escaping an otherwise valid viewport', () => {
    const frame = { x: 16, y: 80, width: 368, height: 300 };
    const chart = { label: 'Recorded plot', container: card().box, frame, plot: frame, viewport: frame, surfaces: [frame] };
    expect(auditCardGeometry([card({ charts: [chart] })])).toEqual([]);
    expect(auditCardGeometry([card({ charts: [{ ...chart, surfaces: [{ ...frame, height: 340 }] }] })]))
      .toContainEqual({ kind: 'chart-fit', cards: ['Chart', 'Recorded plot surface'], difference: 40 });
    expect(auditCardGeometry([card({ charts: [{ ...chart, surfaces: [{ ...frame, height: 302 }] }] })])).toEqual([]);
  });
  it('distinguishes actual internal scrolling from visible frame spill without exempting chart internals', () => {
    document.body.innerHTML = `<div data-surface-variant="standalone" data-box="0,0,400,250">
      <div id="scrolling" style="overflow-y:auto" data-box="0,0,400,150">
        <figure data-chart-variant="embedded" data-box="16,300,368,300">
          <div data-chart-body data-box="16,300,368,300">
            <div data-chart-viewport data-box="16,300,368,300"><svg class="recharts-surface"></svg></div>
          </div>
        </figure>
      </div></div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    const scroll = document.getElementById('scrolling')!;
    Object.defineProperties(scroll, { scrollHeight: { value: 600 }, clientHeight: { value: 150 } });
    expect(collectCardGeometry()[0].charts).toHaveLength(1);
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
    scroll.style.overflowY = 'visible';
    expect(auditCardGeometry(collectCardGeometry()).some(hit => hit.kind === 'chart-fit')).toBe(true);
  });
  it('accepts equal-height rows, wrapped right-aligned actions and independent stacked rows', () => {
    expect(auditCardGeometry([card(), neighbor()])).toEqual([]);
    expect(auditCardGeometry([card(), neighbor({ box: { x: 0, y: 424, width: 400, height: 200 } })])).toEqual([]);
    expect(auditCardGeometry([card({ header: { x: 16, y: 16, width: 368, height: 90 },
      title: { x: 16, y: 16, width: 368, height: 24 },
      actions: { x: 340, y: 62, width: 44, height: 44 } })])).toEqual([]);
  });
  it('detects an unstretched wrapper leaving a large hole below a shorter sibling', () => {
    expect(auditCardGeometry([card(), neighbor({ box: { x: 416, y: 0, width: 400, height: 180 } })]))
      .toContainEqual({ kind: 'blank-gap', cards: ['Chart', 'Sibling'], difference: 220 });
  });
  it('detects vertically displaced same-row cards without combining independent section groups', () => {
    const shifted = neighbor({ box: { x: 416, y: 24, width: 400, height: 400 } });
    expect(auditCardGeometry([card(), shifted]))
      .toContainEqual({ kind: 'row-alignment', cards: ['Chart', 'Sibling'], difference: 24 });
    expect(auditCardGeometry([card(), { ...shifted, group: 1 }])).toEqual([]);
  });
  it('accepts naturally packed CSS columns but detects a hole within a masonry column', () => {
    const first = card({ flow: 'masonry' });
    const short = neighbor({ flow: 'masonry', box: { x: 416, y: 0, width: 400, height: 180 } });
    const next = neighbor({ flow: 'masonry', box: { x: 416, y: 204, width: 400, height: 180 } });
    expect(auditCardGeometry([first, short, next])).toEqual([]);
    expect(auditCardGeometry([first, short, { ...next, box: { ...next.box, y: 400 } }]))
      .toContainEqual({ kind: 'blank-gap', cards: ['Sibling', 'Sibling'], difference: 220 });
  });
  it('detects left-aligned header actions and controls below their owning header', () => {
    expect(auditCardGeometry([card({ actions: { x: 16, y: 16, width: 44, height: 44 } })])[0].kind).toBe('header-actions');
    expect(auditCardGeometry([card({ actions: { x: 340, y: 100, width: 44, height: 44 } })])[0].kind).toBe('header-actions');
    expect(auditCardGeometry([card({ header: { x: 16, y: 16, width: 368, height: 90 },
      actions: { x: 340, y: 40, width: 44, height: 44 } })])[0].kind).toBe('header-actions');
  });
  it('detects mismatched statistics grids and plot starting offsets', () => {
    const first = card({ stats: [{ x: 16, y: 64, width: 180, height: 40 }] });
    const second = neighbor({
      stats: [{ x: 432, y: 90, width: 120, height: 40 }],
      content: { x: 432, y: 148, width: 368, height: 220 },
    });
    expect(auditCardGeometry([first, second]).map(hit => hit.kind)).toEqual(['content-offset', 'stats-grid']);
  });
  it('detects top-aligned short empty content instead of centered remaining space', () => {
    expect(auditCardGeometry([card({ empty: { x: 16, y: 80, width: 368, height: 40 } })])[0].kind).toBe('empty-centering');
  });
  it('measures a nested evidence column against its own allocation, not unrelated neighboring content', () => {
    document.body.innerHTML = `<div data-surface-variant="standalone" data-box="0,0,400,500">
      <div data-card-content data-box="0,0,400,500">
        <section data-box="0,0,180,60"><h3 data-box="0,0,180,30">Evidence</h3><div data-empty-state data-box="0,30,180,30">Unknown</div></section>
        <section data-box="200,0,180,500">Independent long observations</section>
      </div></div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    const cards = collectCardGeometry();
    expect(cards[0].emptyArea).toMatchObject({ y: 30, height: 30 });
    expect(auditCardGeometry(cards)).toEqual([]);
  });
  it('still flags a short empty source at the top of a genuinely allocated chart viewport', () => {
    const plot = { x: 16, y: 80, width: 368, height: 300 };
    expect(auditCardGeometry([card({ content: plot, emptyArea: plot, empty: { ...plot, height: 21 } })]))
      .toContainEqual({ kind: 'empty-centering', cards: ['Chart'], difference: 140 });
  });
  it('retains the nearest meaningful empty allocation when a transparent outer wrapper also contains summaries', () => {
    document.body.innerHTML = `<div data-surface-variant="standalone" data-box="0,0,400,700">
      <div data-card-content data-box="0,0,400,700"><div data-box="0,0,400,700">
        <div data-box="0,0,400,400">Returned coverage summary</div>
        <div data-empty-state data-box="0,412,400,200">No individual coverage returned</div>
        <p data-box="0,624,400,76">Source units and raw details remain below.</p>
      </div></div></div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    expect(collectCardGeometry()[0].emptyArea).toMatchObject({ y: 400, height: 224 });
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
  });

  it('recognizes a gapless side column without excusing real gaps or unstretched row cards', () => {
    document.body.innerHTML = `<div style="display:grid" data-box="0,0,820,1200">
      <div data-surface-variant="standalone" data-box="0,0,400,1200">Export wizard</div>
      <div data-box="420,0,400,1200">
        <div data-surface-variant="standalone" data-box="420,0,400,200">Overview</div>
        <div id="next-card" data-surface-variant="standalone" data-box="420,220,400,180">Formats</div>
      </div></div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
    document.getElementById('next-card')!.dataset.box = '420,420,400,180';
    expect(auditCardGeometry(collectCardGeometry()))
      .toContainEqual({ kind: 'blank-gap', cards: ['Overview', 'Formats'], difference: 220 });
    expect(auditCardGeometry([card(), neighbor({ box: { x: 416, y: 0, width: 400, height: 180 } })]))
      .toContainEqual({ kind: 'blank-gap', cards: ['Chart', 'Sibling'], difference: 220 });
  });
  it('checks a card-plus-empty column as an allocation while retaining physical-card checks', () => {
    document.body.innerHTML = `<div style="display:grid" data-box="0,0,820,624">
      <div data-surface-variant="standalone" data-box="0,0,400,624"><div data-card-content data-box="0,80,400,531">Journey scenario</div></div>
      <section data-card-slot="column" style="display:flex;flex-direction:column" data-box="420,0,400,624">
        <section data-box="420,0,400,278"><div data-surface-variant="standalone" data-box="420,0,400,278"><div data-card-content data-box="420,80,400,198">Cost source</div></div></section>
        <div id="empty-source" data-empty-state data-box="420,278,400,346">Plan a route to compare costs.</div>
      </section></div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    const measured = collectCardGeometry();
    expect(measured).toHaveLength(3);
    expect(measured.find(card => card.label === 'Cost source')?.box.height).toBe(278);
    expect(auditCardGeometry(measured)).toEqual([]);
    document.getElementById('empty-source')!.dataset.box = '420,278,400,198';
    expect(auditCardGeometry(collectCardGeometry()).some(hit => hit.kind === 'empty-centering' && hit.difference === 74)).toBe(true);
  });
  it('does not mistake independent page controls and nested card grids for one flat masonry column', () => {
    document.body.innerHTML = `<div data-box="0,0,400,1400">
      <div data-surface-variant="standalone" data-box="0,0,400,200">Comparison prerequisite</div>
      <header data-box="0,200,400,150">Independent vehicle selectors and scope controls</header>
      <div style="display:grid" data-box="0,400,400,500">
        <div data-surface-variant="standalone" data-box="0,400,400,200">First vehicle</div>
        <div data-surface-variant="standalone" data-box="0,624,400,200">Second vehicle</div>
      </div>
      <div data-surface-variant="standalone" data-box="0,1000,400,200">Source and model disclosures</div>
    </div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
  });
  it('accepts a card-only side rail that contains a nested preview-card grid', () => {
    document.body.innerHTML = `<div style="display:grid" data-box="0,0,820,1400">
      <div data-surface-variant="standalone" data-box="0,0,500,1400">Export wizard</div>
      <div data-box="520,0,300,1400">
        <section><div data-surface-variant="standalone" data-box="520,0,300,200">Overview</div></section>
        <div style="display:grid" data-box="520,220,300,420">
          <div data-surface-variant="standalone" data-box="520,220,300,200">CSV preview</div>
          <div data-surface-variant="standalone" data-box="520,440,300,200">JSON preview</div>
        </div>
      </div></div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.box ?? '').split(',').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
    });
    expect(auditCardGeometry(collectCardGeometry())).toEqual([]);
  });
});
