import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import APIKeys from './APIKeys'

vi.mock('../api', () => ({
  getAPIKeys: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: 'Production Key',
      key_prefix: 'ts_prod_****',
      permissions: 'read-write',
      created_at: '2024-01-01T00:00:00Z',
      last_used_at: '2024-01-10T08:30:00Z',
      expires_at: null,
    },
    {
      id: 2,
      name: 'Read Only Key',
      key_prefix: 'ts_ro_****',
      permissions: 'read',
      created_at: '2024-01-05T00:00:00Z',
      last_used_at: null,
      expires_at: null,
    },
  ]),
  createAPIKey: vi.fn().mockResolvedValue({ key: 'ts_new_abc123' }),
  deleteAPIKey: vi.fn().mockResolvedValue({}),
  revokeAPIKey: vi.fn().mockResolvedValue({}),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

const renderPage = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <APIKeys />
      </BrowserRouter>
    </QueryClientProvider>,
  )

describe('APIKeys', () => {
  it('renders page header', () => {
    renderPage()
    expect(screen.getByText('API Keys')).toBeInTheDocument()
    expect(screen.getByText(/Manage programmatic access/)).toBeInTheDocument()
  })

  it('renders create key button', () => {
    renderPage()
    expect(screen.getByText('Create Key')).toBeInTheDocument()
  })

  it('renders API key list', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })
    expect(screen.getByText('Read Only Key')).toBeInTheDocument()
  })

  it('shows key permissions badges', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Read-Write/)).toBeInTheDocument()
    })
  })

  it('shows key prefix', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ts_prod_****')).toBeInTheDocument()
    })
  })

  it('handles empty key list', async () => {
    const { getAPIKeys } = await import('../api')
    vi.mocked(getAPIKeys).mockResolvedValueOnce([])

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <APIKeys />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No API keys')).toBeInTheDocument()
    })
    expect(screen.getByText(/Create an API key to enable programmatic access/)).toBeInTheDocument()
  })
})
