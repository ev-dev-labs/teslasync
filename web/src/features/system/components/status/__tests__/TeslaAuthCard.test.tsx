import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { TeslaAuthCard } from '../TeslaAuthCard'

const NOW = Date.parse('2025-01-15T12:00:00Z')

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('TeslaAuthCard', () => {
  it('renders a "Connected" badge when the token is healthy and far from expiry', () => {
    const expiresAt = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString()
    withRouter(<TeslaAuthCard authenticated={true} expiresAt={expiresAt} now={NOW} />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Token expires in 30 days.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage/ })).toHaveAttribute('href', '/tesla-account')
  })

  it('warns when the token expires within 7 days', () => {
    const expiresAt = new Date(NOW + 5 * 24 * 60 * 60 * 1000).toISOString()
    withRouter(<TeslaAuthCard authenticated={true} expiresAt={expiresAt} now={NOW} />)
    expect(screen.getByText('Expires soon')).toBeInTheDocument()
    expect(screen.getByText('Token expires in 5 days.')).toBeInTheDocument()
  })

  it('flags an expired token with a re-auth CTA', () => {
    const expiresAt = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString()
    withRouter(<TeslaAuthCard authenticated={true} expiresAt={expiresAt} now={NOW} />)
    expect(screen.getByText('Token expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Re-authenticate/ })).toBeInTheDocument()
  })

  it('renders a "Not connected" state when the user is unauthenticated', () => {
    withRouter(<TeslaAuthCard authenticated={false} expiresAt={undefined} now={NOW} />)
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByText(/No Tesla account is currently connected/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Re-authenticate/ })).toBeInTheDocument()
  })

  it('falls back to "Unknown" when expiry is missing but session is authenticated', () => {
    withRouter(<TeslaAuthCard authenticated={true} expiresAt={undefined} now={NOW} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})
