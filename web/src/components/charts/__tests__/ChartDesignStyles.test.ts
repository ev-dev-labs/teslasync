import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AnyNode, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '../../ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';

const source = readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'charts.css'), 'utf8');
const sheet = postcss.parse(source);
const leafRules: Rule[] = [];
sheet.walkRules(rule => {
  if (rule.nodes.some(node => node.type === 'decl')) leafRules.push(rule);
});

function contextMode(rule: Rule): string | undefined {
  let owner: AnyNode | undefined = rule;
  while (owner) {
    if (owner.type === 'rule') {
      const mode = owner.selector.match(/\[data-app-chart="([^"]+)"\]/)?.[1];
      if (mode) return mode;
    }
    owner = owner.parent;
  }
  return undefined;
}

function matchingRules(element: Element): Rule[] {
  // Match the final target independently: an ancestor profile cannot supply
  // missing ownership on a vendor descendant or inside another preview.
  return leafRules.filter(rule => element.matches(rule.selector.replace(/^&\s*/, '')));
}

function setProfile(host: HTMLElement, pack: PackId) {
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
}

function appendSpecialistPlots(host: HTMLElement) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-app-part', 'chart-plot');
  svg.setAttribute('data-chart-family', 'speed-heatmap');
  const axes = ['day', 'hour'].map(kind => {
    const axis = document.createElementNS(svg.namespaceURI, 'text');
    axis.setAttribute('data-chart-axis', kind);
    svg.append(axis);
    return axis;
  });
  const speedCell = document.createElementNS(svg.namespaceURI, 'rect');
  svg.append(speedCell);
  host.append(svg);
  const cells = ['active', 'unavailable'].map(state => {
    const cell = document.createElement('div');
    cell.setAttribute('data-chart-family', 'battery-cells');
    cell.setAttribute('data-heatmap-state', state);
    cell.setAttribute('role', 'img');
    host.append(cell);
    return cell;
  });
  return { axes, speedCell, cells };
}

describe('application chart presentation boundary', () => {
  it('leaves unselected, print and forced-color charts to their existing owners', () => {
    let declarations = 0;
    sheet.walkDecls(declaration => {
      declarations++;
      let owner: AnyNode | undefined = declaration.parent;
      const contexts: string[] = [];
      while (owner) {
        if (owner.type === 'atrule') contexts.push(`@${owner.name} ${owner.params}`);
        if (owner.type === 'rule') contexts.push(owner.selector);
        owner = owner.parent;
      }
      expect(contexts).toContain('@media screen and (forced-colors: none)');
      expect(contexts.some(value => value.includes(':is(:root, [data-app-design-preview])[data-app-design-pack]'))).toBe(true);
    });
    expect(declarations).toBeGreaterThan(0);
  });

  it('guards every final target with its nearest complete profile without native scope dependence', () => {
    sheet.walkAtRules(rule => expect(rule.name).not.toBe('scope'));
    sheet.walkRules(rule => {
      expect(rule.selector).not.toContain(':scope');
      const mode = contextMode(rule);
      const guard = mode ? `[data-app-design-owner~="chart-${mode}"]` : '[data-app-design-owner]';
      const guardPattern = guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const selector of rule.selectors) {
        expect(selector, 'ownership belongs on the final compound, before any pseudo-element')
          .toMatch(new RegExp(`:where\\(${guardPattern}\\)(?:::[\\w-]+(?:\\([^)]*\\))?)*$`));
      }
    });
  });

  it('cannot recolor, interpolate, transform or hide a series to create a design', () => {
    sheet.walkRules(rule => {
      expect(rule.selector).not.toMatch(/\.recharts-(?:line-curve|area-area|area-curve|bar-rectangle|sector|scatter-symbol|radar-polygon|dot)\b/);
    });
    sheet.walkDecls(declaration => {
      expect(declaration.prop).not.toMatch(/^(?:opacity|filter|transform|scale|clip-path|visibility|order)$/);
      if (declaration.prop === 'fill') {
        expect(declaration.parent?.type).toBe('rule');
        expect(declaration.parent && 'selector' in declaration.parent ? declaration.parent.selector : '')
          .toMatch(/\.recharts-(?:cartesian-axis-tick-value|brush-texts)\b|svg\[data-chart-family="speed-heatmap"\] text\[data-chart-axis(?:="(?:day|hour)")?\]/);
      }
      expect(declaration.value).not.toBe('none!important');
      if (declaration.prop === 'display') expect(declaration.value).not.toBe('none');
      expect(declaration.prop).not.toMatch(/^(?:height|min-height|max-height|block-size|min-block-size|max-block-size)$/);
    });
  });

  it('does not replace gauge fills, thresholds, heatmap levels or selected series colors', () => {
    sheet.walkRules(rule => {
      if (!/data-chart-gauge-(?:fill|band)|data-chart-family="heatmap"/.test(rule.selector)) return;
      rule.walkDecls(declaration => {
        expect(declaration.prop).not.toMatch(/^(?:background(?:-color|-image)?|color|fill|stroke|width|left|right|inset-inline-start)$/);
      });
    });
    expect(source).not.toMatch(/#[a-f\d]{3,8}\b/i);
  });

  it('treats native speed axes as typography/ink only, never cell paint or SVG geometry', () => {
    const rules = leafRules.filter(rule => rule.selector.includes('data-chart-family="speed-heatmap"'));
    const modes = new Set(rules.map(contextMode));
    expect(modes).toEqual(new Set(Object.values(APPLICATION_DESIGNS).map(design => design.chart)));
    for (const rule of rules) {
      expect(rule.selector).toContain('text[data-chart-axis');
      for (const node of rule.nodes) {
        if (node.type !== 'decl') continue;
        expect(['fill', 'font-family', 'font-variant-numeric']).toContain(node.prop);
        if (node.prop === 'font-family') expect(node.value).toMatch(/^var\(--font-(?:sans|mono)\)$/);
        if (node.prop === 'fill') expect(node.value).toMatch(/^var\(--text-(?:primary|secondary)\)$/);
      }
    }
  });

  it('specializes battery cells without overwriting status backgrounds/borders, icons or font metrics', () => {
    const rules = leafRules.filter(rule => rule.selector.includes('data-chart-family="battery-cells"'));
    expect(new Set(rules.map(contextMode).filter(Boolean)))
      .toEqual(new Set(Object.values(APPLICATION_DESIGNS).map(design => design.chart)));
    for (const rule of rules) {
      expect(rule.selector).toContain('[data-heatmap-state');
      for (const node of rule.nodes) {
        if (node.type !== 'decl') continue;
        expect(['border-radius', 'border-style', 'font-variant-numeric']).toContain(node.prop);
        if (node.prop === 'border-style') {
          expect(rule.selector).toContain('[data-heatmap-state="unavailable"]');
          expect(node.value).toBe('dashed');
        }
      }
    }
  });

  it('activates the actual specialist target selectors for all 27 profiles without leaking across nested previews', async () => {
    const host = document.createElement('section');
    host.setAttribute('data-app-design-preview', '');
    const live = appendSpecialistPlots(host);
    const preview = document.createElement('section');
    preview.setAttribute('data-app-design-preview', '');
    const local = appendSpecialistPlots(preview);
    host.append(preview);
    const incomplete = document.createElement('section');
    incomplete.setAttribute('data-app-design-preview', '');
    incomplete.setAttribute('data-app-design-pack', 'classic');
    incomplete.setAttribute('data-app-chart', 'precision');
    const unselected = appendSpecialistPlots(incomplete);
    host.append(incomplete);
    const unprofiled = document.createElement('section');
    const outside = appendSpecialistPlots(unprofiled);
    document.body.append(host, unprofiled);
    const release = observeAppDesignScopes(host);
    const packs = Object.keys(APPLICATION_DESIGNS) as PackId[];
    try {
      expect(packs).toHaveLength(27);
      for (const pack of packs) {
        const mode = APPLICATION_DESIGNS[pack].chart;
        const previewPack = packs.find(id => APPLICATION_DESIGNS[id].chart !== mode)!;
        setProfile(host, pack);
        setProfile(preview, previewPack);
        await Promise.resolve();
        for (const [plots, expected] of [[live, mode], [local, APPLICATION_DESIGNS[previewPack].chart]] as const) {
          for (const target of [...plots.axes, ...plots.cells]) {
            const rules = matchingRules(target);
            expect(new Set(rules.map(contextMode).filter(Boolean)), `${pack}: nearest specialist mode`)
              .toEqual(new Set([expected]));
          }
          expect(matchingRules(plots.speedCell), `${pack}: quantitative speed cells are not axes`).toEqual([]);
          for (const cell of plots.cells) {
            for (const rule of matchingRules(cell)) {
              for (const node of rule.nodes) {
                if (node.type === 'decl') expect(['border-radius', 'border-style', 'font-variant-numeric']).toContain(node.prop);
              }
            }
          }
        }
        for (const target of [...unselected.axes, ...unselected.cells, unselected.speedCell]) {
          expect(matchingRules(target), `${pack}: incomplete preview remains unselected`).toEqual([]);
        }
        for (const target of [...outside.axes, ...outside.cells, outside.speedCell]) {
          expect(matchingRules(target), `${pack}: unprofiled region remains unselected`).toEqual([]);
        }
      }
    } finally {
      host.remove();
      unprofiled.remove();
      release();
    }
  });
});
