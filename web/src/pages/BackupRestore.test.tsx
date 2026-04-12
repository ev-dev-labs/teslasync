import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BackupRestore from './BackupRestore'

vi.mock('../api', () => ({
  getBackupConfigs: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: 'Daily Full',
      enabled: true,
      backup_type: 'full',
      frequency_days: 1,
      max_retention: 7,
      provider: 'local',
      provider_config: { path: '/backups' },
      compress: true,
      encrypt: false,
      last_run_at: '2024-01-10T12:00:00Z',
      next_run_at: '2024-01-11T12:00:00Z',
    },
  ]),
  createBackupConfig: vi.fn().mockResolvedValue({}),
  updateBackupConfig: vi.fn().mockResolvedValue({}),
  deleteBackupConfig: vi.fn().mockResolvedValue({}),
  triggerBackup: vi.fn().mockResolvedValue({}),
  triggerQuickBackup: vi.fn().mockResolvedValue({}),
  getBackupRuns: vi.fn().mockResolvedValue([
    {
      id: 1,
      config_id: 1,
      status: 'completed',
      backup_type: 'full',
      provider: 'local',
      file_path: '/backups/backup-001.tar.gz',
      file_size: 1048576,
      record_count: 500,
      duration_ms: 12000,
      created_at: '2024-01-10T12:00:00Z',
      completed_at: '2024-01-10T12:00:12Z',
    },
  ]),
  downloadBackup: vi.fn(),
  verifyBackup: vi.fn().mockResolvedValue({ verified: true }),
  previewRestore: vi.fn().mockResolvedValue({ tables: [], metadata: {}, checksum_verified: true }),
}))

vi.mock('../components/feedback/Toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
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
        <BackupRestore />
      </BrowserRouter>
    </QueryClientProvider>,
  )

describe('BackupRestore', () => {
  it('renders page header', async () => {
    renderPage()
    expect(screen.getByText('Backup & Restore')).toBeInTheDocument()
    expect(screen.getByText(/Manage automated backups/)).toBeInTheDocument()
  })

  it('renders quick backup button', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Quick Backup')).toBeInTheDocument()
    })
  })

  it('renders backup stats', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Total Backups')).toBeInTheDocument()
    })
    expect(screen.getByText('Last Backup')).toBeInTheDocument()
    expect(screen.getByText('Total Size')).toBeInTheDocument()
  })

  it('renders create config button', () => {
    renderPage()
    expect(screen.getByText('New Config')).toBeInTheDocument()
  })

  it('renders backup config list', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Daily Full')).toBeInTheDocument()
    })
    expect(screen.getByText('Backup Configurations')).toBeInTheDocument()
  })

  it('renders backup history section', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Backup History')).toBeInTheDocument()
    })
  })

  it('handles empty config state', async () => {
    const { getBackupConfigs } = await import('../api')
    vi.mocked(getBackupConfigs).mockResolvedValueOnce([])

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <BackupRestore />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No backup configurations')).toBeInTheDocument()
    })
  })

  it('handles empty runs state', async () => {
    const { getBackupRuns } = await import('../api')
    vi.mocked(getBackupRuns).mockResolvedValueOnce([])

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <BackupRestore />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No backup runs yet')).toBeInTheDocument()
    })
  })
})
