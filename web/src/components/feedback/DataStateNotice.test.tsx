import { render, screen } from '@testing-library/react'
import { DataStateNotice } from './DataStateNotice'

describe('DataStateNotice', () => {
  it.each([
    ['stale', 'Data may be stale', 'warning'],
    ['partial', 'Partial data', 'warning'],
    ['unavailable', 'Service unavailable', 'danger'],
    ['unsupported', 'Feature not supported', 'info'],
  ] as const)('renders the %s state with distinct copy and tone', (state, title, tone) => {
    const { container } = render(<DataStateNotice state={state} />)

    expect(screen.getByText(title)).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute('data-data-state', state)
    expect(container.firstChild).toHaveClass(
      tone === 'danger'
        ? 'border-neon-red/25'
        : tone === 'warning'
          ? 'border-neon-amber/25'
          : 'border-neon-cyan/25',
    )
  })

  it('accepts contextual title, body, and accessibility attributes', () => {
    render(
      <DataStateNotice
        state="partial"
        title="Telemetry coverage is incomplete"
        role="status"
        aria-live="polite"
      >
        Two vehicles did not report during this window.
      </DataStateNotice>,
    )

    expect(screen.getByText('Telemetry coverage is incomplete')).toBeInTheDocument()
    expect(screen.getByText('Two vehicles did not report during this window.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
