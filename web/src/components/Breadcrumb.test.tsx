import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Breadcrumb } from './Breadcrumb'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumb />
    </MemoryRouter>
  )

describe('Breadcrumb', () => {
  it('renders nothing on the root path', () => {
    const { container } = renderAt('/')
    expect(container.querySelector('nav')).toBeNull()
  })

  it('renders breadcrumb items for a single-segment path', () => {
    renderAt('/vehicles')
    expect(screen.getByText('Vehicles')).toBeInTheDocument()
  })

  it('shows separators between items', () => {
    const { container } = renderAt('/vehicles')
    // ChevronRight renders as an SVG; one separator expected
    const chevrons = container.querySelectorAll('svg.lucide-chevron-right')
    expect(chevrons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders the last item as plain text (not a link)', () => {
    renderAt('/analytics')
    const text = screen.getByText('Analytics')
    expect(text.tagName).not.toBe('A')
    expect(text.closest('a')).toBeNull()
  })

  it('renders intermediate segments as links', () => {
    renderAt('/vehicles/123')
    const vehiclesLink = screen.getByText('Vehicles')
    expect(vehiclesLink.closest('a')).toHaveAttribute('href', '/vehicles')
    // Last segment (123) is not a link
    const last = screen.getByText('123')
    expect(last.closest('a')).toBeNull()
  })

  it('has a home link', () => {
    const { container } = renderAt('/drives')
    const homeLink = container.querySelector('a[href="/"]')
    expect(homeLink).toBeInTheDocument()
  })

  it('maps known route segments to readable names', () => {
    renderAt('/battery')
    expect(screen.getByText('Battery Health')).toBeInTheDocument()
  })
})
