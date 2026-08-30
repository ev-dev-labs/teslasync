import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'

import { ActionableEmptyState } from '../ActionableEmptyState'
import { getEmptyStateGuidance } from '@/lib/emptyStateGuidance'

/** HELP-02 — the rendered contract of the governed empty state. */

function renderState(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ActionableEmptyState', () => {
  it('renders meaning, prerequisite and likely cause', () => {
    const guidance = getEmptyStateGuidance('drives.list')!
    renderState(<ActionableEmptyState guidanceId="drives.list" />)

    expect(screen.getByText(guidance.meaningFallback)).toBeInTheDocument()
    expect(screen.getByText(guidance.prerequisiteFallback)).toBeInTheDocument()
    expect(screen.getByText(guidance.likelyCauseFallback)).toBeInTheDocument()
  })

  it('labels the prerequisite and cause rows so they are not just prose', () => {
    renderState(<ActionableEmptyState guidanceId="drives.list" />)
    expect(screen.getByText(/what has to happen first/i)).toBeInTheDocument()
    expect(screen.getByText(/most likely reason/i)).toBeInTheDocument()
  })

  it('renders exactly one action, as a link to the canonical route', () => {
    const guidance = getEmptyStateGuidance('automations.list')!
    renderState(<ActionableEmptyState guidanceId="automations.list" />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', guidance.action.to)
    expect(links[0]).toHaveTextContent(guidance.action.labelFallback)
  })

  it('announces itself as a status region for assistive tech', () => {
    renderState(<ActionableEmptyState guidanceId="drives.list" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('exposes the guidance id for auditing which surfaces are governed', () => {
    renderState(<ActionableEmptyState guidanceId="signals.live" />)
    expect(screen.getByTestId('actionable-empty-state')).toHaveAttribute(
      'data-guidance-id',
      'signals.live',
    )
  })

  it('lets a caller override the likely cause with better live evidence', () => {
    const guidance = getEmptyStateGuidance('signals.live')!
    renderState(
      <ActionableEmptyState
        guidanceId="signals.live"
        likelyCauseOverride="The vehicle went to sleep 4 minutes ago."
      />,
    )
    expect(screen.getByText('The vehicle went to sleep 4 minutes ago.')).toBeInTheDocument()
    expect(screen.queryByText(guidance.likelyCauseFallback)).not.toBeInTheDocument()
  })

  it('degrades to a plain message for an unknown guidance id — never a blank panel', () => {
    renderState(
      <ActionableEmptyState guidanceId="nope.nope" fallbackMessage="Nothing recorded yet." />,
    )
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('still renders a generic message when no fallback is supplied', () => {
    renderState(<ActionableEmptyState guidanceId="nope.nope" />)
    expect(screen.getByRole('status')).toHaveTextContent(/no data available/i)
  })
})
