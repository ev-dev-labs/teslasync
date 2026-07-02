import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { BackupActionsCard } from '../BackupActionsCard'
import { ToastProvider } from '@/components/feedback/Toast'

let mockTrigger: ReturnType<typeof vi.fn>

vi.mock('@/api/devtools', () => ({
  triggerQuickBackup: (...args: unknown[]) => mockTrigger(...args),
}))

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <BackupActionsCard>
            <div data-testid="content">existing rows</div>
          </BackupActionsCard>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('BackupActionsCard', () => {
  beforeEach(() => {
    mockTrigger = vi.fn()
  })

  it('renders the children and the action button', () => {
    renderCard()
    expect(screen.getByTestId('content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run quick backup now/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage backups/ })).toHaveAttribute('href', '/backup')
  })

  it('triggers the backup mutation when the button is clicked and shows a success toast', async () => {
    mockTrigger.mockResolvedValue({ id: 99, status: 'started' })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Run quick backup now/ }))
    await waitFor(() => expect(mockTrigger).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Quick backup started/i)).toBeInTheDocument()
  })

  it('disables the button while the mutation is pending', async () => {
    let resolveFn: (v: unknown) => void = () => {}
    mockTrigger.mockReturnValue(new Promise((resolve) => { resolveFn = resolve }))
    renderCard()
    const btn = screen.getByRole('button', { name: /Run quick backup now/ })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByRole('button', { name: /Starting/ })).toBeDisabled())
    resolveFn({ id: 1, status: 'started' })
  })

  it('surfaces a friendly error when the mutation fails', async () => {
    mockTrigger.mockRejectedValue(new Error('disk full'))
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Run quick backup now/ }))
    expect(await screen.findByText(/Backup failed/i)).toBeInTheDocument()
  })
})
