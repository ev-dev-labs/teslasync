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

  it('associates address failures with the field while retaining its guidance and one alert', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const server = screen.getByRole('textbox', { name: 'Server address' })
    const token = screen.getByLabelText('Access token (optional)')
    const hintId = server.getAttribute('aria-describedby')

    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))

    const alert = await screen.findByRole('alert')
    expect(server).toHaveAttribute('aria-invalid', 'true')
    expect(server.getAttribute('aria-describedby')?.split(' ')).toEqual([alert.id, hintId])
    expect(server).toHaveAccessibleDescription(/Enter a server address.*Your self-hosted TeslaSync URL/i)
    expect(token).not.toHaveAttribute('aria-invalid')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'unsupported scheme', address: 'ftp://example.com', message: /http:\/\/ or https:\/\//i },
    { name: 'malformed address', address: 'https://[', message: /doesn't look valid/i },
    { name: 'embedded credentials', address: 'https://test-user:test-password@example.com', message: /usernames and passwords/i },
    { name: 'unsupported path', address: 'https://example.com/subpath', message: /without a \/path/i },
  ])('retains safe rejection for $name', async ({ address, message }) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: 'Server address' }), { target: { value: address } })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('textbox', { name: 'Server address' })).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('teslasync-server-base-url')).toBeNull()
  })

  it('keeps the in-flight candidate fixed and restores editable values after failure', async () => {
    let settle: (response: { ok: boolean }) => void = () => { throw new Error('Probe not started') }
    const fetchMock = vi.fn().mockImplementation(() => new Promise<{ ok: boolean }>((resolve) => {
      settle = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const server = screen.getByRole('textbox', { name: 'Server address' })
    const token = screen.getByLabelText('Access token (optional)')
    fireEvent.change(server, { target: { value: 'https://pending.example.com' } })
    fireEvent.change(token, { target: { value: 'test-only-token' } })
    const form = server.closest('form')
    if (!form) throw new Error('Missing connection form')

    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(server).toBeDisabled()
    expect(token).toBeDisabled()
    expect(screen.getByRole('button', { name: /Connecting/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Connecting/i })).toHaveAttribute('aria-busy', 'true')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://pending.example.com/api/v1/system/auth-mode', expect.objectContaining({ credentials: 'omit' }))
    expect(window.localStorage.getItem('teslasync-server-base-url')).toBeNull()

    settle({ ok: false })
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach/i)
    expect(server).toBeEnabled()
    expect(token).toBeEnabled()
    expect(server).toHaveValue('https://pending.example.com')
    expect(token).toHaveValue('test-only-token')
    expect(server).not.toHaveAttribute('aria-invalid')
    expect(token).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeEnabled()
  })

  it('uses growing mobile targets while retaining masked token entry and desktop sizing', () => {
    renderPage()
    const server = screen.getByRole('textbox', { name: 'Server address' })
    const token = screen.getByLabelText('Access token (optional)')
    const submit = screen.getByRole('button', { name: /^connect$/i })
    expect(server).toHaveClass('min-h-11', 'md:min-h-10')
    expect(token).toHaveClass('min-h-11', 'md:min-h-10')
    expect(token).toHaveAttribute('type', 'password')
    expect(token).toHaveAttribute('autocomplete', 'off')
    expect(token).toHaveValue('')
    expect(submit).toHaveClass('h-auto', 'min-h-11', 'md:min-h-10', 'whitespace-normal')
    expect(server).toHaveAttribute('inputmode', 'url')
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
    expect(screen.getByLabelText('Access token (optional)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Access token (optional)')).toHaveAccessibleDescription(/needs an access token.*Only needed/i)
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
    expect(screen.getByLabelText('Access token (optional)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'Server address' })).not.toHaveAttribute('aria-invalid')
    expect(window.sessionStorage.getItem('teslasync-access-token')).toBeNull()
  })

  it('retains both inputs and storage recovery feedback when saving is denied', async () => {
    mockProbe('open')
    renderPage()
    const server = screen.getByRole('textbox', { name: 'Server address' })
    const token = screen.getByLabelText('Access token (optional)')
    fireEvent.change(server, { target: { value: 'http://192.168.1.10:4000' } })
    fireEvent.change(token, { target: { value: 'test-only-token' } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled') })
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/browser storage is enabled/i)
    expect(server).toHaveValue('http://192.168.1.10:4000')
    expect(token).toHaveValue('test-only-token')
    expect(server).toBeEnabled()
    expect(token).toBeEnabled()
    expect(server).not.toHaveAttribute('aria-invalid')
    expect(token).not.toHaveAttribute('aria-invalid')
    expect(window.location.href).toBe('http://localhost/connect')
  })
})
