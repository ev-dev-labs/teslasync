import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { CostComparisonCard } from './CostComparisonCard';

const consumers: string[] = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => {
    if (rule.nodes.some(node => node.type === 'decl')) consumers.push(...rule.selectors);
  });
function expectAppDesignDataMode(node: Element, mode: string, contract: string) {
  expect(consumers.some(selector => selector.includes(`[data-app-data="${mode}"]`)
    && selector.includes(contract) && node.matches(selector))).toBe(true);
  expect(node.getAttribute('data-app-design-owner')?.split(' ')).toContain(`data-${mode}`);
}

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' }, t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock('@/hooks/useFormatting', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useFormatting')>(),
  useFormatting: () => ({ currencySymbol: '€' }),
}));
const preferences = getFormatterPreferences();
afterEach(() => {
  act(() => { setGlobalLocale(preferences.locale); setGlobalPrecision(preferences.precision); });
});

describe('actual cost comparison readings and outcome chips (source-only)', () => {
  it.each(PACK_IDS)('%s preserves both comparison directions, missing cost coverage, true zero and unsplit currency', pack => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    const view = render(<QueryClientProvider client={client}>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <div data-testid="monthly"><CostComparisonCard label="Monthly" evCost={0} gasCost={100} icon={null} /></div>
        <div data-testid="annual"><CostComparisonCard label="Annual" evCost={1200} gasCost={1000} icon={null} /></div>
        <div data-testid="missing"><CostComparisonCard label="Missing" evCost={null} gasCost={100} icon={null} /></div>
        <div data-testid="zero"><CostComparisonCard label="Zero baseline" evCost={0} gasCost={0} icon={null} /></div>
      </div>
    </QueryClientProvider>);
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      for (const id of ['monthly', 'annual', 'missing', 'zero']) {
        const host = screen.getByTestId(id);
        const readings = host.querySelectorAll('[data-app-metric="headline"]');
        expect(readings).toHaveLength(2);
        for (const reading of readings) {
          expectAppDesignDataMode(reading, APPLICATION_DESIGNS[pack].data, '[data-app-metric="headline"]');
          expect(reading.querySelector('[data-app-part="metric-label"]')).not.toBeEmptyDOMElement();
          expectAppDesignDataMode(reading.querySelector('[data-app-part~="metric-reading"]')!,
            APPLICATION_DESIGNS[pack].data, '[data-app-part~="metric-reading"]');
        }
        expect(host.querySelector('[data-app-part="metric-unit"], [role="meter"], [role="progressbar"]')).toBeNull();
      }
      const monthly = screen.getByTestId('monthly');
      expect(monthly.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('€0');
      expect(monthly).toHaveTextContent('Saving €100');
      expect(monthly.querySelector('[data-app-part="badge"]')).toHaveAttribute('data-app-variant', 'success');
      expect(monthly.querySelector('[data-app-part="badge"]')).toHaveTextContent('less');
      const annual = screen.getByTestId('annual');
      expect(annual).toHaveTextContent('Higher by €200');
      expect(annual.querySelector('[data-app-part="badge"]')).toHaveAttribute('data-app-variant', 'warning');
      expect(annual.querySelector('[data-app-part="badge"]')).toHaveTextContent('more');
      for (const id of ['missing', 'zero']) {
        expect(within(screen.getByTestId(id)).getByText(/Complete charging-cost coverage/)).toBeInTheDocument();
        expect(screen.getByTestId(id).querySelector('[data-app-part="badge"]')).toBeNull();
      }
      expect(screen.getByTestId('missing').querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
      act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(3); });
      expect(monthly.querySelector('[data-app-part="badge"]')).toHaveTextContent('100,000% less');
      expect(annual.querySelector('[data-app-part~="metric-value"] > span')).toHaveAttribute('title', '€1.200,000');
    } finally { release(); view.unmount(); client.clear(); }
  });
});
