// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { APPLICATION_DESIGNS } from '../ui/app-designs/designs';

const stylesheet = postcss.parse(readFileSync(
  resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8',
));
const rules: Rule[] = [];
stylesheet.walkRules(rule => { rules.push(rule); });

describe('application design data/feedback stylesheet boundary', () => {
  it('keeps every final target guarded by its verified owner without requiring native scope', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        expect(selector.trim().startsWith(':is(:root, [data-app-design-preview])')).toBe(true);
        expect(selector).toMatch(/:where\(\[data-app-design-owner(?:~="[^"]+")?\]\)$/);
        for (const match of selector.matchAll(/\[data-app-(data|feedback)="([^"]+)"\]/g)) {
          expect(selector).toContain(`[data-app-design-owner~="${match[1]}-${match[2]}"]`);
        }
      }
      const ancestors: AtRule[] = [];
      let parent = rule.parent;
      while (parent) {
        if (parent.type === 'atrule') ancestors.push(parent);
        parent = parent.parent;
      }
      expect(ancestors.some(parent => parent.name === 'media'
        && parent.params === 'screen and (forced-colors: none)')).toBe(true);
      expect(ancestors.some(parent => parent.name === 'scope')).toBe(false);
      expect(rule.selector).not.toContain(':scope');
    }
  });

  it('supplies structural compositions for every registered pack rather than token-only skins', () => {
    for (const design of Object.values(APPLICATION_DESIGNS)) {
      for (const [family, mode] of [['data', design.data], ['feedback', design.feedback]]) {
        const matching = rules.filter(rule => rule.selector.includes(`[data-app-${family}="${mode}"]`));
        const structural = new Set<string>();
        matching.forEach(rule => rule.walkDecls(declaration => {
          if (['display', 'grid-template-columns', 'flex-direction', 'grid-column', 'align-items', 'flex-basis'].includes(declaration.prop)) {
            structural.add(`${declaration.prop}: ${declaration.value}`);
          }
        }));
        expect(structural.size, `${family}=${mode}`).toBeGreaterThan(0);
      }
    }
  });

  it('does not hide content, fabricate readings or replace semantic/chart colors', () => {
    stylesheet.walkDecls(declaration => {
      expect(declaration.important).not.toBe(true);
      expect(declaration.prop).not.toMatch(/^(?:content|opacity|visibility|fill|stroke|filter)$/);
      expect(`${declaration.prop}:${declaration.value}`).not.toBe('display:none');
      expect(declaration.value).not.toMatch(/#[\da-f]{3,8}\b|var\(--theme-(?:primary|accent)/i);
      if (declaration.prop === '--app-feedback-signal' && declaration.value.includes('--semantic-success')) {
        expect((declaration.parent as Rule).selector).toContain('[data-app-tone="success"]');
      }
    });
  });

  it('reserves separate grid cells for notice recovery and dismissal', () => {
    const placement = (part: string) => {
      const rule = rules.find(candidate => candidate.selector.includes(
        `[data-app-feedback-kind="notice"] > [data-app-part~="${part}"]`,
      ));
      const declarations: Record<string, string> = {};
      rule?.walkDecls(declaration => {
        declarations[declaration.prop] = declaration.value;
      });
      return [declarations['grid-column'], declarations['grid-row']];
    };

    expect(placement('feedback-actions')).toEqual(['2 / -1', '2']);
    expect(placement('feedback-dismiss')).toEqual(['3', '1']);

    const narrowRules = rules.filter(rule => rule.parent?.type === 'atrule'
      && rule.parent.name === 'media'
      && rule.parent.params === '(max-width: 30rem)');
    const narrowRecovery = narrowRules.find(rule => rule.selector.includes('feedback-actions')
      && rule.selector.includes('[data-app-feedback-kind="notice"]'));
    expect(narrowRecovery).toBeDefined();
    expect(narrowRules.some(rule => rule.selector.includes('feedback-dismiss'))).toBe(false);
  });

  it('frames native quantitative tracks without changing their measured box or semantic fill paint', () => {
    const nativeRules = rules.filter(rule => rule.selector.includes('[data-app-metric="bar"]')
      && rule.selector.includes('[data-metric-track]'));
    for (const mode of ['table', 'ledger', 'cards', 'instrument']) {
      expect(nativeRules.some(rule => rule.selector.includes(`[data-app-data="${mode}"]`))).toBe(true);
    }
    expect(nativeRules.some(rule => rule.selector.includes('[data-metric-fill]'))).toBe(true);
    for (const rule of nativeRules) {
      rule.walkDecls(declaration => {
        expect(['outline', 'outline-offset', 'min-inline-size', 'box-sizing']).toContain(declaration.prop);
        if (declaration.prop === 'min-inline-size') expect(declaration.value).toBe('0');
      });
    }
  });

  it('excludes inline banks and native gauge compositions from every metric-grid restructuring rule', () => {
    const structuralProperties = new Set([
      'display', 'grid-template-columns', 'grid-auto-rows', 'grid-column',
      'gap', 'row-gap', 'column-gap', 'align-items', 'min-block-size', 'padding', 'border',
    ]);
    const restructuring = rules.filter(rule => {
      let structural = false;
      rule.walkDecls(declaration => { structural ||= structuralProperties.has(declaration.prop); });
      return structural && rule.selector.includes('[data-app-part~="metric-grid"]');
    });
    expect(restructuring).toHaveLength(7);
    for (const rule of restructuring) {
      for (const selector of rule.selectors.filter(selector => selector.includes('[data-app-part~="metric-grid"]'))) {
        expect(selector).toContain(':not([data-app-metric-grid="inline"])');
        expect(selector).toContain(':not([data-app-metric-grid="native-gauge"])');
      }
    }
    expect(restructuring.some(rule => rule.parent?.type === 'atrule'
      && rule.parent.name === 'media' && rule.parent.params === '(max-width: 30rem)')).toBe(true);
  });
});
