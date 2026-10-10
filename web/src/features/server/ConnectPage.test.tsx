import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConnectPage from './ConnectPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/connect']}>
        <ConnectPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockProbe(mode: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ mode }),
    }),
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
  // jsdom has no navigation — capture the post-save redirect instead.
  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/connect' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ConnectPage', () => {
  it('renders the server and token fields', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /Connect to your server/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://teslasync.example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ts_/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 1, name: /Connect to your server/i })
    expect(heading).toHaveAttribute('data-route-focus-target', 'true')
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading.closest('[data-role="page-header"]')).toHaveClass('border-0', 'bg-transparent')
    expect(screen.getByPlaceholderText('https://teslasync.example.com')).toHaveFocus()
  })

  it('keeps introductory guidance reachable from the compact header by keyboard focus', async () => {
    renderPage()
    const help = screen.getByRole('button', { name: /More info: Connect to your server/i })
    help.focus()
    fireEvent.focus(help)
    expect(await screen.findByText('Enter your TeslaSync address to continue.')).toBeInTheDocument()
  })

  it('rejects an empty address without probing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a Server address/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves and reloads on an open-mode probe', async () => {
    mockProbe('open')
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('https://teslasync.example.com'), {
      target: { value: 'teslasync.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    await waitFor(() => {
      expect(window.localStorage.getItem('teslasync-server-base-url')).toBe('https://teslasync.example.com')
    })
    expect(window.location.href).toBe('/')
  })

  it('requires a token for forward-auth servers, then saves both', async () => {
    mockProbe('forward_auth')
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('https://teslasync.example.com'), {
      target: { value: 'https://srv.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs an Access token/i)
    expect(window.localStorage.getItem('teslasync-server-base-url')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText(/ts_/), { target: { value: 'ts_secret' } })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    await waitFor(() => {
      expect(window.sessionStorage.getItem('teslasync-access-token')).toBe('ts_secret')
    })
    expect(window.localStorage.getItem('teslasync-access-token')).toBeNull()
  })

  it('reports unreachable servers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false }),
    )
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('https://teslasync.example.com'), {
      target: { value: 'https://down.example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach/i)
  })

  it('distinguishes a rejected key from a missing key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('https://teslasync.example.com'), {
      target: { value: 'https://srv.example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText(/ts_/), { target: { value: 'ts_invalid' } })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected the Access token/i)
    expect(window.sessionStorage.getItem('teslasync-access-token')).toBeNull()
  })
})
