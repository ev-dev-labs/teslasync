import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SeverityBadge, SeverityIcon } from './SeverityBadge'
import { StatusDot } from './StatusDot'
import { severityTokens } from '@/lib/tokens'

describe('SeverityBadge', () => {
  it('renders the canonical severity label by default', () => {
    render(<SeverityBadge severity="critical" />)
    expect(screen.getByText('critical')).toBeInTheDocument()
  })

  it('uses children as a label override', () => {
    render(<SeverityBadge severity="warn">Warning</SeverityBadge>)
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.queryByText('warn')).not.toBeInTheDocument()
  })

  it('treats legacy "warning" the same as "warn"', () => {
    const { container: legacy } = render(<SeverityBadge severity="warning" />)
    const { container: canonical } = render(<SeverityBadge severity="warn" />)
    const legacyChip = legacy.querySelector('span')
    const canonicalChip = canonical.querySelector('span')
    expect(legacyChip?.className).toBe(canonicalChip?.className)
    expect(legacy.textContent).toBe(canonical.textContent)
  })

  it('falls back to info for unknown severity values', () => {
    render(<SeverityBadge severity="haunted" />)
    const span = screen.getByText('info')
    expect(span).toBeInTheDocument()
    const chip = span.parentElement
    expect(chip?.className).toContain(severityTokens.info.fg)
  })

  it('renders an info placeholder when severity is null', () => {
    const { container } = render(<SeverityBadge severity={null} />)
    expect(container.querySelector('span')).not.toBeNull()
    expect(screen.getByText('info')).toBeInTheDocument()
  })

  it('omits the icon when showIcon is false', () => {
    const { container } = render(<SeverityBadge severity="info" showIcon={false} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('applies size-specific classes', () => {
    const { container: sm } = render(<SeverityBadge severity="info" size="sm" />)
    const { container: md } = render(<SeverityBadge severity="info" size="md" />)
    expect(sm.querySelector('span')?.className).toContain('text-xs')
    expect(md.querySelector('span')?.className).toContain('text-sm')
  })

  it('maps "error" and "fatal" onto critical', () => {
    render(
      <>
        <SeverityBadge severity="error" />
        <SeverityBadge severity="fatal" />
      </>,
    )
    expect(screen.getAllByText('critical')).toHaveLength(2)
  })

  it('maps "ok" onto success', () => {
    render(<SeverityBadge severity="ok" />)
    expect(screen.getByText('success')).toBeInTheDocument()
  })
})

describe('SeverityIcon', () => {
  it('renders an svg colored by severity tokens', () => {
    const { container } = render(<SeverityIcon severity="critical" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('class') ?? '').toContain(severityTokens.critical.fg)
  })

  it('falls back to info for unknown values', () => {
    const { container } = render(<SeverityIcon severity={undefined} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class') ?? '').toContain(severityTokens.info.fg)
  })
})

describe('StatusDot', () => {
  it('renders a colored dot for the resolved severity', () => {
    const { container } = render(<StatusDot severity="critical" />)
    const dot = container.querySelector('span')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain(severityTokens.critical.dot)
  })

  it('falls back to info for null severity', () => {
    const { container } = render(<StatusDot severity={null} />)
    const dot = container.querySelector('span')
    expect(dot?.className).toContain(severityTokens.info.dot)
  })

  it('exposes an accessible label when provided', () => {
    render(<StatusDot severity="warn" label="Unread alert" />)
    expect(screen.getByRole('img', { name: /unread alert/i })).toBeInTheDocument()
  })
})
