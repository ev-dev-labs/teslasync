import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { expect } from 'vitest';
import { getAppDesignAttributes } from '../ui/app-designs/designs';

const rules: Rule[] = [];
postcss.parse(readFileSync(
  resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8',
)).walkRules(rule => { rules.push(rule); });

export function matchesAppDesignCss(node: Element, contract = '') {
  return rules.flatMap(rule => rule.selectors
    .filter(selector => selector.includes(contract)
      && [...node.ownerDocument.querySelectorAll(selector)].includes(node))
    .map(selector => {
      const declarations: Record<string, string> = {};
      rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
      return { selector, declarations };
    }));
}

export function matchingAppDesignDataRules(node: Element, contract = '') {
  return matchesAppDesignCss(node, contract).filter(match => match.selector.includes('[data-app-data='));
}

export function expectAppDesignDataMode(node: Element, mode: string, contract = '') {
  const selected = matchingAppDesignDataRules(node, contract);
  expect(selected.length).toBeGreaterThan(0);
  for (const match of selected) {
    expect(match.selector).toContain(`[data-app-data="${mode}"]`);
    expect(match.selector).toMatch(new RegExp(`:where\\(\\[data-app-design-owner~="data-${mode}"\\]\\)$`));
  }
}

export function setAppDesignTestProfile(host: Element, pack: Parameters<typeof getAppDesignAttributes>[0]) {
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
}
