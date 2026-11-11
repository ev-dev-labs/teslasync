// @vitest-environment node
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { InlineMetric } from '@/components/data-display/InlineMetric';
import { HistoryListRow } from '@/components/data-display/HistoryListRow';
import { MetricBar } from '@/components/data-display/MetricBar';
import { ProgressRing } from '@/components/data-display/ProgressRing';
import { CompositionRail } from '@/components/data-display/CompositionRail';
import { ScoreBadge } from '@/components/data-display/ScoreBadge';
import { SegmentedMeter } from '@/components/data-display/SegmentedMeter';
import { StatCard } from '@/components/data-display/StatCard';
import { UsageCard } from '@/components/data-display/UsageCard';
import { Checkbox } from '@/components/ui/Checkbox';
import { RadioCard } from '@/components/ui/RadioCard';
import { Toggle } from '@/components/ui/Toggle';
import { Table } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { getAppDesignAttributes, observeAppDesignScopes } from '../designs';

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const packs = ['warm', 'swiss', 'material', 'glass', 'deco', 'kinetic', 'brutal', 'cyber', 'memphis'] as const;
const unsafe = /^(?:display|flex(?:-.+)?|grid(?:-.+)?|gap|(?:row|column)-gap|padding(?:-.+)?|margin(?:-.+)?|border(?:-.+)?|background(?:-.+)?|box-shadow|text-align|align-self|max-inline-size)$/;

function fixture(pack: typeof packs[number]) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) doc.documentElement.setAttribute(name, value);
  doc.body.innerHTML = renderToStaticMarkup(
    <>
      <StatCard label="Ordinary stat" value={25} />
      <UsageCard
        bands={[{ label: 'Warning band', value: 25, intent: 'warn' }]}
        details={[{ label: 'Nested reading', value: <MetricBar value={50} max={100} color="var(--semantic-info)" label="Nested bar" /> }]}
      />
      <HistoryListRow primary="History" metrics={<InlineMetric icon={null} value={12} label="Distance" />} hideChevron />
      <MetricBar value={25} max={100} color="var(--semantic-success)" label="Known" />
      <MetricBar value={null} max={100} color="var(--semantic-warning)" label="Unknown" />
      <ProgressRing value={25} color="var(--semantic-info)" label="Range" />
      <CompositionRail summary="Composition" segments={[
        { id: 'known', label: 'Known', widthPercent: 40, color: 'var(--semantic-success)' },
        { id: 'unknown', label: 'Unknown', widthPercent: 0, color: 'var(--text-muted)', hideFromTrack: true },
      ]} />
      <ScoreBadge score={75} />
      <SegmentedMeter value={25} color="var(--semantic-warning)" label="Segments" />
      <Checkbox label="Choice" checked onChange={() => {}} />
      <RadioCard value="choice" label="Radio choice" checked onChange={() => {}} />
      <Toggle label="Enabled" checked onChange={() => {}} />
      <Card variant="embedded" data-app-part="metric" data-app-metric="card">
        <span data-app-part="metric-label">Embedded</span>
        <span data-app-part="metric-value">12</span>
      </Card>
      <Card variant="embedded">Embedded panel</Card>
    </>,
  );
  // These are also real production track roots, not MetricBar's outer wrapper.
  doc.body.insertAdjacentHTML('beforeend', `
    <div data-app-part="metric" data-app-metric="bar" data-metric-track role="progressbar" aria-valuenow="25" style="height:6px;background:var(--track)">
      <div data-metric-fill style="height:100%;width:25%;background:var(--semantic-success)"></div>
    </div>
    <div data-app-part="metric" data-app-metric="bar" data-metric-track role="progressbar" aria-valuetext="Unknown" style="height:6px;background:var(--track)"></div>
    <div data-app-part="list conversation-log" data-app-list="conversation" role="log">
      <div data-app-part="card conversation-bubble" data-app-card-kind="conversation" style="background:var(--surface-2)">
        <div data-app-part="metric-grid"><div>Message content</div></div>
        <ul data-app-part="list"><li data-app-part="list-row">Answer item</li></ul>
      </div>
    </div>
  `);
  doc.querySelector('[data-app-card-kind="conversation"]')!.insertAdjacentHTML('beforeend',
    renderToStaticMarkup(<Table><thead data-app-part="table-head"><tr data-app-part="table-row"><th data-app-part="table-cell">Reading</th></tr></thead><tbody><tr data-app-part="table-row" aria-selected="true"><td data-app-part="table-cell">25</td></tr></tbody></Table>),
  );
  const release = observeAppDesignScopes(doc.documentElement);
  const rules: postcss.Rule[] = [];
  postcss.parse(readFileSync(new URL(`./${pack}.css`, import.meta.url), 'utf8')).walkRules(rule => { rules.push(rule); });
  const declarations = (element: Element) => rules.filter(rule => element.matches(rule.selector))
    .flatMap(rule => rule.nodes.filter((node): node is postcss.Declaration => node.type === 'decl')
      .map(node => ({ property: node.prop, value: node.value, selector: rule.selector })));
  return {
    doc,
    declarations,
    unsafeDeclarations: (element: Element) => declarations(element).filter(({ property }) => unsafe.test(property)),
    dispose: () => { release(); dom.window.close(); },
  };
}

describe.each(packs)('Pack C primitive preservation: %s', pack => {
  it('keeps quantitative geometry and inline history banks native while still designing ordinary stats', () => {
    const view = fixture(pack);
    try {
      const { doc } = view;
      const specialized = doc.querySelectorAll(
        '[data-app-metric="inline"], [data-app-metric-grid="inline"], [data-app-metric="bar"], [data-app-metric="ring"], [data-app-metric="composition"], [data-app-metric="score"], [data-app-metric="segments"], [data-metric-track], [data-metric-fill]',
      );
      for (const element of specialized) {
        expect(view.unsafeDeclarations(element), element.outerHTML).toEqual([]);
        for (const child of element.querySelectorAll('[data-app-part~="metric-label"], [data-app-part~="metric-value"], [data-app-list="legend"], [data-app-part~="list-row"]')) {
          expect(view.unsafeDeclarations(child), child.outerHTML).toEqual([]);
        }
      }
      expect(doc.querySelector('[data-app-metric="bar"][data-app-state="missing"] [data-metric-fill]')).toBeNull();
      expect(doc.querySelector('[data-metric-track][aria-valuetext="Unknown"] [data-metric-fill]')).toBeNull();
      expect(view.declarations(doc.querySelector('[data-app-metric="stat-card"]')!).some(({ property }) => property === 'padding')).toBe(true);
      expect(view.declarations(doc.querySelector('[data-app-part~="metric-grid"]:not([data-app-metric-grid="inline"])')!)
        .some(({ property, value }) => property === 'display' && value === 'grid')).toBe(true);
    } finally { view.dispose(); }
  });

  it('leaves conversation bubbles, transcript lists and Markdown tables at their own geometry and paint', () => {
    const view = fixture(pack);
    try {
      const transcript = view.doc.querySelector('[data-app-list="conversation"]')!;
      for (const element of [transcript, ...transcript.querySelectorAll('[data-app-part]')]) {
        expect(view.unsafeDeclarations(element), element.outerHTML).toEqual([]);
      }
    } finally { view.dispose(); }
  });

  it('preserves embedded metric surfaces, semantic tile paint and actual native choice hit targets', () => {
    const view = fixture(pack);
    try {
      for (const root of view.doc.querySelectorAll('[data-surface-variant="embedded"], [data-app-field-kind="choice"]')) {
        expect(view.unsafeDeclarations(root), root.outerHTML).toEqual([]);
        for (const child of root.querySelectorAll('[data-app-part~="metric-label"], [data-app-part~="metric-value"], [data-app-part~="field-label"], [data-app-part~="field-control"]')) {
          expect(view.unsafeDeclarations(child), child.outerHTML).toEqual([]);
        }
      }
      expect(view.declarations(view.doc.querySelector('[data-app-tone="warning"]')!)
        .filter(({ property }) => /^(?:background|border)/.test(property))).toEqual([]);
    } finally { view.dispose(); }
  });
});
