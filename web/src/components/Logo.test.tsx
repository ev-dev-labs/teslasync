import { render, screen } from '@testing-library/react'
import Logo from './Logo'

describe('Logo', () => {
  it('renders without crashing', () => {
    const { container } = render(<Logo />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('contains SVG elements', () => {
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

  it('applies the given size to the SVG', () => {
    const { container } = render(<Logo size={64} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '64')
    expect(svg).toHaveAttribute('height', '64')
  })

  it('has the bolt icon (lightning bolt path)', () => {
    const { container } = render(<Logo />)
    const boltPath = container.querySelector('path[d="M105 86l-10 16h8l-6 14 15-18h-8z"]')
    expect(boltPath).toBeInTheDocument()
  })

  it('has orbital rings (ellipses)', () => {
    const { container } = render(<Logo />)
    const ellipses = container.querySelectorAll('ellipse')
    expect(ellipses.length).toBe(3)
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
