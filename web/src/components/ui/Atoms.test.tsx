import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Badge, Button, IconBox, Toggle, Input, Select, Tooltip } from './Atoms'

// ── Badge ──

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it.each([
    ['cyan', 'text-neon-cyan'],
    ['green', 'text-neon-green'],
    ['red', 'text-neon-red'],
    ['purple', 'text-neon-purple'],
    ['amber', 'text-neon-amber'],
    ['neutral', 'text-[var(--text-secondary)]'],
  ] as const)('applies correct classes for color=%s', (color, expectedClass) => {
    const { container } = render(<Badge color={color}>Tag</Badge>)
    expect(container.firstChild).toHaveClass(expectedClass)
  })

  it('shows dot when dot prop is true', () => {
    const { container } = render(<Badge dot>Status</Badge>)
    const dots = container.querySelectorAll('.rounded-full')
    // The badge itself is rounded-full, and the dot is another rounded-full inside
    expect(dots.length).toBeGreaterThanOrEqual(2)
  })

  it('does not show dot by default', () => {
    const { container } = render(<Badge>Status</Badge>)
    // Only the badge span itself has rounded-full
    const innerSpans = container.querySelector('span > span.rounded-full')
    expect(innerSpans).toBeNull()
  })

  it('supports className override', () => {
    const { container } = render(<Badge className="custom-class">Tag</Badge>)
    expect(container.firstChild).toHaveClass('custom-class')
  })
})

// ── Button ──

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('applies neon-button class for primary variant', () => {
    render(<Button variant="primary">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('neon-button')
  })

  it('applies glass-button class for secondary variant', () => {
    render(<Button variant="secondary">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('glass-button')
  })

  it('applies neon-button-red class for danger variant', () => {
    render(<Button variant="danger">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('neon-button-red')
  })

  it('shows loading spinner when loading=true', () => {
    render(<Button loading>Saving</Button>)
    const btn = screen.getByRole('button')
    const svg = btn.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('animate-spin')
  })

  it('sets aria-busy when loading', () => {
    render(<Button loading>Saving</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('is disabled when loading', () => {
    render(<Button loading>Saving</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>No</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('renders icon when provided', () => {
    render(<Button icon={<span data-testid="icon">★</span>}>Star</Button>)
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })
})

// ── IconBox ──

describe('IconBox', () => {
  it('renders children', () => {
    render(<IconBox><span>Icon</span></IconBox>)
    expect(screen.getByText('Icon')).toBeInTheDocument()
  })

  it('applies correct color classes', () => {
    const { container } = render(<IconBox color="green"><span>G</span></IconBox>)
    expect(container.firstChild).toHaveClass('text-neon-green')
  })

  it('applies correct size classes', () => {
    const { container } = render(<IconBox size="lg"><span>L</span></IconBox>)
    expect(container.firstChild).toHaveClass('h-12', 'w-12')
  })

  it('applies default size (md)', () => {
    const { container } = render(<IconBox><span>M</span></IconBox>)
    expect(container.firstChild).toHaveClass('h-10', 'w-10')
  })
})

// ── Toggle ──

describe('Toggle', () => {
  it('renders with correct role="switch"', () => {
    render(<Toggle checked={false} onChange={() => {}} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('renders label when provided', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Dark Mode" />)
    expect(screen.getByText('Dark Mode')).toBeInTheDocument()
  })

  it('sets aria-checked=true when checked', () => {
    render(<Toggle checked={true} onChange={() => {}} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('sets aria-checked=false when unchecked', () => {
    render(<Toggle checked={false} onChange={() => {}} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })
})

// ── Input ──

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" />)
    expect(screen.getByText('Email')).toBeInTheDocument()
  })

  it('shows error message', () => {
    render(<Input error="Required field" />)
    expect(screen.getByText('Required field')).toBeInTheDocument()
  })

  it('applies glass-input class', () => {
    render(<Input data-testid="input" />)
    expect(screen.getByTestId('input')).toHaveClass('glass-input')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })
})

// ── Select ──

describe('Select', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ]

  it('renders options', () => {
    render(<Select options={options} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('renders label', () => {
    render(<Select label="Choose" options={options} />)
    expect(screen.getByText('Choose')).toBeInTheDocument()
  })

  it('applies glass-input class', () => {
    const { container } = render(<Select options={options} />)
    const select = container.querySelector('select')
    expect(select).toHaveClass('glass-input')
  })
})

// ── Tooltip ──

describe('Tooltip', () => {
  it('renders children', () => {
    render(<Tooltip content="Help text"><button>Hover me</button></Tooltip>)
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('contains tooltip content text', () => {
    render(<Tooltip content="Help text"><button>Hover me</button></Tooltip>)
    expect(screen.getByText('Help text')).toBeInTheDocument()
  })
})
