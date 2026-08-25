/**
 * QuietHoursPanel contract.
 *
 * Asserts the CRUD UI hooked up to /notifications/quiet-hours:
 *   1. Loads existing windows from useQuietHours() and renders one row per window.
 *   2. The "Add window" button reveals a draft form with sane defaults.
 *   3. Validation errors (end == start) block submission.
 *   4. Successful submission posts the right payload via useSaveQuietHours().
 *   5. Delete posts to useDeleteQuietHours().
 *   6. nextWindowChangeLabel() handles same-day, cross-midnight, and
 *      weekday-mask cases.
 *
 * The shared `request` helper is mocked so the real hooks run end-to-
 * end without a network. i18n is stubbed to fall back to the
 * `defaultValue` argument.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { QuietHoursPanel, nextWindowChangeLabel } from '../QuietHoursPanel'
import type { QuietHoursWindow } from '@/api/hooks/useNotifications'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const sample: QuietHoursWindow = {
  id: 1,
  user_id: 'alice',
  enabled: true,
  start_local: '23:00',
  end_local: '07:00',
  timezone: 'America/New_York',
  weekdays: 127,
  bypass_severities: ['critical'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <QuietHoursPanel />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('QuietHoursPanel', () => {
  it('renders existing windows from the hook', async () => {
    mockedRequest.mockResolvedValueOnce({ windows: [sample] })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('quiet-hours-row-1')).toBeInTheDocument()
    })
    expect(screen.getByText(/23:00 → 07:00/)).toBeInTheDocument()
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument()
  })

  it('opens the add-window form with defaults', async () => {
    mockedRequest.mockResolvedValueOnce({ windows: [] })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('quiet-hours-add')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('quiet-hours-add'))
    expect(screen.getByTestId('quiet-hours-form')).toBeInTheDocument()
    const startInput = screen.getByLabelText('Start') as HTMLInputElement
    const endInput = screen.getByLabelText('End') as HTMLInputElement
    expect(startInput.value).toBe('23:00')
    expect(endInput.value).toBe('07:00')
  })

  it('blocks submission when end equals start', async () => {
    mockedRequest.mockResolvedValueOnce({ windows: [] })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('quiet-hours-add')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('quiet-hours-add'))
    const endInput = screen.getByLabelText('End') as HTMLInputElement
    fireEvent.change(endInput, { target: { value: '23:00' } })
    fireEvent.click(screen.getByTestId('quiet-hours-save'))
    expect(screen.getByTestId('quiet-hours-error')).toHaveTextContent('End must differ from start.')
    // request should not have been re-called for save (only the initial list).
    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('requires confirmation before discarding an edited window', async () => {
    mockedRequest.mockResolvedValueOnce({ windows: [] })
    renderPanel()
    fireEvent.click(await screen.findByTestId('quiet-hours-add'))
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '22:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(screen.getByTestId('quiet-hours-form')).toBeInTheDocument()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(screen.queryByTestId('quiet-hours-form')).not.toBeInTheDocument()
    })
  })

  it('submits a valid payload via POST', async () => {
    mockedRequest
      .mockResolvedValueOnce({ windows: [] })
      .mockResolvedValueOnce({ ...sample, id: 7 })
      .mockResolvedValueOnce({ windows: [{ ...sample, id: 7 }] })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('quiet-hours-add')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('quiet-hours-add'))
    fireEvent.click(screen.getByTestId('quiet-hours-save'))
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/notifications/quiet-hours',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const call = mockedRequest.mock.calls.find(
      (c) => typeof c[1] === 'object' && (c[1] as { method?: string }).method === 'POST',
    )
    expect(call).toBeDefined()
    const body = JSON.parse((call?.[1] as { body: string }).body)
    expect(body).toMatchObject({
      enabled: true,
      start_local: '23:00',
      end_local: '07:00',
      weekdays: 127,
      bypass_severities: ['critical'],
    })
    expect(typeof body.timezone).toBe('string')
  })

  it('deletes a window via DELETE', async () => {
    mockedRequest
      .mockResolvedValueOnce({ windows: [sample] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ windows: [] })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('quiet-hours-row-1')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/notifications/quiet-hours/1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })
})

describe('nextWindowChangeLabel', () => {
  const base: QuietHoursWindow = {
    id: 1,
    user_id: '',
    enabled: true,
    start_local: '13:00',
    end_local: '14:00',
    timezone: 'UTC',
    weekdays: 127,
    bypass_severities: [],
    created_at: '',
    updated_at: '',
  }

  it('returns the start label before the window opens (same-day)', () => {
    // 12:00 local — window starts at 13:00.
    const now = new Date(2024, 0, 1, 12, 0)
    expect(nextWindowChangeLabel(base, now)).toBe('starts at 13:00')
  })

  it('returns the end label while the window is active (same-day)', () => {
    const now = new Date(2024, 0, 1, 13, 30)
    expect(nextWindowChangeLabel(base, now)).toBe('ends at 14:00')
  })

  it('returns the next-day start label after a same-day window has closed', () => {
    const now = new Date(2024, 0, 1, 15, 0)
    expect(nextWindowChangeLabel(base, now)).toBe('starts tomorrow at 13:00')
  })

  it('handles cross-midnight wrap (active after midnight)', () => {
    const wrap = { ...base, start_local: '23:00', end_local: '07:00' }
    // 02:00 — currently inside the window (wrap leg).
    const now = new Date(2024, 0, 1, 2, 0)
    expect(nextWindowChangeLabel(wrap, now)).toBe('ends at 07:00')
  })

  it('handles cross-midnight wrap (active just after start)', () => {
    const wrap = { ...base, start_local: '23:00', end_local: '07:00' }
    // 23:30 — inside the first leg, ends tomorrow morning.
    const now = new Date(2024, 0, 1, 23, 30)
    expect(nextWindowChangeLabel(wrap, now)).toBe('ends tomorrow at 07:00')
  })

  it('returns null when the window is disabled today via weekday mask', () => {
    // 2024-01-01 was a Monday (getDay()=1, bit=2). Mask everything
    // except Monday off so the window is not active today.
    const off = { ...base, weekdays: 127 ^ 2 }
    const now = new Date(2024, 0, 1, 12, 0)
    expect(nextWindowChangeLabel(off, now)).toBeNull()
  })
})
