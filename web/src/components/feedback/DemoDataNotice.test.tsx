import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../../i18n'
import { DemoDataNotice } from './DemoDataNotice'

afterEach(cleanup)

describe('DemoDataNotice', () => {
  it('identifies the local drill fixtures and their history as synthetic', () => {
    render(<DemoDataNotice vehicles={[{ vin: 'DRILL000000000001' }, { vin: '5YJ3E1EA7JF000001' }]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Sample data present')
    expect(screen.getByRole('status')).toHaveTextContent('drive and charging history are synthetic')
  })

  it('keeps a compact not-live warning visible while mobile details expand and collapse', () => {
    render(<DemoDataNotice vehicles={[{ vin: 'DRILL000000000001' }]} />)
    const notice = screen.getByTestId('demo-data-notice')
    const details = notice.querySelector('p')
    const showDetails = screen.getByRole('button', { name: 'Details' })

    expect(notice).toHaveTextContent('Not live')
    expect(showDetails).toHaveAttribute('aria-expanded', 'false')
    expect(showDetails).toHaveAttribute('aria-controls', details?.id)
    expect(details).toHaveClass('hidden')

    fireEvent.click(showDetails)
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
    expect(details).toHaveTextContent('drive and charging history are synthetic')
    expect(details).not.toHaveClass('hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Less' }))
    expect(details).toHaveClass('hidden')
  })

  it('does not label empty or real-only fleets as sample data', () => {
    const { rerender } = render(<DemoDataNotice vehicles={[]} />)
    expect(screen.queryByTestId('demo-data-notice')).not.toBeInTheDocument()
    rerender(<DemoDataNotice vehicles={[{ vin: '5YJ3E1EA7JF000001' }]} />)
    expect(screen.queryByTestId('demo-data-notice')).not.toBeInTheDocument()
  })
})
