import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RegimeShiftsPage from '../pages/RegimeShiftsPage';

const state = vi.hoisted(() => ({ data: undefined as [] | undefined, error: null as Error | null, retry: vi.fn() }));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({
    data: state.data, error: state.error, isError: !!state.error,
    isLoading: false, refetch: state.retry,
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <RegimeShiftsPage />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { state.data = undefined; state.error = null; vi.clearAllMocks(); });

describe('regime source frames preserve unknown versus returned-empty evidence', () => {
  it('a fatal source failure never reports zero analyzed weeks or a measured absence of shifts', () => {
    state.error = new Error('history unavailable');
    const { container } = show();
    expect(screen.getByRole('heading', { name: 'Weekly consumption & detected regimes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shift log' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(4);
    expect(screen.queryByText('over 0 weeks')).not.toBeInTheDocument();
    expect(screen.queryByText('none detected')).not.toBeInTheDocument();
  });
  it('returned-empty source evidence survives a failed refresh and keeps its original no-shift interpretation', () => {
    state.data = [];
    state.error = new Error('refresh failed');
    const { container } = show();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('over 0 weeks')).toBeInTheDocument();
    expect(screen.getByText('none detected')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(4);
    expect(screen.getByText('Returned drive-history window')).toBeInTheDocument();
    expect(screen.getByText('Continuous observation coverage is unknown.')).toBeInTheDocument();
  });
});
