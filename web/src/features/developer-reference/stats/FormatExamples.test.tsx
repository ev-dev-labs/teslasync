import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import { FormatExamples } from './FormatExamples';
import { formatFixtures } from './fixtures';

const preferences: MetricPreferences = {
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
  },
  currency: { kind: 'symbol', value: '$' },
};

describe('synthetic format example records', () => {
  it.each(PACK_IDS)('%s owns genuine fixture articles without promoting synthetic input to measured metrics', pack => {
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <FormatExamples preferences={preferences} />
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const articles = screen.getAllByRole('article');
      expect(articles.map(article => article.getAttribute('data-format-fixture'))).toEqual(formatFixtures.map(fixture => fixture.id));
      for (const article of [articles[0], articles[articles.length - 1]]) {
        expect(article).toHaveAttribute('data-surface-variant', 'standalone');
        expectAppDesignDataMode(article, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(article.querySelector(':scope > [data-app-part~="record-body"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
      }
      expect(screen.getByText(/^Synthetic values\./)).toBeInTheDocument();
      const fixture = (id: string) => container.querySelector(`[data-format-fixture="${id}"]`) as HTMLElement;
      expect(fixture('negative-zero')).toHaveTextContent('Canonical input: -0');
      expect(fixture('negative-zero')).toHaveTextContent('Candidate output: $0.00');
      expect(fixture('energy-wh')).toHaveTextContent('Candidate output: 850.00 Wh');
      expect(fixture('null')).toHaveTextContent('State: missing');
      expect(fixture('nan')).toHaveTextContent('State: invalid');
      expect(within(fixture('nan')).getByText(/^Original example:/)).toHaveTextContent('Invalid finite measurement');
      expect(fixture('undefined')).toHaveTextContent('Canonical input: undefined');
      expect(container.querySelector('[data-app-part~="metric"], [role="meter"], [data-metric-fill]')).toBeNull();
    } finally { release(); }
  });
});
