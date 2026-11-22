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

  it('shows the measured service proportion without replacing the readable summary', () => {
    const { container } = withRouter(
      <HealthRow status="degraded" label="Services" summary="8 / 12 healthy"
        counts={{ healthy: 8, total: 12 }} to="/services" />,
    )
    expect(screen.getByRole('link', { name: 'Services — 8 / 12 healthy' })).toBeInTheDocument()
    expect(container.querySelector('meter')).toHaveAttribute('value', '8')
    expect(container.querySelector('meter')).toHaveAttribute('max', '12')
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('does not infer a proportion from missing measurements', () => {
    const { container } = withRouter(<HealthRow status="unknown" label="Services" summary="No data"
      counts={{ healthy: 0, total: 0 }} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(container.querySelector('meter')).toBeNull()
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
