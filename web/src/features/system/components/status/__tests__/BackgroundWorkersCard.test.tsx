import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { BackgroundWorkersCard } from '../BackgroundWorkersCard'
import type { WorkersHealth, WorkerStatus } from '@/api/types'

function harness(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function makeInstance(overrides: Partial<WorkerStatus>): WorkerStatus {
  return {
    name: 'notification-worker',
    host: 'http://notification-worker:8081/healthz',
    status: 'healthy',
    latency_ms: 12,
    ...overrides,
  }
}

function makeHealth(workers: WorkerStatus[]): WorkersHealth {
  return {
    workers,
    total: workers.length,
    healthy_count: workers.filter((w) => w.status === 'healthy').length,
  }
}

describe('BackgroundWorkersCard', () => {
  it('renders an empty state when no workers are reporting', () => {
    harness(<BackgroundWorkersCard health={makeHealth([])} />)
    expect(screen.getByText(/No background workers reporting/i)).toBeInTheDocument()
  })

  it('renders an empty state when health is undefined', () => {
    harness(<BackgroundWorkersCard health={undefined} />)
    expect(screen.getByText(/No background workers reporting/i)).toBeInTheDocument()
  })

  it('renders one row per worker for the single-instance default', () => {
    const health = makeHealth([
      makeInstance({ name: 'notification-worker', host: 'http://notification-worker:8081/healthz' }),
      makeInstance({ name: 'export-worker', host: 'http://export-worker:8082/healthz' }),
      makeInstance({ name: 'automation-worker', host: 'http://automation-worker:8083/healthz' }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    expect(screen.getByText('notification-worker')).toBeInTheDocument()
    expect(screen.getByText('export-worker')).toBeInTheDocument()
    expect(screen.getByText('automation-worker')).toBeInTheDocument()

    // Three groups, each marked "1 instance"
    const labels = screen.getAllByText('1 instance')
    expect(labels.length).toBe(3)

    // Top-line summary uses unique phrasing ("of N types" / "of N instances")
    // so it doesn't collide with the per-group "X / Y healthy" chips.
    expect(screen.getByText('3 of 3 types')).toBeInTheDocument()
    expect(screen.getByText('3 of 3 instances')).toBeInTheDocument()

    // Hosts are rendered short (no http:// prefix and no /healthz suffix)
    expect(screen.getByText('notification-worker:8081')).toBeInTheDocument()
    expect(screen.getByText('export-worker:8082')).toBeInTheDocument()
    expect(screen.getByText('automation-worker:8083')).toBeInTheDocument()

    // The "set *_HOSTS to scale" callout is shown when no group is replicated
    expect(screen.getByText(/Running multiple instances of a worker/i)).toBeInTheDocument()
  })

  it('groups multiple instances by name and renders each host independently', () => {
    const health = makeHealth([
      makeInstance({ name: 'notification-worker', host: 'http://nw-1:8081/healthz', latency_ms: 8 }),
      makeInstance({ name: 'notification-worker', host: 'http://nw-2:8081/healthz', latency_ms: 14 }),
      makeInstance({ name: 'notification-worker', host: 'http://nw-3:8081/healthz', latency_ms: 9 }),
      makeInstance({ name: 'export-worker', host: 'http://export-worker:8082/healthz' }),
      makeInstance({ name: 'automation-worker', host: 'http://automation-worker:8083/healthz' }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    // Each replica's host renders as a separate row
    expect(screen.getByText('nw-1:8081')).toBeInTheDocument()
    expect(screen.getByText('nw-2:8081')).toBeInTheDocument()
    expect(screen.getByText('nw-3:8081')).toBeInTheDocument()

    // Notification group shows "3 instances"
    expect(screen.getByText('3 instances')).toBeInTheDocument()

    // The notification group rollup chip carries "3 / 3 healthy" — the
    // top-line summary uses different phrasing so this match is unique.
    expect(screen.getByText('3 / 3 healthy')).toBeInTheDocument()

    // Top-line summary uses the unique phrasing
    expect(screen.getByText('5 of 5 instances')).toBeInTheDocument()
    expect(screen.getByText('3 of 3 types')).toBeInTheDocument()

    // Top-line "Replicated" badge counts the multi-instance groups
    expect(screen.getByText(/1 of 3 type/)).toBeInTheDocument()

    // The scale callout is hidden once at least one group is replicated
    expect(screen.queryByText(/Running multiple instances of a worker/i)).not.toBeInTheDocument()
  })

  it('escalates the group rollup to degraded when one instance is unhealthy', () => {
    const health = makeHealth([
      makeInstance({ name: 'notification-worker', host: 'http://nw-1:8081/healthz', status: 'healthy' }),
      makeInstance({ name: 'notification-worker', host: 'http://nw-2:8081/healthz', status: 'unhealthy' }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    // Group chip carries the partial-health count
    expect(screen.getByText('1 / 2 healthy')).toBeInTheDocument()
    // Per-instance label for the unhealthy one
    expect(screen.getByText('unhealthy')).toBeInTheDocument()
  })

  it('shows the down severity when every instance is down', () => {
    const health = makeHealth([
      makeInstance({ name: 'export-worker', host: 'http://e1:8082/healthz', status: 'down' }),
      makeInstance({ name: 'export-worker', host: 'http://e2:8082/healthz', status: 'down' }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    expect(screen.getByText('0 / 2 healthy')).toBeInTheDocument()
    // Both rows tagged "down"
    const downLabels = screen.getAllByText('down')
    expect(downLabels.length).toBe(2)
  })

  it('renders the per-instance error message when a probe fails', () => {
    const health = makeHealth([
      makeInstance({
        name: 'automation-worker',
        host: 'http://aw-1:8083/healthz',
        status: 'down',
        error: 'dial tcp: connection refused',
      }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    expect(screen.getByText(/dial tcp: connection refused/)).toBeInTheDocument()
  })

  it('renders the latency for healthy instances and falls back to em-dash for missing values', () => {
    const health = makeHealth([
      makeInstance({ name: 'notification-worker', host: 'http://nw-1:8081/healthz', latency_ms: 23 }),
      // Cast to allow undefined for the missing-latency case (defensive UI)
      makeInstance({ name: 'export-worker', host: 'http://export-worker:8082/healthz', latency_ms: undefined as unknown as number }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    expect(screen.getByText('23 ms')).toBeInTheDocument()
    // The em-dash placeholder appears for the missing-latency row
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  it('renders footer links to Admin and API logs', () => {
    const health = makeHealth([
      makeInstance({ name: 'notification-worker', host: 'http://notification-worker:8081/healthz' }),
    ])
    harness(<BackgroundWorkersCard health={health} />)

    const adminLink = screen.getByRole('link', { name: /Open Admin/ })
    expect(adminLink).toHaveAttribute('href', '/admin')

    const logsLink = screen.getByRole('link', { name: /API logs/ })
    expect(logsLink).toHaveAttribute('href', '/api-logs')
  })

  it('preserves stable React keys when two instances share the same name', () => {
    // Render once with both instances and confirm both rows exist with their host
    // text — if the keys collided, only one of the two would render.
    const health = makeHealth([
      makeInstance({ name: 'notification-worker', host: 'http://nw-a:8081/healthz' }),
      makeInstance({ name: 'notification-worker', host: 'http://nw-b:8081/healthz' }),
    ])
    const { container } = harness(<BackgroundWorkersCard health={health} />)

    expect(within(container).getByText('nw-a:8081')).toBeInTheDocument()
    expect(within(container).getByText('nw-b:8081')).toBeInTheDocument()
  })
})
