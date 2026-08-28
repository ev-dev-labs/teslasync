import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'

import { DataSourceNotice, type DataSourceDescriptor } from '../DataSourceNotice'
import { ApiError } from '@/lib/resilience'

/**
 * HELP-04 reachability through the shared page-level surface.
 *
 * `<PageContainer dataSources={…}>` renders `<DataSourceNotice>`, which is the
 * one place 26 pages already funnel their query state through. Wiring the
 * unavailability classifier here is what turns it from an imported-but-never-
 * invoked module into something that actually runs on a real page.
 *
 * The bug these tests prevent: DataStateNotice imported the classifier while
 * no caller ever passed `reason` or `evidence`, so the classification branch
 * was dead on every render — and the old reachability test still passed,
 * because it only checked that the import existed.
 */

function renderNotice(
  sources: DataSourceDescriptor[],
  evidence?: React.ComponentProps<typeof DataSourceNotice>['evidence'],
) {
  return render(
    <MemoryRouter>
      <DataSourceNotice sources={sources} evidence={evidence} />
    </MemoryRouter>,
  )
}

/** A source whose only fetch failed outright (no cached data). */
function failedSource(error: unknown, id = 'primary'): DataSourceDescriptor {
  return {
    id,
    label: 'Drives',
    query: { isError: true, error, data: undefined, refetch: vi.fn() },
  }
}

/** A source that has data — keeps the notice out of the `unavailable` branch. */
function readySource(id = 'secondary'): DataSourceDescriptor {
  return { id, label: 'Vehicles', query: { data: [{ id: 1 }], isSuccess: true } }
}

describe('DataSourceNotice — classifier wiring', () => {
  it('explains a permission failure instead of a generic outage message', () => {
    const { container } = renderNotice([failedSource(new ApiError('nope', 403))])

    expect(container.querySelector('[data-unavailable-reason="permission"]')).not.toBeNull()
    expect(screen.getByText(/cannot read this data/i)).toBeInTheDocument()
    // The remedy is specific: retrying is pointless, so it must not be implied.
    expect(screen.getByText(/Request access from an administrator/i)).toBeInTheDocument()
  })

  it('re-maps the data state to match the cause, not the caller’s guess', () => {
    // The aggregate state for "no usable data" is `unavailable`, but a 403 is
    // not a transient outage — the taxonomy says `unsupported`, and the
    // rendered state must agree with the explanation shown next to it.
    const { container } = renderNotice([failedSource(new ApiError('nope', 403))])
    expect(container.querySelector('[data-data-state="unsupported"]')).not.toBeNull()
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeNull()
  })

  it('explains a dependency outage as recoverable', () => {
    const { container } = renderNotice([failedSource(new ApiError('down', 503))])
    expect(container.querySelector('[data-unavailable-reason="service_outage"]')).not.toBeNull()
    expect(screen.getByText(/recovers automatically/i)).toBeInTheDocument()
  })

  it('lets a page contribute evidence a query result cannot express', () => {
    // A sleeping vehicle is benign and costs range to wake — the single most
    // valuable thing to say, and something no query error contains. Uses a
    // failure with no error object, because the taxonomy deliberately ranks a
    // real outage above a sleeping vehicle when both are present.
    const { container } = renderNotice(
      [{ id: 'primary', label: 'Signals', query: { isError: true, data: undefined } }],
      { vehicleState: 'asleep' },
    )

    expect(container.querySelector('[data-unavailable-reason="vehicle_asleep"]')).not.toBeNull()
    expect(screen.getByText(/preserves range/i)).toBeInTheDocument()
  })

  it('lets a real outage outrank page-supplied vehicle state', () => {
    // Priority is load-bearing: during an outage a stale timestamp is a
    // symptom, not the cause, and telling the user to wait for the car to
    // wake would send them after the wrong thing.
    const { container } = renderNotice([failedSource(new ApiError('down', 503))], {
      vehicleState: 'asleep',
    })
    expect(container.querySelector('[data-unavailable-reason="service_outage"]')).not.toBeNull()
  })

  it('classifies from a refresh failure while cached data is still on screen', () => {
    const { container } = renderNotice([
      readySource(),
      {
        id: 'stale-one',
        label: 'Drives',
        query: {
          isError: true,
          error: new ApiError('nope', 403),
          data: [{ id: 9 }],
        },
      },
    ])
    expect(container.querySelector('[data-unavailable-reason="permission"]')).not.toBeNull()
  })

  it('does NOT escalate severity while usable data is still on screen', () => {
    // The aggregate state is `stale` (cached rows visible). Its cause maps to
    // `unavailable`, but letting that through would turn a quiet amber band
    // into a red alert over a page that still works.
    const { container } = renderNotice([
      readySource(),
      {
        id: 'stale-one',
        label: 'Drives',
        query: { isError: true, error: new ApiError('down', 503), data: [{ id: 9 }] },
      },
    ])
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull()
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeNull()
    // …but the cause is still explained in the body.
    expect(screen.getByText(/dependency this view needs is unreachable/i)).toBeInTheDocument()
  })

  it('falls back to the generic copy when nothing explains the failure', () => {
    // A 404 classifies as `not_found`, which the unavailability taxonomy
    // deliberately does not map to a cause — so the notice must degrade to its
    // previous behaviour, never to a blank.
    const { container } = renderNotice([failedSource(new ApiError('missing', 404))])

    expect(container.querySelector('[data-unavailable-reason]')).toBeNull()
    expect(container.querySelector('[data-data-state="unavailable"]')).not.toBeNull()
    expect(screen.getByText(/Service unavailable/i)).toBeInTheDocument()
  })

  it('renders nothing when every source is healthy', () => {
    const { container } = renderNotice([readySource()])
    expect(container).toBeEmptyDOMElement()
  })

  it('still lists per-source status alongside the explanation', () => {
    renderNotice([failedSource(new ApiError('nope', 403)), readySource()])
    expect(screen.getByText('Drives')).toBeInTheDocument()
    expect(screen.getByText('Vehicles')).toBeInTheDocument()
  })
})
