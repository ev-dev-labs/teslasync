import { render, screen } from '@testing-library/react'
import Logo from './Logo'

describe('Logo', () => {
  it('renders without crashing', () => {
    const { container } = render(<Logo />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders SVG with correct viewBox', () => {
    const { container } = render(<Logo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 200 200')
  })

  it('accepts and applies className prop', () => {
    const { container } = render(<Logo className="my-custom-class" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('my-custom-class')
  })

  it('applies the given size', () => {
    const { container } = render(<Logo size={64} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '64')
    expect(svg).toHaveAttribute('height', '64')
  })

  it('has the bolt icon (path element)', () => {
    const { container } = render(<Logo />)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('has a framed rect background', () => {
    const { container } = render(<Logo />)
    const rect = container.querySelector('rect')
    expect(rect).toBeInTheDocument()
  })

  it('does not show wordmark by default', () => {
    render(<Logo />)
    expect(screen.queryByText('TeslaSync')).not.toBeInTheDocument()
  })

  it('shows wordmark when showWordmark is true', () => {
    render(<Logo showWordmark />)
    expect(screen.getByText('TeslaSync')).toBeInTheDocument()
  })
})
