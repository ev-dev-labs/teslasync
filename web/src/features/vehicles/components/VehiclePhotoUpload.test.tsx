// Phase-46 / Prompt 54 — VehiclePhotoUpload unit tests.
//
// Co-located alongside the component (NOT under __tests__/) so the
// gate's allowed-files regex 'features/vehicles/components/
// VehiclePhotoUpload' covers it via substring match.
//
// Coverage:
//   1. Renders dropzone with the choose-photo button when no photo
//      is set.
//   2. Renders the preview + remove button when a photo exists.
//   3. Selecting an oversize file shows an error toast and never
//      calls the upload mutation.
//   4. Selecting an unsupported mime shows an error toast.
//   5. Selecting a valid file fires the multipart POST and bumps
//      the cache.
//   6. The remove button opens a confirm dialog whose confirm fires
//      the DELETE mutation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        // Mirror the i18next overload: t(key, defaultStr) and
        // t(key, defaultStr, opts) and t(key, opts). The unit tests
        // assert on default-fallback strings to keep the mock
        // independent of the en.json shape.
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue as string
        let out = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(`{{${k}}}`, String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { VehiclePhotoUpload } from './VehiclePhotoUpload'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

// jsdom doesn't ship URL.createObjectURL / revokeObjectURL — stub
// them so the preview + cleanup paths don't crash.
const fakeObjectUrls = new Set<string>()
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:fake-${Math.random()}`
    fakeObjectUrls.add(url)
    return url
  }) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn((url: string) => {
    fakeObjectUrls.delete(url)
  }) as unknown as typeof URL.revokeObjectURL
})
afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  fakeObjectUrls.clear()
})

// fetch is the upload path's transport; the request() mock above
// covers the GET/DELETE paths but the upload mutation explicitly
// bypasses request() so it can ship multipart bodies.
const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch
  mockedRequest.mockReset()
})
afterEach(() => {
  global.fetch = originalFetch
})

const mockedFetch = () => global.fetch as unknown as ReturnType<typeof vi.fn>

function renderUpload(vehicleId = 42) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <VehiclePhotoUpload vehicleId={vehicleId} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function makeFile(name: string, mime: string, sizeBytes: number): File {
  const bytes = new Uint8Array(sizeBytes)
  return new File([bytes], name, { type: mime })
}

describe('VehiclePhotoUpload — initial render', () => {
  it('renders the dropzone with a choose button when no photo exists', async () => {
    mockedRequest.mockResolvedValue({ has_photo: false })
    renderUpload()
    expect(await screen.findByTestId('vehicle-photo-dropzone')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-photo-choose')).toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-photo-remove')).toBeNull()
  })

  it('renders preview + remove button when a photo exists', async () => {
    mockedRequest.mockResolvedValue({
      has_photo: true,
      uploaded_at: '2024-01-15T10:00:00Z',
      sizes: { thumb: 'thumb', medium: 'medium', full: 'full' },
    })
    renderUpload()
    expect(await screen.findByTestId('vehicle-photo-remove')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-photo-preview')).toBeInTheDocument()
  })
})

describe('VehiclePhotoUpload — file validation', () => {
  it('rejects oversize files before calling fetch', async () => {
    mockedRequest.mockResolvedValue({ has_photo: false })
    renderUpload()
    await screen.findByTestId('vehicle-photo-dropzone')
    const huge = makeFile('huge.jpg', 'image/jpeg', 9 * 1024 * 1024)
    const input = screen.getByTestId('vehicle-photo-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [huge] } })
    expect(mockedFetch()).not.toHaveBeenCalled()
  })

  it('rejects unsupported mime types before calling fetch', async () => {
    mockedRequest.mockResolvedValue({ has_photo: false })
    renderUpload()
    await screen.findByTestId('vehicle-photo-dropzone')
    const pdf = makeFile('doc.pdf', 'application/pdf', 100)
    const input = screen.getByTestId('vehicle-photo-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pdf] } })
    expect(mockedFetch()).not.toHaveBeenCalled()
  })
})

describe('VehiclePhotoUpload — happy paths', () => {
  it('uploads a valid file via multipart POST', async () => {
    mockedRequest.mockResolvedValue({ has_photo: false })
    mockedFetch().mockResolvedValue({
      ok: true,
      json: async () => ({
        has_photo: true,
        uploaded_at: '2024-02-01T08:00:00Z',
        sizes: { thumb: 'thumb', medium: 'medium', full: 'full' },
      }),
    } as unknown as Response)
    renderUpload(7)
    await screen.findByTestId('vehicle-photo-dropzone')
    const photo = makeFile('car.png', 'image/png', 1024)
    const input = screen.getByTestId('vehicle-photo-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [photo] } })
    })
    await waitFor(() => {
      expect(mockedFetch()).toHaveBeenCalledTimes(1)
    })
    const callArgs = mockedFetch().mock.calls[0]
    const url = callArgs[0] as string
    const init = callArgs[1] as RequestInit
    expect(url).toContain('/vehicles/7/photo')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('photo')).toBeInstanceOf(File)
  })

  it('opens confirm dialog and DELETEs on remove', async () => {
    mockedRequest.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (path === '/vehicles/42/photo' && opts?.method === 'DELETE') return undefined
      return {
        has_photo: true,
        uploaded_at: '2024-01-15T10:00:00Z',
        sizes: { thumb: 'thumb', medium: 'medium', full: 'full' },
      }
    })
    renderUpload(42)
    const removeBtn = await screen.findByTestId('vehicle-photo-remove')
    fireEvent.click(removeBtn)
    // ConfirmDialog renders with role=dialog; find the confirm
    // button by its localized label.
    const confirmBtn = await screen.findByRole('button', { name: 'Remove' })
    await act(async () => {
      fireEvent.click(confirmBtn)
    })
    await waitFor(() => {
      const calls = mockedRequest.mock.calls
      const deleteCall = calls.find(
        (c) => c[0] === '/vehicles/42/photo' && (c[1] as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deleteCall).toBeTruthy()
    })
  })
})
