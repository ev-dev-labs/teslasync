/**
 * TeslaCarViz — behaviour, branch, null-safety and a11y coverage.
 *
 * Covers every export of the module:
 *   - `parseModelKey`  — the pure vehicle.model → TeslaModel resolver, across
 *     full display names, short codes, case/whitespace folding, and unknowns.
 *   - `TeslaCarViz`    — the full-size SVG: the accessible image label, the
 *     per-state status chips, the battery readout with its clamp/NaN guard, the
 *     model + size fallbacks, and the theme-aware palette (light vs dark).
 *   - `TeslaCarMini`   — the compact badge: its accessible label, charging
 *     pulse, battery clamp, and Model-X viewBox / unknown-model fallback.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` resolves to the English
 * default deterministically (mirrors the sibling VehicleGauges suite).
 * `useTheme` is stubbed to a controllable colour scheme so `useSvgPalette` can
 * be exercised on both branches without mounting the real ThemeProvider (which
 * fetches settings + reads matchMedia on mount).
 */

import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeslaCarViz, TeslaCarMini, parseModelKey, type TeslaModel } from './TeslaCarViz'

// ── Controllable theme + deterministic i18n ──────────────────────────────────

let themeMode: 'dark' | 'light' = 'dark'

vi.mock('@/components/ui/ThemeProvider', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui/ThemeProvider')>()
  return {
    ...actual,
    useTheme: () => ({ mode: { colorScheme: themeMode } }),
  }
})

vi.mock('react-i18next', async (importActual) => {
  const actual = await importActual<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

type VizProps = ComponentProps<typeof TeslaCarViz>

function makeProps(overrides: Partial<VizProps> = {}): VizProps {
  return {
    batteryLevel: 80,
    isCharging: false,
    isLocked: false,
    isClimateOn: false,
    sentryMode: false,
    speed: 0,
    size: 'md',
    model: 'model3',
    ...overrides,
  }
}

beforeEach(() => {
  themeMode = 'dark'
  // framer-motion's useReducedMotion reads matchMedia, absent in jsdom.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
})

// ── parseModelKey ────────────────────────────────────────────────────────────

describe('parseModelKey', () => {
  it('defaults to model3 for missing or blank input', () => {
    expect(parseModelKey(undefined)).toBe('model3')
    expect(parseModelKey('')).toBe('model3')
    expect(parseModelKey('   ')).toBe('model3')
  })

  it('maps full display names to their model keys', () => {
    expect(parseModelKey('Model 3')).toBe('model3')
    expect(parseModelKey('Model S')).toBe('models')
    expect(parseModelKey('Model Y')).toBe('modely')
    expect(parseModelKey('Model X')).toBe('modelx')
    expect(parseModelKey('Cybertruck')).toBe('cybertruck')
  })

  it('folds case and whitespace before matching', () => {
    expect(parseModelKey('  MODEL   X ')).toBe('modelx')
    expect(parseModelKey('model y')).toBe('modely')
    expect(parseModelKey('MODEL S PLAID')).toBe('models')
  })

  it('recognises short vehicle codes', () => {
    expect(parseModelKey('MX')).toBe('modelx')
    expect(parseModelKey('MY')).toBe('modely')
    expect(parseModelKey('MS')).toBe('models')
    expect(parseModelKey('CT')).toBe('cybertruck')
  })

  it('falls back to model3 for unrecognised values', () => {
    expect(parseModelKey('Roadster')).toBe('model3')
    expect(parseModelKey('Semi')).toBe('model3')
  })
})

// ── TeslaCarViz — accessible label + status chips ────────────────────────────

describe('TeslaCarViz — accessibility', () => {
  it('exposes the SVG as an image with a state summary label', () => {
    render(<TeslaCarViz {...makeProps({ batteryLevel: 80, isLocked: true })} />)
    const svg = screen.getByRole('img', { name: /battery 80%/i })
    const label = svg.getAttribute('aria-label') ?? ''
    expect(label).toContain('Locked')
    expect(label).not.toContain('Charging')
  })

  it('summarises charging, driving, climate and sentry in the label', () => {
    render(
      <TeslaCarViz
        {...makeProps({ isCharging: true, isClimateOn: true, sentryMode: true, speed: 42 })}
      />,
    )
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('Charging')
    expect(label).toContain('Driving')
    expect(label).toContain('Climate')
    expect(label).toContain('Sentry')
  })

  it('omits driving from the label when the vehicle is parked', () => {
    render(<TeslaCarViz {...makeProps({ speed: 0 })} />)
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).not.toContain('Driving')
  })
})

describe('TeslaCarViz — status chips', () => {
  it('renders the charging + lock chips with i18n labels', () => {
    render(<TeslaCarViz {...makeProps({ isCharging: true, isLocked: false })} />)
    expect(screen.getByText('Charging')).toBeInTheDocument()
    expect(screen.getByText('Unlocked')).toBeInTheDocument()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
  })

  it('shows the "Not Charging" chip and hides optional chips by default', () => {
    render(<TeslaCarViz {...makeProps({ isCharging: false, isLocked: true })} />)
    expect(screen.getByText('Not Charging')).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.queryByText('Climate')).not.toBeInTheDocument()
    expect(screen.queryByText('Sentry')).not.toBeInTheDocument()
  })

  it('reveals the climate and sentry chips only when active', () => {
    render(<TeslaCarViz {...makeProps({ isClimateOn: true, sentryMode: true })} />)
    expect(screen.getByText('Climate')).toBeInTheDocument()
    expect(screen.getByText('Sentry')).toBeInTheDocument()
  })
})

// ── TeslaCarViz — battery null-safety (the core bug fix) ──────────────────────

describe('TeslaCarViz — battery readout hardening', () => {
  function readout(container: HTMLElement): string {
    return container.querySelector('text')?.textContent ?? ''
  }

  it('renders a finite battery percentage verbatim', () => {
    const { container } = render(<TeslaCarViz {...makeProps({ batteryLevel: 73 })} />)
    expect(readout(container)).toBe('73%')
  })

  it('renders 0% instead of NaN% for a non-finite battery level', () => {
    const { container } = render(
      <TeslaCarViz {...makeProps({ batteryLevel: Number.NaN })} />,
    )
    expect(readout(container)).toBe('0%')
    expect(readout(container)).not.toContain('NaN')
  })

  it('clamps out-of-range battery levels into [0, 100]', () => {
    const { container: high } = render(<TeslaCarViz {...makeProps({ batteryLevel: 150 })} />)
    expect(readout(high)).toBe('100%')

    const { container: low } = render(<TeslaCarViz {...makeProps({ batteryLevel: -20 })} />)
    expect(readout(low)).toBe('0%')
  })
})

// ── TeslaCarViz — model + size fallbacks ─────────────────────────────────────

describe('TeslaCarViz — model and size handling', () => {
  const models: TeslaModel[] = ['model3', 'models', 'modely', 'modelx', 'cybertruck']

  it('renders every model variant without crashing', () => {
    for (const model of models) {
      const { container, unmount } = render(<TeslaCarViz {...makeProps({ model })} />)
      expect(container.querySelector('svg[role="img"]')).not.toBeNull()
      expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('widens the ground shadow for the Cybertruck', () => {
    const { container: ct } = render(<TeslaCarViz {...makeProps({ model: 'cybertruck' })} />)
    const { container: m3 } = render(<TeslaCarViz {...makeProps({ model: 'model3' })} />)
    expect(ct.querySelector('ellipse[cx="280"][cy="270"]')?.getAttribute('rx')).toBe('240')
    expect(m3.querySelector('ellipse[cx="280"][cy="270"]')?.getAttribute('rx')).toBe('220')
  })

  it('falls back to a known model for an unrecognised key without throwing', () => {
    const render_ = () =>
      render(<TeslaCarViz {...makeProps({ model: 'roadster' as unknown as TeslaModel })} />)
    expect(render_).not.toThrow()
    // The invalid key resolves to model3, whose ground shadow uses rx 220.
    const svg = screen.getByRole('img')
    expect(svg).toBeInTheDocument()
    expect(
      document.querySelector('ellipse[cx="280"][cy="270"]')?.getAttribute('rx'),
    ).toBe('220')
  })

  it('maps each size prop onto the expected SVG width', () => {
    const { container: sm } = render(<TeslaCarViz {...makeProps({ size: 'sm' })} />)
    const { container: md } = render(<TeslaCarViz {...makeProps({ size: 'md' })} />)
    const { container: lg } = render(<TeslaCarViz {...makeProps({ size: 'lg' })} />)
    expect(sm.querySelector('svg[role="img"]')?.getAttribute('width')).toBe('180')
    expect(md.querySelector('svg[role="img"]')?.getAttribute('width')).toBe('280')
    expect(lg.querySelector('svg[role="img"]')?.getAttribute('width')).toBe('380')
  })

  it('defaults an unknown size prop to the medium width', () => {
    const { container } = render(
      <TeslaCarViz {...makeProps({ size: 'xl' as unknown as VizProps['size'] })} />,
    )
    expect(container.querySelector('svg[role="img"]')?.getAttribute('width')).toBe('280')
  })
})

// ── TeslaCarViz — theme-aware palette ────────────────────────────────────────

describe('TeslaCarViz — theme palette', () => {
  it('adapts the ground-shadow fill to the active colour scheme', () => {
    themeMode = 'dark'
    const { container: dark } = render(<TeslaCarViz {...makeProps()} />)
    const darkFill = dark.querySelector('ellipse[cx="280"][cy="270"]')?.getAttribute('fill')

    themeMode = 'light'
    const { container: light } = render(<TeslaCarViz {...makeProps()} />)
    const lightFill = light.querySelector('ellipse[cx="280"][cy="270"]')?.getAttribute('fill')

    expect(darkFill).toBe('rgba(0,0,0,0.3)')
    expect(lightFill).toBe('rgba(0,0,0,0.08)')
    expect(darkFill).not.toBe(lightFill)
  })
})

// ── TeslaCarMini ─────────────────────────────────────────────────────────────

describe('TeslaCarMini', () => {
  it('renders an accessible badge labelled with the battery percentage', () => {
    render(<TeslaCarMini batteryLevel={55} isCharging={false} />)
    const svg = screen.getByRole('img', { name: /battery 55%/i })
    expect(svg.querySelector('path')).not.toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('Battery 55%')
  })

  it('announces charging and renders the pulse indicator when charging', () => {
    const { container } = render(<TeslaCarMini batteryLevel={40} isCharging model="modely" />)
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('Charging')
    expect(container.querySelector('animate')).not.toBeNull()
  })

  it('omits the pulse indicator while idle', () => {
    const { container } = render(<TeslaCarMini batteryLevel={40} isCharging={false} />)
    expect(container.querySelector('animate')).toBeNull()
  })

  it('clamps the battery percentage in the accessible label', () => {
    const { container: nan } = render(
      <TeslaCarMini batteryLevel={Number.NaN} isCharging={false} />,
    )
    expect(nan.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Battery 0%')

    const { container: over } = render(<TeslaCarMini batteryLevel={140} isCharging={false} />)
    expect(over.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Battery 100%')
  })

  it('uses a taller viewBox for Model X and the default box otherwise', () => {
    const { container: mx } = render(
      <TeslaCarMini batteryLevel={50} isCharging={false} model="modelx" />,
    )
    const { container: base } = render(<TeslaCarMini batteryLevel={50} isCharging={false} />)
    expect(mx.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 34')
    expect(mx.querySelector('svg')?.getAttribute('height')).toBe('34')
    expect(base.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 32')
  })

  it('falls back to the model3 silhouette for an unrecognised model', () => {
    const render_ = () =>
      render(
        <TeslaCarMini
          batteryLevel={50}
          isCharging={false}
          model={'roadster' as unknown as TeslaModel}
        />,
      )
    expect(render_).not.toThrow()
    expect(screen.getByRole('img').querySelector('path')?.getAttribute('d')).toContain('M8 22')
  })
})
