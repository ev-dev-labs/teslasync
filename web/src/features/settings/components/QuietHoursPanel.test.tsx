/**
 * QuietHoursPanel — confirm-gated window deletion.
 *
 * Removing a quiet-hours window re-enables notifications during that time,
 * so the row Delete button must open a danger confirm dialog instead of
 * firing the mutation directly. Only the data hooks, toast, and i18n are
 * mocked; the panel, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => {
  // The panel uses useTranslation('settings'); the namespace arg is ignored
  // and every key resolves to its English fallback.
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
      '@/api/hooks/useNotifications',
    );
  return {
    ...actual,
    useQuietHours: vi.fn(),
    useSaveQuietHours: vi.fn(),
    useDeleteQuietHours: vi.fn(),
  };
});

vi.mock('@/components/feedback', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback')>(
    '@/components/feedback',
  );
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  };
});

import {
  useQuietHours,
  useSaveQuietHours,
  useDeleteQuietHours,
} from '@/api/hooks/useNotifications';
import { QuietHoursPanel } from './QuietHoursPanel';
import type { QuietHoursWindow } from '@/api/types';

const mockWindows = useQuietHours as unknown as ReturnType<typeof vi.fn>;
const mockSave = useSaveQuietHours as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteQuietHours as unknown as ReturnType<typeof vi.fn>;

function makeWindow(overrides: Partial<QuietHoursWindow> = {}): QuietHoursWindow {
  return {
    id: 1,
    user_id: 'user-1',
    enabled: true,
    start_local: '22:00',
    end_local: '07:00',
    timezone: 'America/New_York',
    weekdays: 127,
    bypass_severities: ['critical'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <QuietHoursPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWindows.mockReturnValue(makeQuery([makeWindow()]));
  mockSave.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('QuietHoursPanel — confirm-gated delete', () => {
  it('opens a danger confirm instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Delete this quiet-hours window?'),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
