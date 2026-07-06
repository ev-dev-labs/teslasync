import { render, screen, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { ServiceStatusBanner, SystemHealthDot } from './ServiceStatus'
import type { SystemStatus } from '@/lib/resilience'

// react-i18next: return the fallback string, interpolating `{{key}}` tokens
// from the options object so the `System: {{status}}` label resolves.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts
        ? Object.entries(opts).reduce(
            (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
            fallback,
          )
        : fallback,
  }),
}))

// framer-motion: strip animation-only props and make AnimatePresence render
// (and, crucially, remove) its children synchronously so exit transitions can
// be asserted without fake timers.
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(rest)) {
            if (['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'variants'].includes(k)) continue
            safe[k] = v
          }
          return <div {...safe}>{children}</div>
        },
    },
  )
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  }
})

// Preserve the real connection-status primitives (getConnectionStatus /
// onStatusChange operate on live module state driven by window online/offline
// events) but stub the network fetch so <SystemHealthDot> never hits the wire.
vi.mock('@/lib/resilience', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resilience')>()
  return {
    ...actual,
    fetchSystemStatus: vi.fn(() => new Promise<SystemStatus>(() => {})),
  }
})

function goOffline() {
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

function goOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
}

describe('ServiceStatusBanner', () => {
  beforeEach(() => {
    // Reset module-scoped connection status back to online between tests.
    goOnline()
  })

  it('renders nothing while the connection is online', () => {
    render(<ServiceStatusBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument()
  })

  it('reveals an accessible offline banner when the connection drops', () => {
    render(<ServiceStatusBanner />)
    goOffline()

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/you are offline\. data may be stale/i)
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('styles the banner via tailwind classes, not an inline style attribute', () => {
    render(<ServiceStatusBanner />)
    goOffline()

    const banner = screen.getByRole('status')
    expect(banner).not.toHaveAttribute('style')
    expect(banner.className).toContain('bg-red-500/15')
    expect(banner.className).toContain('text-red-300')
  })

  it('hides the decorative WifiOff icon from the accessibility tree', () => {
    render(<ServiceStatusBanner />)
    goOffline()

    const icon = screen.getByRole('status').querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('reflects online→offline→online transitions', () => {
    render(<ServiceStatusBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    goOffline()
    expect(screen.getByRole('status')).toBeInTheDocument()

    goOnline()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the banner immediately when already offline at mount', () => {
    goOffline()
    render(<ServiceStatusBanner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

function makeStatus(overall: string): SystemStatus {
  return {
    overall,
    database: { status: 'ok' },
    tesla_api: { status: 'ok' },
  }
}

function renderDot(status?: SystemStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (status) client.setQueryData(['system-status'], status)
  return render(
    <QueryClientProvider client={client}>
      <SystemHealthDot />
    </QueryClientProvider>,
  )
}

describe('SystemHealthDot', () => {
  it('renders a green glowing dot for a healthy system', () => {
    renderDot(makeStatus('healthy'))
    const dot = screen.getByRole('img')
    expect(dot.className).toContain('bg-neon-green')
    expect(dot.className).toContain('shadow-')
    expect(dot).toHaveAttribute('aria-label', 'System: healthy')
  })

  it('renders an amber dot for a degraded system', () => {
    renderDot(makeStatus('degraded'))
    const dot = screen.getByRole('img')
    expect(dot.className).toContain('bg-neon-amber')
    expect(dot).toHaveAccessibleName('System: degraded')
  })

  it('renders a red dot for an unhealthy (or unrecognised) overall status', () => {
    renderDot(makeStatus('unhealthy'))
    const dot = screen.getByRole('img')
    expect(dot.className).toContain('bg-neon-red')
    expect(dot).toHaveAttribute('title', 'System: unhealthy')
  })

  it('falls back to a muted "unknown" dot while data is loading (no query cache)', () => {
    renderDot()
    const dot = screen.getByRole('img')
    expect(dot.className).toContain('bg-white/25')
    expect(dot.className).not.toContain('bg-neon-')
    expect(dot).toHaveAttribute('aria-label', 'System: unknown')
  })

  it('always exposes an accessible status graphic, never a bare/hidden node', () => {
    renderDot(makeStatus('healthy'))
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.getByRole('img').tagName).toBe('SPAN')
  })
})
