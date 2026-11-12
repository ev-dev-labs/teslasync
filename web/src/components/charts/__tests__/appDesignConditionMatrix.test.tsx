import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import postcss, { type Rule } from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { RangeProjection } from '@/api/hooks/useAnalytics';
import { RangeMatrix } from '@/features/battery/components/projected-range-modernization/RangeMatrix';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '../../ui/app-designs/designs';

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: { distance: 'km' } }) }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({ fmtNumber: String }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

const sheet = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'charts.css'), 'utf8'));
const rules: Rule[] = [];
sheet.walkRules(rule => { if (rule.nodes.some(node => node.type === 'decl')) rules.push(rule); });
function selectors(rule: Rule): string[] {
  if (rule.parent?.type !== 'rule') return rule.selectors;
  return selectors(rule.parent).flatMap(parent => rule.selectors.map(selector =>
    selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`));
}
const compiledRules = rules.map(rule => ({ rule, selector: selectors(rule).join(',') }));
function matching(node: Element) {
  return compiledRules.filter(({ selector }) => node.matches(selector)).map(({ rule }) => rule);
}
function mode(rule: Rule): string | undefined {
  return rule.parent?.type === 'rule' ? rule.parent.selector.match(/\[data-app-chart="([^"]+)"\]/)?.[1] : undefined;
}
function setProfile(host: HTMLElement, pack: typeof PACK_IDS[number]) {
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
}
const data: RangeProjection = {
  current_range_km: 300, projected_range_km: 280, battery_level: 50,
  current_battery_pct: 50, usable_capacity_wh: 60_000, health_factor: 0.95,
  efficiency_factor: 0.92, projection_curve: [], tesla_estimate_km: 300,
  your_estimate_km: 280, accuracy_note: '', factors: [], scenarios: [],
  efficiency_matrix: [
    { temp_bucket: 'freezing', speed_bucket: 'city', wh_km: 0, samples: 0 },
    { temp_bucket: 'cold', speed_bucket: 'suburban', wh_km: 160, samples: 2 },
    { temp_bucket: 'mild', speed_bucket: 'suburban', wh_km: 200, samples: 3 },
    { temp_bucket: 'hot', speed_bucket: 'highway', wh_km: 250, samples: 4 },
    { temp_bucket: 'hot', speed_bucket: 'city', wh_km: NaN, samples: NaN },
  ],
};
function Matrix() {
  return <RangeMatrix source={deriveDataState({ data, isSuccess: true })} loading={false} />;
}
function nativeAnatomy(matrix: Element) {
  return [...matrix.querySelectorAll('*')].map(node => ({
    tag: node.tagName, classes: node.className, text: node.textContent, style: node.getAttribute('style'),
  }));
}
let release = () => {};
afterEach(() => {
  release();
  release = () => {};
  cleanup();
});

describe('native condition-matrix chart consumers', () => {
  it('keeps every qualified matrix rule screen-only and final-target owned', () => {
    const qualified = rules.filter(rule => rule.selector.includes('[data-chart-family="condition-matrix"]')
      && !rule.selector.includes(':not('));
    expect(qualified.length).toBeGreaterThan(0);
    for (const rule of qualified) {
      expect(rule.parent?.parent).toMatchObject({ type: 'atrule', name: 'media', params: 'screen and (forced-colors: none)' });
      for (const selector of rule.selectors) {
        expect(selector).toMatch(/:where\(\[data-app-design-owner(?:~="chart-(?:precision|editorial|instrument|soft|geometric)")?\]\)$/);
      }
    }
  });

  it.each(PACK_IDS)('%s consumes real rows/cells/text without changing native geometry or semantic paint', async pack => {
    const view = render(<section data-app-design-preview=""><Matrix /></section>);
    const host = view.container.firstElementChild as HTMLElement;
    const matrix = host.querySelector('[data-chart-family="condition-matrix"]')!;
    const baseline = nativeAnatomy(matrix);
    const evidence = JSON.stringify(data);
    setProfile(host, pack);
    release = observeAppDesignScopes(host);
    await Promise.resolve();
    const expectedMode = APPLICATION_DESIGNS[pack].chart;
    const rows = [...matrix.querySelectorAll('[data-chart-matrix-row]')];
    expect(rows.map(row => row.querySelector('[data-chart-matrix-label]')?.textContent))
      .toEqual(['Freezing', 'Cold', 'Mild', 'Hot']);
    expect(matrix.querySelector('[data-chart-scale]')).toHaveClass('grid', 'grid-cols-3', 'gap-2', 'px-3');
    for (const row of rows) {
      expect(row).toHaveClass('p-3', 'border');
      expect(row.querySelectorAll('[data-chart-matrix-cell]')).toHaveLength(3);
      expect(matching(row).some(rule => mode(rule) === expectedMode
        && rule.selector.includes('[data-chart-family="condition-matrix"]')
        && rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-color'))).toBe(true);
    }
    const cells = [...matrix.querySelectorAll('[data-chart-matrix-cell]')];
    expect(cells).toHaveLength(12);
    expect(cells[0]).toHaveTextContent(/^0\(0\)$/);
    expect(cells[1]).toHaveTextContent(/^—$/);
    expect(cells[9]).toHaveTextContent(/^—\(—\)$/);
    for (const [index, tone] of [[0, 'success'], [4, 'info'], [7, 'warning'], [11, 'danger']] as const) {
      expect(cells[index].className).toContain(`bg-[var(--semantic-${tone}-bg)]`);
    }
    expect(cells[1].className).toContain('bg-[var(--surface-2)]');
    for (const cell of cells) {
      expect(cell.parentElement).toHaveClass('grid', 'grid-cols-3', 'gap-2');
      expect(cell).toHaveClass('p-2');
      expect(matching(cell).some(rule => mode(rule) === expectedMode && rule.selector.includes('[data-chart-matrix-cell]'))).toBe(true);
    }
    for (const slot of matrix.querySelectorAll('[data-chart-readout], [data-chart-metadata], [data-chart-scale]')) {
      expect(matching(slot).some(rule => mode(rule) === expectedMode
        && rule.selector.includes('[data-chart-family="condition-matrix"]')
        && rule.nodes.some(node => node.type === 'decl' && node.prop === 'font-family'))).toBe(true);
    }
    for (const node of [matrix, ...matrix.querySelectorAll('*')]) {
      for (const rule of matching(node)) {
        for (const declaration of rule.nodes) {
          if (declaration.type !== 'decl') continue;
          expect([
            'min-inline-size', 'max-inline-size', 'color', 'overflow-wrap',
            'font-family', 'font-variant-numeric', 'border-color', 'border-radius',
          ], `${pack}: ${rule.selector}`).toContain(declaration.prop);
        }
      }
    }
    expect(nativeAnatomy(matrix)).toEqual(baseline);
    expect(JSON.stringify(data)).toBe(evidence);
  });

  it('honors nearest complete ownership and leaves incomplete/default/widget/public matrices neutral', async () => {
    const view = render(<>
      <section data-app-design-preview="" data-testid="outer"><Matrix />
        <section data-app-design-preview="" data-testid="nested"><Matrix /></section>
        <section data-app-design-preview="" data-app-design-pack="classic" data-app-chart="precision" data-testid="incomplete"><Matrix /></section>
        <section data-app-design-preview="" data-testid="default"><Matrix /></section>
      </section>
      <section data-testid="widget" data-widget-design-pack="blueprint"><Matrix /></section>
      <section data-testid="public"><Matrix /></section>
    </>);
    const outer = view.getByTestId('outer');
    const nested = view.getByTestId('nested');
    release = observeAppDesignScopes(outer);
    for (const pack of PACK_IDS) {
      setProfile(outer, pack);
      const expected = APPLICATION_DESIGNS[pack].chart;
      const other = PACK_IDS.find(id => APPLICATION_DESIGNS[id].chart !== expected)!;
      setProfile(nested, other);
      await Promise.resolve();
      for (const [host, expectedMode] of [[outer, expected], [nested, APPLICATION_DESIGNS[other].chart]] as const) {
        const row = host.querySelector('[data-chart-matrix-row]')!;
        expect(new Set(matching(row).map(mode).filter(Boolean))).toEqual(new Set([expectedMode]));
        row.removeAttribute('data-app-design-owner');
        expect(matching(row)).toEqual([]);
        release();
        release = observeAppDesignScopes(outer);
      }
      for (const name of ['incomplete', 'default', 'widget', 'public']) {
        const matrix = view.getByTestId(name).querySelector('[data-chart-family="condition-matrix"]')!;
        for (const target of [matrix, ...matrix.querySelectorAll('*')]) expect(matching(target)).toEqual([]);
      }
    }
  });
});
