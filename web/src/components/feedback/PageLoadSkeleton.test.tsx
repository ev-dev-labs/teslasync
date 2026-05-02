import { render, screen } from '@testing-library/react'
import { PageLoadSkeleton } from './PageLoadSkeleton'

describe('PageLoadSkeleton', () => {
  it('renders an accessible busy region', () => {
    render(<PageLoadSkeleton />)
    const skeleton = screen.getByTestId('page-load-skeleton')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveAttribute('role', 'status')
  })

  it('renders the requested number of panels', () => {
    const { container } = render(<PageLoadSkeleton panels={5} />)
    // Each GlassPanel renders as a div with the bg-white/5 + backdrop-blur classes.
    const panels = container.querySelectorAll('.backdrop-blur-sm')
    expect(panels.length).toBe(5)
  })

  it('defaults to 3 panels when no count is provided', () => {
    const { container } = render(<PageLoadSkeleton />)
    const panels = container.querySelectorAll('.backdrop-blur-sm')
    expect(panels.length).toBe(3)
  })
})
