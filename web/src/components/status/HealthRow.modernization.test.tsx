import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { HealthRow } from './HealthRow'

describe('HealthRow source modernization preservation', () => {
  const label = 'A complete, long service label that remains available'
  const summary = '12 of 12 healthy, with the complete observation summary'

  it('retains the full label and summary on a noninteractive row', () => {
    render(<HealthRow status="unknown" label={label} summary={summary} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText(summary)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('preserves the callback on the shared button without navigation', () => {
    const onClick = vi.fn()
    render(<HealthRow status="degraded" label={label} summary={summary} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText(summary)).toBeInTheDocument()
  })

  it('preserves internal navigation and its complete accessible name', () => {
    const onClick = vi.fn()
    render(
      <MemoryRouter>
        <HealthRow status="healthy" label={label} summary={summary} to="/system/status" onClick={onClick} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: `${label} — ${summary}` })).toHaveAttribute('href', '/system/status')
    expect(screen.queryByRole('button')).toBeNull()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('preserves safe external-link attributes without an internal router', () => {
    render(<HealthRow status="maintenance" label={label} summary={summary} to="https://example.test/health" external />)
    const link = screen.getByRole('link', { name: `${label} — ${summary}` })
    expect(link).toHaveAttribute('href', 'https://example.test/health')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
