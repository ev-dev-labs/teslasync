// Behavioural coverage for InfoTile — the small "icon + label + value" tile the
// live telemetry grid stamps out for battery / speed / odometer / charger /
// sentry etc. (see TelemetryGrid). It is a pure presentational leaf, so the
// contract worth pinning is: the value-formatting branches (boolean → i18n
// Yes/No, numeric incl. the falsy 0, nullish → em-dash placeholder), the
// truncation `title` tooltip, the colour override, the optional sub-line, the
// decorative icon, and the malformed-config hardening (an undefined icon must
// not blank the tile).
//
// react-i18next is mocked so `t(key, fallback)` returns the English fallback
// deterministically AND records the exact key/fallback each label wires to —
// mirroring the sibling InputCommandTile / CategoryBadge tests. GlassPanel + cn
// render for real (they are side-effect-free wrappers), so this also proves the
// tile is mounted inside the shared panel shell. Nothing here touches network.

import type { ComponentProps, ReactNode, SVGProps, ElementType } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

import { InfoTile } from './InfoTile'

// A stub icon that forwards every prop (className, aria-hidden) to a real DOM
// node so tests can prove the glyph rendered AND is decorative.
const StubIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg data-testid="tile-icon" {...props} />
)

type Props = ComponentProps<typeof InfoTile>

function renderTile(overrides: Partial<Props> = {}) {
  const props: Props = {
    icon: StubIcon,
    label: 'Battery',
    value: '82%',
    ...overrides,
  }
  return render(<InfoTile {...props} />)
}

// The value copy lives in the tile's second <p> (the label is a <span>); grab it
// by its rendered text.
const valueNode = (text: string) => screen.getByText(text)

afterEach(() => {
  cleanup()
  mockT.mockClear()
})

describe('InfoTile', () => {
  it('renders the label, string value and a decorative icon inside the shared panel', () => {
    const { container } = renderTile({ label: 'Battery', value: '82%' })

    expect(screen.getByText('Battery')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()

    // Icon is present but decorative — screen readers must not announce it since
    // the adjacent text label already conveys the meaning.
    const icon = screen.getByTestId('tile-icon')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon.getAttribute('class') ?? '').toContain('h-3.5')

    // Mounted inside the shared GlassPanel shell (data-print-card marker).
    expect(container.querySelector('[data-print-card]')).not.toBeNull()
  })

  it('renders numeric values verbatim — including the falsy 0 (not the placeholder)', () => {
    renderTile({ value: 0 })

    const node = valueNode('0')
    expect(node).toBeInTheDocument()
    expect(node.tagName).toBe('P')
    // A `value || '—'` bug would swallow 0 → em-dash; `?? '—'` keeps it.
    expect(screen.queryByText('—')).toBeNull()
    expect(node).toHaveAttribute('title', '0')
  })

  it('maps a boolean value through i18n to Yes / No with the exact keys', () => {
    renderTile({ value: true })
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.yes', 'Yes')

    cleanup()
    mockT.mockClear()

    renderTile({ value: false })
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.no', 'No')
  })

  it('renders an em-dash placeholder for null / undefined instead of a blank body or literal "undefined"', () => {
    renderTile({ value: null })
    const dash = valueNode('—')
    expect(dash).toBeInTheDocument()
    // The truncation tooltip must never leak the literal "null"/"undefined".
    expect(dash).toHaveAttribute('title', '—')
    expect(screen.queryByText('null')).toBeNull()

    cleanup()

    renderTile({ value: undefined })
    expect(valueNode('—')).toHaveAttribute('title', '—')
    expect(screen.queryByText('undefined')).toBeNull()
    // A nullish value is not a boolean, so the Yes/No path is never taken.
    expect(mockT).not.toHaveBeenCalledWith('common.yes', 'Yes')
    expect(mockT).not.toHaveBeenCalledWith('common.no', 'No')
  })

  it('applies the theme default colour when none is supplied and honours an override', () => {
    renderTile({ value: 'Default' })
    const def = valueNode('Default')
    expect(def.className).toContain('text-[var(--text-primary)]')
    expect(def.className).toContain('text-lg')
    expect(def.className).toContain('font-semibold')

    cleanup()

    renderTile({ value: 'Custom', color: 'text-emerald-300' })
    const custom = valueNode('Custom')
    expect(custom.className).toContain('text-emerald-300')
    expect(custom.className).not.toContain('text-[var(--text-primary)]')
  })

  it('renders the optional sub-line only when provided', () => {
    renderTile({ value: '82%', sub: '312 km range' })
    expect(screen.getByText('312 km range')).toBeInTheDocument()

    cleanup()

    renderTile({ value: '82%' })
    expect(screen.queryByText('312 km range')).toBeNull()
  })

  it('exposes the full value as a title tooltip so truncated values stay readable', () => {
    const long = 'A very long odometer reading 123,456 km that will be truncated'
    renderTile({ value: long })

    const node = valueNode(long)
    expect(node).toHaveAttribute('title', long)
    expect(node.className).toContain('truncate')
  })

  it('degrades gracefully when the icon reference is missing (malformed config)', () => {
    // A config-driven tile could arrive with an undefined icon. Guarding it must
    // skip the glyph rather than throw "Element type is invalid" and blank the
    // whole tile.
    expect(() =>
      renderTile({ icon: undefined as unknown as ElementType, value: '82%' }),
    ).not.toThrow()

    expect(screen.getByText('Battery')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-icon')).toBeNull()
  })
})
