import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { HealthRow } from '../HealthRow'

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('HealthRow', () => {
  it('renders label, summary, and a status-coloured dot', () => {
    withRouter(<HealthRow status="healthy" label="Services" summary="12 / 12 healthy" />)
    expect(screen.getByText('Services')).toBeInTheDocument()
    expect(screen.getByText('12 / 12 healthy')).toBeInTheDocument()
  })

  it('renders an internal link when `to` is provided', () => {
    withRouter(<HealthRow status="degraded" label="DB" summary="120ms" to="/db-health" />)
    const link = screen.getByRole('link', { name: /DB — 120ms/ })
    expect(link).toHaveAttribute('href', '/db-health')
  })

  it('opens external links in a new tab', () => {
    withRouter(
      <HealthRow status="healthy" label="Status" summary="ok" to="https://example.com" external />,
    )
    const link = screen.getByRole('link', { name: /Status — ok/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('falls back to a button when only onClick is given', () => {
    const onClick = vi.fn()
    withRouter(<HealthRow status="unhealthy" label="Tesla" summary="expired" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders a static row when neither to nor onClick is provided', () => {
    withRouter(<HealthRow status="unknown" label="Telemetry" summary="idle" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
