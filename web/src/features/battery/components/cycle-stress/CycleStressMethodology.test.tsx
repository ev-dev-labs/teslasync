import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { analyzeCycleStress } from '../../lib/cycleStress';
import { CycleStressMethodology } from './CycleStressMethodology';

const consumers: Array<{ selector: string; declarations: Record<string, string> }> = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => {
    const declarations: Record<string, string> = {};
    rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
    for (const selector of rule.selectors) consumers.push({ selector, declarations });
  });
function matchesAppDesignCss(node: Element, contract = '', mode?: string) {
  return consumers.filter(rule => rule.selector.includes(contract)
    && (!mode || rule.selector.includes(`[data-app-data="${mode}"]`)) && node.matches(rule.selector));
}
function expectAppDesignDataMode(node: Element, mode: string, contract: string) {
  expect(matchesAppDesignCss(node, contract, mode).length).toBeGreaterThan(0);
  expect(node.getAttribute('data-app-design-owner')?.split(' ')).toContain(`data-${mode}`);
}

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
}));

describe('cycle-stress complete native methodology (source-only)', () => {
  it.each(PACK_IDS)('%s owns all ten original articles without changing the configured definitions or non-claims', pack => {
    const result = analyzeCycleStress([], [], Date.parse('2026-08-08T12:00:00Z'), 'UTC', {
      exponent: 2.5, maxContinuityGapS: 172_800, maxBoundaryJumpPct: 4, historyLimit: 700,
    });
    const before = JSON.stringify(result);
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    const view = render(<QueryClientProvider client={client}>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}><CycleStressMethodology result={result} /></div>
    </QueryClientProvider>);
    const host = screen.getByTestId('cycle-stress-methodology');
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const articles = host.querySelectorAll('article');
      expect([...articles].map(article => article.querySelector('h4')?.textContent)).toEqual([
        'Endpoint eligibility', 'Direction rules', 'Overlap rejection', 'Conservative continuity',
        'Turning points and rainflow', 'Descriptive metrics', 'Vehicle-local calendar',
        'Support, not confidence', 'Capped historical scope', 'Unmodeled factors',
      ]);
      for (const article of articles) {
        const mode = APPLICATION_DESIGNS[pack].data;
        expectAppDesignDataMode(article, mode, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(article.querySelector('[data-app-part="record-header"]')!, mode, '[data-app-part~="record-header"]');
        const body = article.querySelector('[data-app-part="record-body"]')!;
        expectAppDesignDataMode(body, mode, '[data-app-part~="record-body"]');
        expect(body).not.toBeEmptyDOMElement();
        for (const match of matchesAppDesignCss(body)) expect(match.declarations).not.toHaveProperty('display', 'none');
      }
      expect(articles[0]).toHaveTextContent('Duration never substitutes for a missing end');
      expect(articles[3]).toHaveTextContent('more than 2 days');
      expect(articles[3]).toHaveTextContent('more than 4 percentage points');
      expect(articles[4]).toHaveTextContent('count 1 and unresolved segment-edge ranges at count 0.5');
      expect(articles[5]).toHaveTextContent('exponent 2.5');
      expect(articles[5]).toHaveTextContent('not a Tesla or cell-manufacturer damage curve');
      expect(articles[7]).toHaveTextContent('not statistical confidence or pack condition');
      expect(articles[8]).toHaveTextContent('capped at 700 rows');
      expect(articles[9]).toHaveTextContent('laboratory degradation measurements are not modeled');
      expect(host).toHaveTextContent('does not measure battery health, damage, degradation, safety, warranty status, or remaining life');
      expect(host).toHaveTextContent('does not prescribe charging behavior');
      expect(host.querySelector('[role="meter"], [role="progressbar"], [data-app-metric]')).toBeNull();
      expect(JSON.stringify(result)).toBe(before);
    } finally { release(); view.unmount(); client.clear(); }
  });
});
