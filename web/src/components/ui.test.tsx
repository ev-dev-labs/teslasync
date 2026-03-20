import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GlassPanel, StatusBadge, PageHeader } from './ui'

describe('GlassPanel', () => {
  it('renders children', () => {
    render(<GlassPanel>Test Content</GlassPanel>)
    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<GlassPanel className="custom">Content</GlassPanel>)
    expect(container.firstChild).toHaveClass('custom')
  })

  it('applies glass-panel base class', () => {
    const { container } = render(<GlassPanel>Content</GlassPanel>)
    expect(container.firstChild).toHaveClass('glass-panel')
  })
})

describe('StatusBadge', () => {
  it('renders online status', () => {
    render(<StatusBadge status="online" />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('renders offline status', () => {
    render(<StatusBadge status="offline" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('renders driving status', () => {
    render(<StatusBadge status="driving" />)
    expect(screen.getByText('Driving')).toBeInTheDocument()
  })

  it('renders charging status', () => {
    render(<StatusBadge status="charging" />)
    expect(screen.getByText('Charging')).toBeInTheDocument()
  })
})

describe('PageHeader', () => {
  it('renders title', () => {
    render(<PageHeader title="Dashboard" />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(<PageHeader title="Dashboard" subtitle="Overview" />)
    expect(screen.getByText('Overview')).toBeInTheDocument()
  })

  it('renders actions when provided', () => {
    render(<PageHeader title="Test" actions={<button>Click me</button>} />)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })
})
