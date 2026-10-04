import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiLogsRuntimeCard } from './ApiLogsRuntimeCard';

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
});
