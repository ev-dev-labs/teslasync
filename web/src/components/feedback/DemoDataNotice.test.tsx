import { cleanup, render, screen } from '@testing-library/react'
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

  it('does not label empty or real-only fleets as sample data', () => {
    const { rerender } = render(<DemoDataNotice vehicles={[]} />)
    expect(screen.queryByTestId('demo-data-notice')).not.toBeInTheDocument()
    rerender(<DemoDataNotice vehicles={[{ vin: '5YJ3E1EA7JF000001' }]} />)
    expect(screen.queryByTestId('demo-data-notice')).not.toBeInTheDocument()
  })
})
