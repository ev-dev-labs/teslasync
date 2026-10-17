import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RegimeShiftsPage from '../../pages/RegimeShiftsPage';

const source = vi.hoisted(() => ({
  data: undefined as [] | undefined,
  error: null as Error | null,
  loading: false,
  vehicleId: 7 as number | null,
  retry: vi.fn(),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({
    data: source.data, error: source.error, isError: Boolean(source.error),
    isLoading: source.loading, isPending: source.loading,
    isSuccess: source.data != null && !source.error, refetch: source.retry,
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: source.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g,
        (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function page() {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><RegimeShiftsPage /></MemoryRouter>
  </QueryClientProvider>;
}

beforeEach(() => {
  source.data = undefined;
  source.error = null;
  source.loading = false;
  source.vehicleId = 7;
  vi.clearAllMocks();
});

describe('regime operational evidence', () => {
  it('keeps unavailable measurements distinct from a real zero and retains chart and log shells', () => {
    source.error = new Error('history unavailable');
    render(page());
    const brief = screen.getByTestId('regime-summary');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    expect(screen.queryByText('over 0 weeks')).not.toBeInTheDocument();
    expect(screen.queryByText('none detected')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weekly consumption & detected regimes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shift log' })).toBeInTheDocument();
  });

  it('shows returned-empty count zero and reviews source coverage without a new query', () => {
    source.data = [];
    source.error = new Error('refresh failed');
    render(page());
    const brief = screen.getByTestId('regime-summary');
    const count = brief.querySelector('[data-operational-metric="regimes-count"]');
    expect(count).toHaveAttribute('data-value-state', 'value');
    expect(count?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('over 0 weeks')).toBeInTheDocument();
    expect(within(drawer).getByText('none detected')).toBeInTheDocument();
    expect(source.retry).not.toHaveBeenCalled();
  });

  it('does not expose loading skeletons as measured values', () => {
    source.loading = true;
    render(page());
    const brief = screen.getByTestId('regime-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });
});
