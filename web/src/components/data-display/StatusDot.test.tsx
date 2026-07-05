import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusDot } from './StatusDot'
import { severityTokens, type Severity } from '@/lib/tokens'

// The component renders exactly one <span>; grab it non-null for assertions.
const getDot = (container: HTMLElement) => container.querySelector('span') as HTMLSpanElement

describe('StatusDot — rendering + base classes', () => {
  it('renders a single span carrying the inline-dot base classes', () => {
    const { container } = render(<StatusDot severity="info" />)
    expect(container.querySelectorAll('span')).toHaveLength(1)
    const el = getDot(container)
    expect(el.tagName).toBe('SPAN')
    expect(el.className).toContain('inline-block')
    expect(el.className).toContain('h-2')
    expect(el.className).toContain('w-2')
    expect(el.className).toContain('rounded-full')
  })

  it('merges a caller-supplied className alongside the base + colour tokens', () => {
    const { container } = render(<StatusDot severity="info" className="ml-2" />)
    const cls = getDot(container).className
    expect(cls).toContain('ml-2')
    expect(cls).toContain('rounded-full')
    expect(cls).toContain(severityTokens.info.dot)
  })
})

describe('StatusDot — severity → colour mapping', () => {
  const canonical: Severity[] = ['info', 'warn', 'critical', 'success']

  it.each(canonical)('uses the %s dot token for the canonical severity', (sev: Severity) => {
    const { container } = render(<StatusDot severity={sev} />)
    expect(getDot(container).className).toContain(severityTokens[sev].dot)
  })

  const aliases: Array<[string, Severity]> = [
    ['warning', 'warn'],
    ['error', 'critical'],
    ['fatal', 'critical'],
    ['ok', 'success'],
    ['success', 'success'],
  ]

  it.each(aliases)('normalizes the legacy alias "%s" onto the %s dot', (alias: string, want: Severity) => {
    const { container } = render(<StatusDot severity={alias} />)
    expect(getDot(container).className).toContain(severityTokens[want].dot)
  })

  it('resolves the severity case-insensitively and not merely to the info default', () => {
    const { container } = render(<StatusDot severity="CRITICAL" />)
    const cls = getDot(container).className
    expect(cls).toContain(severityTokens.critical.dot)
    expect(cls).not.toContain(severityTokens.info.dot)
  })

  const unusable: Array<string | null | undefined> = [null, undefined, '', 'haunted']

  it.each(unusable)('falls back to the info dot for the unusable severity %p', (sev: string | null | undefined) => {
    const { container } = render(<StatusDot severity={sev} />)
    expect(getDot(container).className).toContain(severityTokens.info.dot)
  })
})

describe('StatusDot — accessibility', () => {
  it('exposes a labelled graphic (role="img") with the given accessible name', () => {
    render(<StatusDot severity="warn" label="Unread alert" />)
    const el = screen.getByRole('img', { name: 'Unread alert' })
    expect(el).toBeInTheDocument()
    // A meaningful dot must NOT be hidden from assistive tech.
    expect(el).not.toHaveAttribute('aria-hidden')
  })

  it('is decorative (aria-hidden, no role, no label) when no label is given', () => {
    const { container } = render(<StatusDot severity="warn" />)
    const el = getDot(container)
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).not.toHaveAttribute('role')
    expect(el).not.toHaveAttribute('aria-label')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('treats an empty-string label as decorative — never emits aria-label=""', () => {
    const { container } = render(<StatusDot severity="warn" label="" />)
    const el = getDot(container)
    expect(el).not.toHaveAttribute('aria-label')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).not.toHaveAttribute('role')
  })
})
