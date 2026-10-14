/**
 * QuietHoursPanel — confirm-gated window deletion.
 *
 * Removing a quiet-hours window re-enables notifications during that time,
 * so the row Delete button must open a danger confirm dialog instead of
 * firing the mutation directly. Only the data hooks, toast, and i18n are
 * mocked; the panel, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const feedback = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
}))
const translations = vi.hoisted(() => ({ values: {} as Record<string, string> }))
const request = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({ request }))

vi.mock('react-i18next', () => {
  // The panel uses useTranslation('settings'); the namespace arg is ignored
  // and every key resolves to its English fallback.
  const t = (key: string, fallback?: unknown): string => {
    const defaultValue = typeof fallback === 'object' && fallback != null && 'defaultValue' in fallback
      ? fallback.defaultValue : undefined
    return translations.values[key]
      ?? (typeof fallback === 'string' ? fallback : typeof defaultValue === 'string' ? defaultValue : key)
  };
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
    useToast: () => feedback,
  };
});

vi.mock('@/components/feedback/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback/Toast')>(
    '@/components/feedback/Toast',
  )
  return { ...actual, useOptionalToast: () => feedback }
})

import {
  useQuietHours,
  useSaveQuietHours,
  useDeleteQuietHours,
} from '@/api/hooks/useNotifications';
import { QuietHoursPanel, type QuietHoursPanelProps } from './QuietHoursPanel';
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

function renderPanel(props: QuietHoursPanelProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    </MemoryRouter>
  );
  return render(<QuietHoursPanel {...props} />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  request.mockReset()
  translations.values = {}
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
    expect(mutate).toHaveBeenCalledWith(1);
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

describe('QuietHoursPanel — real mutation feedback ownership', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
      '@/api/hooks/useNotifications',
    )
    mockSave.mockImplementation(actual.useSaveQuietHours)
    mockRemove.mockImplementation(actual.useDeleteQuietHours)
  })

  it.each([
    { action: 'create', method: 'POST', path: '/notifications/quiet-hours', title: 'Quiet hours window created' },
    { action: 'update', method: 'PATCH', path: '/notifications/quiet-hours/1', title: 'Quiet hours window updated' },
  ])('emits exactly one hook-owned success for $action', async ({ action, method, path, title }) => {
    request.mockResolvedValue(makeWindow())
    if (action === 'create') mockWindows.mockReturnValue(makeQuery([]))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: action === 'create' ? 'Add window' : 'Edit' }))
    fireEvent.submit(screen.getByTestId('quiet-hours-form'))
    await waitFor(() => expect(screen.queryByTestId('quiet-hours-form')).toBeNull())
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(path, expect.objectContaining({ method }))
    expect(feedback.success).toHaveBeenCalledTimes(1)
    expect(feedback.success).toHaveBeenCalledWith(title)
    expect(feedback.error).not.toHaveBeenCalled()
  })

  it('emits one hook-owned save error alongside inline recovery and preserves the draft', async () => {
    request.mockRejectedValue(new Error('Save rejected'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
    fireEvent.submit(screen.getByTestId('quiet-hours-form'))
    expect(await screen.findByTestId('quiet-hours-error')).toHaveTextContent('Failed to save quiet hours window')
    expect(screen.getByLabelText('End')).toHaveValue('08:00')
    expect(feedback.error).toHaveBeenCalledTimes(1)
    expect(feedback.error).toHaveBeenCalledWith('Failed to save quiet hours window', 'Save rejected')
    expect(feedback.success).not.toHaveBeenCalled()
  })

  it.each([true, false])('emits exactly one hook-owned deletion result (success: %s)', async (succeeds) => {
    if (succeeds) request.mockResolvedValue(undefined)
    else request.mockRejectedValue(new Error('Delete rejected'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(succeeds ? feedback.success : feedback.error).toHaveBeenCalledTimes(1))
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/notifications/quiet-hours/1', { method: 'DELETE' })
    if (succeeds) {
      expect(feedback.success).toHaveBeenCalledWith('Quiet hours window removed')
      expect(feedback.error).not.toHaveBeenCalled()
    } else {
      expect(feedback.error).toHaveBeenCalledWith('Failed to delete quiet hours window', 'Delete rejected')
      expect(feedback.success).not.toHaveBeenCalled()
    }
  })
})

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

    describe('QuietHoursPanel — draft authority', () => {
      it('keeps a dirty original draft when replacing it with another row is declined', async () => {
        mockWindows.mockReturnValue(makeQuery([makeWindow(), makeWindow({ id: 2, start_local: '20:00' })]))
        renderPanel()
        fireEvent.click(within(screen.getByTestId('quiet-hours-row-1')).getByRole('button', { name: 'Edit' }))
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
        fireEvent.click(within(screen.getByTestId('quiet-hours-row-2')).getByRole('button', { name: 'Edit' }))
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep editing' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByLabelText('End')).toHaveValue('08:00')
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        expect(mockSave.mock.results[0].value.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1, end_local: '08:00' }), expect.any(Object),
        )
      })

      it('replaces a dirty draft with the requested row only after confirmation', async () => {
        mockWindows.mockReturnValue(makeQuery([makeWindow(), makeWindow({ id: 2, start_local: '20:00' })]))
        renderPanel()
        fireEvent.click(within(screen.getByTestId('quiet-hours-row-1')).getByRole('button', { name: 'Edit' }))
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
        fireEvent.click(within(screen.getByTestId('quiet-hours-row-2')).getByRole('button', { name: 'Edit' }))
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
        await waitFor(() => expect(screen.getByLabelText('Start')).toHaveValue('20:00'))
        expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
      })

      it('does not silently replace a dirty draft with an advisor proposal', async () => {
        const onSeedConsumed = vi.fn()
        const { rerender } = renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
        rerender(<QuietHoursPanel seedDraft={{
          enabled: true, start_local: '21:00', end_local: '06:00', timezone: 'UTC',
          weekdays: 2, bypass_severities: [],
        }} onSeedConsumed={onSeedConsumed} />)
        expect(screen.getByLabelText('End')).toHaveValue('08:00')
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep editing' }))
        await waitFor(() => expect(onSeedConsumed).toHaveBeenCalledTimes(1))
        expect(screen.getByLabelText('End')).toHaveValue('08:00')
        expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
      })

      it('applies an approved proposal once as a new draft without writing', async () => {
        const onSeedConsumed = vi.fn()
        const seedDraft = {
          enabled: true, start_local: '21:00', end_local: '06:00', timezone: 'UTC',
          weekdays: 2, bypass_severities: [],
        }
        const { rerender } = renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
        rerender(<QuietHoursPanel seedDraft={seedDraft} onSeedConsumed={onSeedConsumed} />)
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
        await waitFor(() => expect(screen.getByLabelText('Start')).toHaveValue('21:00'))
        expect(onSeedConsumed).toHaveBeenCalledTimes(1)
        expect(screen.getByText('New quiet-hours window')).toBeInTheDocument()
        expect(mockSave.mock.results[0].value.mutate).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '09:00' } })
        rerender(<QuietHoursPanel seedDraft={seedDraft} onSeedConsumed={onSeedConsumed} />)
        expect(screen.getByLabelText('End')).toHaveValue('09:00')
        expect(onSeedConsumed).toHaveBeenCalledTimes(1)
      })

      it('keeps edits made after submission when the original revision succeeds', async () => {
        const mutate = vi.fn()
        mockSave.mockReturnValue(makeMutation({ mutate }))
        renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        expect(mutate).toHaveBeenCalledTimes(1)
        const callbacks = mutate.mock.calls[0][1] as { onSuccess: (window: QuietHoursWindow) => void }
        fireEvent.click(screen.getByTestId('qh-weekday-2'))
        act(() => callbacks.onSuccess(makeWindow()))
        expect(screen.getByLabelText('End')).toHaveValue('08:00')
        expect(screen.getByTestId('quiet-hours-form')).toBeInTheDocument()
      })

      it('binds edits made during creation to the saved window rather than creating a duplicate', () => {
        const mutate = vi.fn()
        mockSave.mockReturnValue(makeMutation({ mutate }))
        mockWindows.mockReturnValue(makeQuery([]))
        renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
        const callbacks = mutate.mock.calls[0][1] as { onSuccess: (window: QuietHoursWindow) => void }
        act(() => callbacks.onSuccess(makeWindow({ id: 7 })))
        expect(screen.getByLabelText('End')).toHaveValue('08:00')
        expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        expect(mutate).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: 7, end_local: '08:00' }), expect.any(Object),
        )
      })

      it('closes only the unchanged successful revision and retains failed drafts', async () => {
        const mutate = vi.fn()
        mockSave.mockReturnValue(makeMutation({ mutate }))
        renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        const failed = mutate.mock.calls[0][1] as { onError: () => void }
        act(() => failed.onError())
        expect(screen.getByLabelText('End')).toHaveValue('07:00')
        expect(screen.getByTestId('quiet-hours-error')).toHaveTextContent('Failed to save quiet hours window')
        expect(feedback.error).not.toHaveBeenCalled()
        fireEvent.submit(screen.getByTestId('quiet-hours-form'))
        const succeeded = mutate.mock.calls[1][1] as { onSuccess: (window: QuietHoursWindow) => void }
        act(() => succeeded.onSuccess(makeWindow()))
        expect(screen.queryByTestId('quiet-hours-form')).toBeNull()
        expect(feedback.success).not.toHaveBeenCalled()
      })

      it('exposes selected row weekdays and localizes known severity IDs while retaining unknown values', () => {
        translations.values = {
          'quietHours.severity.critical': 'Critique',
          'quietHours.severity.warn': 'Avertissement',
        }
        mockWindows.mockReturnValue(makeQuery([makeWindow({ weekdays: 2, bypass_severities: ['critical', 'warn', 'vendor-code'] })]))
        renderPanel()
        const row = screen.getByTestId('quiet-hours-row-1')
        expect(within(row).getByText('Mon: Enabled')).toBeInTheDocument()
        expect(within(row).getByText('Sun: Disabled')).toBeInTheDocument()
        expect(within(row).getByText('Critique')).toBeInTheDocument()
        expect(within(row).getByText('Avertissement')).toBeInTheDocument()
        expect(within(row).getByText('vendor-code')).toBeInTheDocument()
      })

      it('declares mobile44 targets with desktop restoration for owned actions', () => {
        renderPanel()
        for (const name of ['Add window', 'Edit', 'Delete']) {
          expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9')
        }
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        for (const name of ['Cancel', 'Update']) {
          expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9')
        }
      })
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
