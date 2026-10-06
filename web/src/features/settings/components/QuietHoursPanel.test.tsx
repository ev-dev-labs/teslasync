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
  it('does not call a failed initial read an empty schedule, and retries only the read', () => {
    const refetch = vi.fn()
    mockWindows.mockReturnValue({
      ...makeQuery(undefined), isError: true, error: new Error('Read failed'), refetch,
    })
    renderPanel()
    expect(screen.getByText('Quiet-hours windows unavailable.')).toBeInTheDocument()
    expect(screen.queryByText(/No quiet-hours windows yet/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add window' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
    expect(mockRemove.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('retains an editable schedule and confirmation boundaries after a failed refresh', () => {
    mockWindows.mockReturnValue({
      ...makeQuery([makeWindow()]), isError: true, error: new Error('Refresh failed'),
    })
    renderPanel()
    expect(screen.getByTestId('quiet-hours-row-1')).toBeInTheDocument()
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('quiet-hours-form')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Timezone (IANA)' })).toBeInTheDocument()
    expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
    expect(mockRemove.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })
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

describe('QuietHoursPanel — source slots and specialist weekdays', () => {
  it('uses the preserved loading skeleton rather than claiming a first read is an empty schedule', () => {
    mockWindows.mockReturnValue({
      ...makeQuery(undefined),
      isLoading: true,
      isFetching: true,
    })
    renderPanel()
    expect(screen.getByTestId('quiet-hours-loading')).toBeInTheDocument()
    expect(screen.queryByText(/No quiet-hours windows yet/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add window' })).toBeEnabled()
    expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
    expect(mockRemove.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('keeps a legitimate empty schedule and its editor reachable without creating a window implicitly', () => {
    mockWindows.mockReturnValue(makeQuery([]))
    renderPanel()
    expect(screen.getAllByText(/No quiet-hours windows yet/)).toHaveLength(1)
    expect(screen.queryByTestId('quiet-hours-loading')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    expect(screen.getByTestId('quiet-hours-form')).toBeInTheDocument()
    expect(screen.queryByText(/No quiet-hours windows yet/)).toBeNull()
    expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('never replaces retained rows with an initial skeleton while a refresh is pending', () => {
    mockWindows.mockReturnValue({
      ...makeQuery([makeWindow()]),
      isLoading: true,
      isFetching: true,
    })
    renderPanel()
    expect(screen.getByTestId('quiet-hours-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('quiet-hours-loading')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
    expect(mockRemove.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('retains a known empty schedule with its nonfatal recovery notice after a refresh error', () => {
    const refetch = vi.fn()
    mockWindows.mockReturnValue({
      ...makeQuery([]),
      isError: true,
      error: new Error('Refresh failed'),
      refetch,
    })
    renderPanel()
    expect(screen.getAllByText(/No quiet-hours windows yet/)).toHaveLength(1)
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument()
    expect(screen.queryByText('Quiet-hours windows unavailable.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
    expect(mockRemove.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('preserves Sunday-first button ids, controlled pressed bits and exact saved bitmask', () => {
    const mutate = vi.fn()
    mockSave.mockReturnValue(makeMutation({ mutate }))
    mockWindows.mockReturnValue(makeQuery([makeWindow({ weekdays: 1 | 4 | 64 })]))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const weekdays = screen.getByRole('group', { name: 'Weekdays' })
    const buttons = within(weekdays).getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('data-testid'))).toEqual([
      'qh-weekday-1', 'qh-weekday-2', 'qh-weekday-4', 'qh-weekday-8',
      'qh-weekday-16', 'qh-weekday-32', 'qh-weekday-64',
    ])
    expect(buttons.map(button => button.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    for (const bit of [1, 2, 4, 8, 16, 32, 64]) {
      expect(screen.getByTestId(`qh-weekday-${bit}`)).toHaveAttribute(
        'aria-pressed', String([1, 4, 64].includes(bit)),
      )
    }
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('qh-weekday-64'))
    fireEvent.click(screen.getByTestId('qh-weekday-16'))
    expect(screen.getByTestId('qh-weekday-64')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('qh-weekday-16')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.submit(screen.getByTestId('quiet-hours-form'))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({
      id: 1,
      enabled: true,
      start_local: '22:00',
      end_local: '07:00',
      timezone: 'America/New_York',
      weekdays: 1 | 4 | 16,
      bypass_severities: ['critical'],
    }, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
    expect(mockRemove.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('rejects no selected weekdays, preserves the error association and clears it after an explicit selection', () => {
    const mutate = vi.fn()
    mockSave.mockReturnValue(makeMutation({ mutate }))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    for (const bit of [1, 2, 4, 8, 16, 32, 64]) {
      fireEvent.click(screen.getByTestId(`qh-weekday-${bit}`))
      expect(screen.getByTestId(`qh-weekday-${bit}`)).toHaveAttribute('aria-pressed', 'false')
    }
    fireEvent.submit(screen.getByTestId('quiet-hours-form'))
    expect(mutate).not.toHaveBeenCalled()
    const weekdays = screen.getByRole('group', { name: 'Weekdays' })
    expect(weekdays).toHaveAttribute('aria-describedby', 'quiet-hours-weekdays-error')
    expect(document.getElementById('quiet-hours-weekdays-error')).toHaveTextContent('Pick at least one weekday.')

    fireEvent.click(screen.getByTestId('qh-weekday-2'))
    expect(screen.getByTestId('qh-weekday-2')).toHaveAttribute('aria-pressed', 'true')
    expect(weekdays).not.toHaveAttribute('aria-describedby')
    expect(document.getElementById('quiet-hours-weekdays-error')).toBeNull()
    fireEvent.submit(screen.getByTestId('quiet-hours-form'))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, weekdays: 2 }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('keeps empty severity bypass legal and grows weekday and severity labels without changing ids', () => {
    const mutate = vi.fn()
    mockSave.mockReturnValue(makeMutation({ mutate }))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('qh-weekday-1')).toHaveClass('min-h-11', 'min-w-11', 'whitespace-normal')
    expect(screen.getByTestId('qh-severity-critical')).toHaveClass('min-h-11', 'min-w-11', 'whitespace-normal')
    fireEvent.click(screen.getByTestId('qh-severity-critical'))
    fireEvent.submit(screen.getByTestId('quiet-hours-form'))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ weekdays: 127, bypass_severities: [] }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })
})
