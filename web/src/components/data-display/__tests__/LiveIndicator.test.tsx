import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LiveIndicator } from '../LiveIndicator'
import type { LiveConnectionState } from '@/hooks/useLiveConnection'

let mockState: LiveConnectionState

vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: () => mockState,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

function setStatus(status: LiveConnectionState['status'], lastMessageAt: string | null = null) {
  const channel: 'open' | 'closed' | 'error' =
    status === 'connected' ? 'open' : status === 'disconnected' ? 'error' : 'closed'
  mockState = { status, lastMessageAt, channels: { sse: channel } }
}

describe('LiveIndicator', () => {
  beforeEach(() => {
    setStatus('connected', new Date().toISOString())
  })

  it('renders the connected state with the "Live" label and emerald text', () => {
    setStatus('connected', new Date().toISOString())
    const { container } = render(<LiveIndicator />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(container.querySelector('.text-emerald-300')).toBeInTheDocument()
    expect(container.querySelector('.bg-emerald-500\\/10')).toBeInTheDocument()
  })

  it('renders the reconnecting state with a spinning icon and amber text', () => {
    setStatus('reconnecting')
    const { container } = render(<LiveIndicator />)
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    expect(container.querySelector('.text-amber-300')).toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders the disconnected state with the "Offline" label and rose text', () => {
    setStatus('disconnected')
    const { container } = render(<LiveIndicator />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(container.querySelector('.text-rose-300')).toBeInTheDocument()
    expect(container.querySelector('.bg-rose-500\\/10')).toBeInTheDocument()
  })

  it('renders the unknown state with the "Unknown" label', () => {
    setStatus('unknown')
    render(<LiveIndicator />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('dot variant renders only a colored dot, no label text', () => {
    setStatus('connected', new Date().toISOString())
    const { container, queryByText } = render(<LiveIndicator variant="dot" />)
    expect(queryByText('Live')).not.toBeInTheDocument()
    const dot = container.querySelector('.h-2.w-2.rounded-full')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain('bg-emerald-400')
  })

  it('compact variant omits the timestamp even when connected', () => {
    setStatus('connected', new Date().toISOString())
    render(<LiveIndicator variant="compact" />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    // The freshness timestamp is rendered with a leading "·" in pill mode;
    // compact must not include it.
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
  })

  it('pill variant includes a relative timestamp when connected', () => {
    setStatus('connected', new Date().toISOString())
    render(<LiveIndicator variant="pill" />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText(/·/)).toBeInTheDocument()
  })

  it('pill variant omits the timestamp when disconnected', () => {
    setStatus('disconnected', new Date().toISOString())
    render(<LiveIndicator variant="pill" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
  })

  it('exposes role="status" for accessibility', () => {
    setStatus('connected', new Date().toISOString())
    render(<LiveIndicator />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
