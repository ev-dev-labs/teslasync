import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';

export function queryResult<T>(data: T | undefined, overrides: Partial<DataStateSource<T>> = {}) {
  return {
    data,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    isPending: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

export function renderWidget(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children?: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(element, { wrapper: Wrapper });
}
