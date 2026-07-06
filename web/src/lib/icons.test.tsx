import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  AlertOctagon,
  AlertTriangle,
  Battery,
  CheckCircle,
  Info,
  Loader2,
} from 'lucide-react'
import { Icons, type IconKey, type LucideIcon } from './icons'

/**
 * A lucide-react icon is a `React.forwardRef` component, i.e. an object whose
 * `$$typeof` is the react.forward_ref symbol — NOT a bare function. A common
 * failure mode for a concept→icon registry is a renamed/removed lucide export
 * leaving `Icons.foo === undefined`, which React then renders as `<undefined />`
 * and crashes at runtime. This guard proves each value is genuinely renderable.
 */
function isRenderableIcon(value: unknown): boolean {
  if (typeof value === 'function') return true
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { $$typeof?: symbol }).$$typeof === Symbol.for('react.forward_ref')
  )
}

const entries = Object.entries(Icons) as [IconKey, LucideIcon][]

describe('Icons registry — structural integrity', () => {
  it('exposes a large set of unique, non-empty concept keys', () => {
    const keys = Object.keys(Icons)
    expect(keys.length).toBeGreaterThan(150)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((k) => k.length > 0)).toBe(true)
  })

  it('maps every concept to a defined, renderable lucide icon (no undefined from a renamed import)', () => {
    const broken = entries
      .filter(([, icon]) => !isRenderableIcon(icon))
      .map(([name]) => name)
    expect(entries.length).toBeGreaterThan(0)
    expect(broken).toEqual([])
  })

  it('never maps a concept to a primitive (string/number) instead of a component', () => {
    const primitives = entries
      .filter(([, icon]) => typeof icon === 'string' || typeof icon === 'number')
      .map(([name]) => name)
    expect(primitives).toEqual([])
  })

  it('is indexable by its IconKey type and typed as LucideIcon', () => {
    const key: IconKey = 'battery'
    expect(Icons[key]).toBe(Icons.battery)
    const held: LucideIcon = Icons.charging
    expect(isRenderableIcon(held)).toBe(true)
  })
})

describe('Icons registry — rendering', () => {
  it('renders every registered icon to exactly one <svg> without throwing', () => {
    const broken: string[] = []
    for (const [name, Icon] of entries) {
      const { container, unmount } = render(<Icon />)
      if (container.querySelectorAll('svg').length !== 1) broken.push(name)
      unmount()
    }
    expect(broken).toEqual([])
  })

  it('renders a genuine lucide glyph with the expected default attributes', () => {
    const { container } = render(<Icons.battery />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('stroke')).toBe('currentColor')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('class') ?? '').toContain('lucide')
  })
})

describe('Icons registry — accessibility & prop passthrough', () => {
  it('forwards aria-label + role so icon-only controls have an accessible name', () => {
    render(<Icons.close role="img" aria-label="Close menu" />)
    const el = screen.getByRole('img', { name: 'Close menu' })
    expect(el.tagName.toLowerCase()).toBe('svg')
  })

  it('marks decorative icons aria-hidden and keeps them out of the a11y tree', () => {
    const { container } = render(<Icons.info aria-hidden="true" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('applies a custom className and size to the underlying svg', () => {
    const { container } = render(<Icons.battery className="text-cyan-300" size={32} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class') ?? '').toContain('text-cyan-300')
    expect(svg?.getAttribute('width')).toBe('32')
    expect(svg?.getAttribute('height')).toBe('32')
  })
})

describe('Icons registry — documented concept aliasing', () => {
  it('collapses severity + plain warning onto AlertTriangle (documented alias)', () => {
    expect(Icons.warning).toBe(AlertTriangle)
    expect(Icons.severityWarn).toBe(AlertTriangle)
    expect(Icons.severityWarn).toBe(Icons.warning)
  })

  it('aligns severity + plain info onto Info', () => {
    expect(Icons.info).toBe(Info)
    expect(Icons.severityInfo).toBe(Info)
    expect(Icons.severityInfo).toBe(Icons.info)
  })

  it('routes critical severity to AlertOctagon and success to CheckCircle', () => {
    expect(Icons.severityCritical).toBe(AlertOctagon)
    expect(Icons.success).toBe(CheckCircle)
  })

  it('keeps semantically opposite concepts on distinct glyphs', () => {
    expect(Icons.locked).not.toBe(Icons.unlocked)
    expect(Icons.show).not.toBe(Icons.hide)
    expect(Icons.play).not.toBe(Icons.pause)
    expect(Icons.trendUp).not.toBe(Icons.trendDown)
  })

  it('gives each battery state its own glyph', () => {
    const batteryGlyphs = [
      Icons.battery,
      Icons.batteryCharging,
      Icons.batteryFull,
      Icons.batteryMedium,
      Icons.batteryWarning,
    ]
    expect(new Set(batteryGlyphs).size).toBe(batteryGlyphs.length)
    expect(Icons.battery).toBe(Battery)
  })
})

describe('Icons registry — critical concept coverage', () => {
  const required: IconKey[] = [
    'battery',
    'charging',
    'vehicle',
    'navigation',
    'notifications',
    'security',
    'media',
    'maintenance',
    'analytics',
    'user',
    'calendar',
    'add',
    'edit',
    'delete',
    'refresh',
    'search',
    'loading',
    'error',
    'success',
    'warning',
    'info',
  ]

  it('provides a renderable icon for every core app-domain concept', () => {
    const missing = required.filter((k) => !isRenderableIcon(Icons[k]))
    expect(missing).toEqual([])
  })

  it('routes the loading concept to the animatable Loader2 glyph', () => {
    expect(Icons.loading).toBe(Loader2)
  })
})
