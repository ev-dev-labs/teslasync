import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { ActionItemsPanel } from '../ActionItemsPanel'
import { ActionItem } from '../ActionItem'

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ActionItemsPanel', () => {
  it('renders the empty state when no children are provided', () => {
    withRouter(<ActionItemsPanel>{[]}</ActionItemsPanel>)
    expect(screen.getByText('Nothing right now')).toBeInTheDocument()
  })

  it('renders a custom empty message when forceEmpty is set', () => {
    withRouter(
      <ActionItemsPanel forceEmpty emptyText="All clear ✅">
        <ActionItem severity="warn" title="ignored" />
      </ActionItemsPanel>,
    )
    expect(screen.getByText('All clear ✅')).toBeInTheDocument()
    expect(screen.queryByText('ignored')).not.toBeInTheDocument()
  })

  it('renders supplied action items', () => {
    withRouter(
      <ActionItemsPanel>
        <ActionItem severity="warn" title="Update available" description="v1.2.0" />
        <ActionItem severity="error" title="Token expired" />
      </ActionItemsPanel>,
    )
    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
    expect(screen.getByText('Token expired')).toBeInTheDocument()
    expect(screen.queryByText('Nothing right now')).not.toBeInTheDocument()
  })

  it('renders the action CTA as a router link when `to` is provided', () => {
    withRouter(
      <ActionItemsPanel>
        <ActionItem
          severity="warn"
          title="Re-auth"
          cta={{ label: 'Reconnect', to: '/tesla-account' }}
        />
      </ActionItemsPanel>,
    )
    const link = screen.getByRole('link', { name: /Reconnect/ })
    expect(link).toHaveAttribute('href', '/tesla-account')
  })
})
