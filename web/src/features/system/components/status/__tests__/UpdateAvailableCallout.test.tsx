import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { UpdateAvailableCallout } from '../UpdateAvailableCallout'

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('UpdateAvailableCallout', () => {
  it('shows the latest version in the heading and links to the changelog', () => {
    withRouter(
      <UpdateAvailableCallout
        current="1.0.0"
        latest="1.2.0"
        checkedAt="2025-01-15T12:00:00Z"
      />,
    )
    expect(screen.getByText(/Update available — v1\.2\.0/)).toBeInTheDocument()
    expect(screen.getByText(/You're running v1\.0\.0/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View notes/ })).toHaveAttribute('href', '/changelog')
  })

  it('renders gracefully when current and checkedAt are missing', () => {
    withRouter(<UpdateAvailableCallout current={undefined} latest="1.2.0" />)
    expect(screen.getByText(/Update available — v1\.2\.0/)).toBeInTheDocument()
    expect(screen.queryByText(/You're running/)).toBeNull()
  })

  it('uses an aria-live region for accessibility', () => {
    const { getByTestId } = withRouter(
      <UpdateAvailableCallout current="1.0.0" latest="1.2.0" />,
    )
    const callout = getByTestId('update-available-callout')
    expect(callout).toHaveAttribute('aria-live', 'polite')
  })
})
