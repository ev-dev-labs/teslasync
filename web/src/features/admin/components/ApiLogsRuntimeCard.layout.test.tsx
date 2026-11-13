import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiLogsRuntimeCard } from './ApiLogsRuntimeCard';
import { getAppDesignAttributes, observeAppDesignScopes, APPLICATION_DESIGNS } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en' },
  }),
}));

describe('runtime card layout', () => {
  it('fills its grid row without inventing reports or dropping its evidence', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <ApiLogsRuntimeCard
          title="Browser reports"
          scope="Last hour"
          icon={Activity}
          count="0"
          countLabel="Received reports"
          context="Summary time"
          loading={false}
        >
          <p>No reports received; reporting may be unavailable.</p>
        </ApiLogsRuntimeCard>
      </QueryClientProvider>,
    );
    const card = screen.getByRole('region', { name: 'Browser reports' });
    expect(card).toHaveClass('flex', 'h-full', 'flex-col');
    expect(screen.getByText('No reports received; reporting may be unavailable.').parentElement)
      .toHaveClass('flex-1');
    expect(card).toHaveTextContent('0');
    expect(card).toHaveTextContent('Last hour');
  });

  it.each(PACK_IDS)('%s composes the actual count readout while preserving unknown, zero and loading', pack => {
    const tree = (count: string, loading = false) => (
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <ApiLogsRuntimeCard title="Runtime reports" scope="Exact window" icon={Activity}
          count={count} countLabel="Observed reports" context="Unchanged context" loading={loading}>
          <p>Retained diagnostic detail</p>
        </ApiLogsRuntimeCard>
      </div>
    );
    const view = render(tree('—'));
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const metric = view.container.querySelector('[data-app-metric="headline"]')!;
      const reading = metric.querySelector('[data-app-part="metric-reading"]')!;
      expectAppDesignDataMode(metric, APPLICATION_DESIGNS[pack].data, '[data-app-metric="headline"]');
      expectAppDesignDataMode(reading, APPLICATION_DESIGNS[pack].data, '[data-app-metric="headline"]');
      expect(reading.textContent).toBe('—');
      expect(metric.querySelector('[data-app-part="metric-label"]')).toHaveTextContent('Observed reports');
      view.rerender(tree('0'));
      expect(reading.textContent).toBe('0');
      view.rerender(tree('999', true));
      expect(metric).toHaveAttribute('aria-busy', 'true');
      expect(reading).not.toHaveTextContent('999');
      expect(reading.querySelector('[data-app-part~="skeleton"]')).not.toBeNull();
      expect(screen.getByText('Exact window')).toBeInTheDocument();
      expect(screen.getByText('Unchanged context')).toBeInTheDocument();
      expect(screen.getByText('Retained diagnostic detail')).toBeInTheDocument();
    } finally { release(); }
  });
});
