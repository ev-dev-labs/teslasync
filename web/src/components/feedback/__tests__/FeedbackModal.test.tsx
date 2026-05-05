/**
 * Phase-46 / Prompt 08 — FeedbackModal contract.
 *
 * Asserts the schema-driven submit flow:
 *   1. Submit is disabled until title/body meet zod's min-length rules.
 *   2. Submitting posts the auto-collected context (page_route, user_agent,
 *      app_version) plus the user-entered category/title/body to /feedback.
 *   3. The `Attach recent console messages` toggle controls whether the
 *      `console_tail` field is included in the payload.
 *
 * The `request` helper is mocked so the hook exercises its real
 * mutation internals without touching the network. i18n is stubbed
 * to fall back to the `defaultValue` argument so we can assert UI
 * copy without loading the full translation bundle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// Mock the resilience-aware request helper used by useSubmitFeedback.
vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

// Stub react-i18next so t(key, fallback, vars) resolves to fallback
// (with vars interpolated for the {{count}} case).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
        let fallback = key
        let vars: Record<string, unknown> | undefined
        if (typeof fallbackOrOpts === 'string') {
          fallback = fallbackOrOpts
          vars = opts
        } else if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') fallback = o.defaultValue
          vars = o
        }
        if (vars) {
          return Object.entries(vars).reduce<string>(
            (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
            fallback,
          )
        }
        return fallback
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { FeedbackModal } from '../FeedbackModal'
import { ToastProvider } from '@/components/feedback/Toast'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderModal() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  const ui = (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <FeedbackModal open={true} onClose={onClose} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
  const result = render(ui)
  return { ...result, onClose, qc }
}

function lastSubmitPayload(): Record<string, unknown> {
  expect(mockedRequest).toHaveBeenCalled()
  const lastCall = mockedRequest.mock.calls[mockedRequest.mock.calls.length - 1]!
  expect(lastCall[0]).toBe('/feedback')
  const init = lastCall[1] as RequestInit
  expect(init.method).toBe('POST')
  return JSON.parse(String(init.body))
}

describe('FeedbackModal', () => {
  beforeEach(() => {
    mockedRequest.mockReset()
  })

  it('keeps Send disabled while title/body fail zod validation', async () => {
    renderModal()
    const submit = screen.getByTestId('feedback-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    // Title alone is not enough; body must also clear its 20-char minimum.
    const titleInput = screen.getByLabelText(/title/i)
    fireEvent.change(titleInput, { target: { value: 'Battery widget shows NaN' } })
    expect(submit.disabled).toBe(true)

    const bodyInput = screen.getByLabelText(/details/i)
    fireEvent.change(bodyInput, {
      target: { value: 'Steps: load /battery, scroll, value flips to NaN.' },
    })
    expect(submit.disabled).toBe(false)
  })

  it('submits the auto-collected context plus user entries', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 42 })
    const { onClose } = renderModal()

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Battery widget shows NaN' },
    })
    fireEvent.change(screen.getByLabelText(/details/i), {
      target: { value: 'Steps: load /battery, scroll, value flips to NaN.' },
    })

    await act(async () => {
      fireEvent.submit(screen.getByTestId('feedback-form'))
    })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    const payload = lastSubmitPayload()
    expect(payload.category).toBe('bug')
    expect(payload.title).toBe('Battery widget shows NaN')
    expect(payload.body).toBe('Steps: load /battery, scroll, value flips to NaN.')
    expect(payload.page_route).toBe('/dashboard')
    expect(typeof payload.user_agent).toBe('string')
    expect('console_tail' in payload).toBe(false)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('toggling "include console" controls whether console_tail is attached', async () => {
    // First submit: console toggle OFF.
    mockedRequest.mockResolvedValueOnce({ id: 1 })
    const first = renderModal()
    // Generate something for the console buffer.
    // The buffer wrapper is installed lazily on modal open, so log AFTER render.
    console.log('hello-from-test')
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'A bug with enough title length' },
    })
    fireEvent.change(screen.getByLabelText(/details/i), {
      target: { value: 'Body that satisfies the twenty-char minimum easily.' },
    })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('feedback-form'))
    })
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect('console_tail' in lastSubmitPayload()).toBe(false)
    first.unmount()

    // Second submit: console toggle ON.
    mockedRequest.mockResolvedValueOnce({ id: 2 })
    renderModal()
    console.log('second-line-for-the-buffer')
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Another bug with enough title length' },
    })
    fireEvent.change(screen.getByLabelText(/details/i), {
      target: { value: 'Another body that satisfies the twenty-char minimum.' },
    })

    // Find the "Attach recent console messages" toggle and click it.
    const consoleToggle = screen.getByRole('switch', { name: /console/i })
    await act(async () => {
      fireEvent.click(consoleToggle)
    })

    await act(async () => {
      fireEvent.submit(screen.getByTestId('feedback-form'))
    })
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    const second = lastSubmitPayload()
    expect(typeof second.console_tail).toBe('string')
    expect(String(second.console_tail).length).toBeGreaterThan(0)
  })
})
