import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PackRepositoryProvider } from '../../hooks/packRepositoryContext';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';

/** Renders `ui` wrapped in a fresh QueryClient + in-memory PackRepository — the standard harness for this feature's component tests. Never touches real IndexedDB/localStorage. */
export function renderWithProviders(ui: ReactElement, options?: { repository?: PackRepository }) {
  const repository = options?.repository ?? createInMemoryPackRepository();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <PackRepositoryProvider repository={repository}>{ui}</PackRepositoryProvider>
    </QueryClientProvider>,
  );
  return { ...utils, repository, client };
}
