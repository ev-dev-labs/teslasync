import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { InsightPanel } from './InsightPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

function renderPanel(onRetry?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InsightPanel title="Evidence" empty onRetry={onRetry}>
          <span>Resolved evidence</span>
        </InsightPanel>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InsightPanel empty source recovery', () => {
  it('refreshes the supplied source without presenting unresolved evidence as ready', () => {
    const onRetry = vi.fn();
    renderPanel(onRetry);
    expect(screen.getByText('No supported data is available.')).toBeInTheDocument();
    expect(screen.queryByText('Resolved evidence')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps informational emptiness visible without inventing a recovery callback', () => {
    renderPanel();
    expect(screen.getByText('No supported data is available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByText('Resolved evidence')).not.toBeInTheDocument();
  });
});
