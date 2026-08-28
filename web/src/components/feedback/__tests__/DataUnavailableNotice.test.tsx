import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'

import { DataUnavailableNotice } from '../DataUnavailableNotice'
import { ApiError } from '@/lib/resilience'

/** HELP-04 — the rendered contract of the unavailability explainer. */

function renderNotice(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('DataUnavailableNotice', () => {
  it('renders nothing when no evidence explains the emptiness', () => {
    const { container } = renderNotice(<DataUnavailableNotice evidence={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when neither reason nor evidence is supplied', () => {
    const { container } = renderNotice(<DataUnavailableNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains a sleeping vehicle as a benign, self-resolving state', () => {
    renderNotice(<DataUnavailableNotice evidence={{ vehicleState: 'asleep' }} />)
    expect(screen.getByText(/vehicle is asleep/i)).toBeInTheDocument()
    expect(screen.getByText(/preserves range/i)).toBeInTheDocument()
  })

  it('distinguishes offline from asleep', () => {
    renderNotice(<DataUnavailableNotice evidence={{ vehicleState: 'offline' }} />)
    expect(screen.getByText(/vehicle is offline/i)).toBeInTheDocument()
  })

  it('maps a permission failure onto the unsupported data state, not a retryable one', () => {
    const { container } = renderNotice(
      <DataUnavailableNotice evidence={{ error: new ApiError('no', 403) }} />,
    )
    expect(container.querySelector('[data-data-state="unsupported"]')).not.toBeNull()
    expect(container.querySelector('[data-unavailable-reason="permission"]')).not.toBeNull()
  })

  it('maps an outage onto the unavailable data state', () => {
    const { container } = renderNotice(
      <DataUnavailableNotice evidence={{ error: new ApiError('down', 503) }} />,
    )
    expect(container.querySelector('[data-data-state="unavailable"]')).not.toBeNull()
  })

  it('maps a filter miss onto the partial data state and offers no action', () => {
    const { container } = renderNotice(
      <DataUnavailableNotice evidence={{ filtersActive: true }} />,
    )
    expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull()
    expect(screen.queryByTestId('data-unavailable-action')).not.toBeInTheDocument()
  })

  it('always states what to do', () => {
    renderNotice(<DataUnavailableNotice reason="ingestion_lag" />)
    expect(screen.getByText(/what to do/i)).toBeInTheDocument()
  })

  it('links to the relevant destination when there is one', () => {
    renderNotice(<DataUnavailableNotice reason="service_outage" />)
    expect(screen.getByTestId('data-unavailable-action')).toHaveAttribute(
      'href',
      '/system-status',
    )
  })

  it('prefers an explicit reason over the supplied evidence', () => {
    const { container } = renderNotice(
      <DataUnavailableNotice reason="retention" evidence={{ vehicleState: 'asleep' }} />,
    )
    expect(container.querySelector('[data-unavailable-reason="retention"]')).not.toBeNull()
  })
})
