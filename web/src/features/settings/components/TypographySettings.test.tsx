// TypographySettings elevation tests.
//
// Strategy (mirrors the sibling RegionSettings.test.tsx hook-boundary pattern):
//   • `useFont()` is mocked at the `@/components/ui/FontProvider` boundary so
//     every setter is a spy and the current `prefs` are deterministic — no
//     provider, localStorage, or backend fetch is touched. The module's real
//     constants (DEFAULT_FONT_PREFS, LEADING_OPTIONS, …) still flow through via
//     `importActual`, so the assertions reference the SAME preset values the
//     component renders.
//   • react-i18next is stubbed to echo the fallback string so assertions target
//     rendered English regardless of the 'settings' namespace.
//   • fireEvent only — @testing-library/user-event is not installed in this repo
//     (see ResetSection.test.tsx / RegionSettings.test.tsx).
//   • No QueryClient/Router wrapper: the panel reads context via the mocked hook
//     and renders shared UI primitives that need no app providers.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/components/ui/FontProvider', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui/FontProvider')>()
  return { ...actual, useFont: vi.fn() }
})

import {
  useFont,
  DEFAULT_FONT_PREFS,
  LEADING_OPTIONS,
  TRACKING_OPTIONS,
  HEADING_WEIGHT_OPTIONS,
  type FontPrefs,
} from '@/components/ui/FontProvider'
import { TypographySettings } from './TypographySettings'

const mockedUseFont = useFont as unknown as Mock

// Build a full FontContext value: real prefs + every setter as a spy. Returned
// so a test can assert exactly which setter fired with which argument.
function makeFontApi(prefs: FontPrefs) {
  return {
    prefs,
    setSans: vi.fn(),
    setMono: vi.fn(),
    setCustomSans: vi.fn(),
    setCustomMono: vi.fn(),
    setScale: vi.fn(),
    setLeading: vi.fn(),
    setTracking: vi.fn(),
    setHeadingWeight: vi.fn(),
    applyPreset: vi.fn(),
    reset: vi.fn(),
    initialized: true,
  }
}

type FontApi = ReturnType<typeof makeFontApi>

function setFont(over: Partial<FontPrefs> = {}): FontApi {
  const api = makeFontApi({ ...DEFAULT_FONT_PREFS, ...over })
  mockedUseFont.mockReturnValue(api)
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  setFont()
})

describe('TypographySettings — header & preview', () => {
  it('renders the panel heading and subtitle', () => {
    setFont()
    render(<TypographySettings />)

    expect(screen.getByRole('heading', { name: 'Typography', level: 3 })).toBeInTheDocument()
    expect(screen.getByText(/Choose fonts and tune size, spacing, and weight/i)).toBeInTheDocument()
  })

  it('exposes the live preview as a named group whose label is now announced', () => {
    setFont()
    render(<TypographySettings />)

    // The `aria-label` was previously dead (no role); the harden adds
    // role="group" so screen readers surface the preview's accessible name.
    const preview = screen.getByRole('group', { name: 'Typography preview' })
    expect(preview).toBeInTheDocument()
    expect(within(preview).getByText('The quick brown fox jumps over the lazy dog')).toBeInTheDocument()
    expect(within(preview).getByText(/Sync your Tesla fleet/i)).toBeInTheDocument()
  })
})

describe('TypographySettings — font family selects', () => {
  it('renders both font selects reflecting the current preferences', () => {
    setFont({ sans: 'roboto', mono: 'fira' })
    render(<TypographySettings />)

    expect(screen.getByLabelText('UI font')).toHaveValue('roboto')
    expect(screen.getByLabelText('Monospace font')).toHaveValue('fira')
  })

  it('lists every curated sans + mono option', () => {
    setFont()
    render(<TypographySettings />)

    const sans = screen.getByLabelText('UI font')
    const mono = screen.getByLabelText('Monospace font')
    // 7 sans presets (incl. Custom) and 5 mono presets (incl. Custom).
    expect(within(sans).getAllByRole('option')).toHaveLength(7)
    expect(within(mono).getAllByRole('option')).toHaveLength(5)
    expect(within(sans).getByRole('option', { name: 'Atkinson Hyperlegible' })).toBeInTheDocument()
    expect(within(mono).getByRole('option', { name: 'JetBrains Mono' })).toBeInTheDocument()
  })

  it('routes a UI-font change to setSans with the chosen id', () => {
    const font = setFont()
    render(<TypographySettings />)

    fireEvent.change(screen.getByLabelText('UI font'), { target: { value: 'plex' } })
    expect(font.setSans).toHaveBeenCalledTimes(1)
    expect(font.setSans).toHaveBeenCalledWith('plex')
    expect(font.setMono).not.toHaveBeenCalled()
  })

  it('routes a monospace change to setMono with the chosen id', () => {
    const font = setFont()
    render(<TypographySettings />)

    fireEvent.change(screen.getByLabelText('Monospace font'), { target: { value: 'plex-mono' } })
    expect(font.setMono).toHaveBeenCalledWith('plex-mono')
  })
})

describe('TypographySettings — custom font stacks (conditional inputs)', () => {
  it('hides both custom inputs when neither family is set to "custom"', () => {
    setFont()
    render(<TypographySettings />)

    expect(screen.queryByLabelText('Custom UI font stack')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Custom monospace font stack')).not.toBeInTheDocument()
  })

  it('reveals the custom sans input and edits flow to setCustomSans', () => {
    const font = setFont({ sans: 'custom', customSans: 'Nunito' })
    render(<TypographySettings />)

    const input = screen.getByLabelText('Custom UI font stack')
    expect(input).toHaveValue('Nunito')
    fireEvent.change(input, { target: { value: "'Nunito', sans-serif" } })
    expect(font.setCustomSans).toHaveBeenCalledWith("'Nunito', sans-serif")
  })

  it('reveals the custom mono input and edits flow to setCustomMono', () => {
    const font = setFont({ mono: 'custom', customMono: 'Cascadia Code' })
    render(<TypographySettings />)

    const input = screen.getByLabelText('Custom monospace font stack')
    expect(input).toHaveValue('Cascadia Code')
    fireEvent.change(input, { target: { value: 'Consolas' } })
    expect(font.setCustomMono).toHaveBeenCalledWith('Consolas')
  })
})

describe('TypographySettings — text scale slider', () => {
  it('renders the slider with the formatted percentage of the current scale', () => {
    setFont({ scale: 1.2 })
    render(<TypographySettings />)

    expect(screen.getByRole('slider', { name: 'Text scale' })).toBeInTheDocument()
    // formatValue → `${Math.round(1.2 * 100)}%`.
    expect(screen.getByText('120%')).toBeInTheDocument()
  })

  it('emits the raw numeric value to setScale on change', () => {
    const font = setFont()
    render(<TypographySettings />)

    fireEvent.change(screen.getByRole('slider', { name: 'Text scale' }), { target: { value: '1.15' } })
    expect(font.setScale).toHaveBeenCalledWith(1.15)
  })
})

describe('TypographySettings — segmented controls', () => {
  it('labels each segmented control as an accessible group', () => {
    setFont()
    render(<TypographySettings />)

    expect(screen.getByRole('group', { name: 'Line height' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Letter spacing' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Heading weight' })).toBeInTheDocument()
  })

  it('disambiguates the "Tight" label that appears in two groups', () => {
    setFont()
    render(<TypographySettings />)

    // "Tight" is a leading AND a tracking option — the group names are what
    // make the two controls individually reachable.
    expect(screen.getAllByRole('button', { name: 'Tight' })).toHaveLength(2)
    const leading = screen.getByRole('group', { name: 'Line height' })
    expect(within(leading).getByRole('button', { name: 'Tight' })).toBeInTheDocument()
  })

  it('marks the active option in each group via aria-pressed', () => {
    // Defaults: leading 1.5 (Normal), tracking 0em (Normal), weight 700 (Bold).
    setFont()
    render(<TypographySettings />)

    const leading = screen.getByRole('group', { name: 'Line height' })
    expect(within(leading).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(leading).getByRole('button', { name: 'Tight' })).toHaveAttribute('aria-pressed', 'false')

    const weight = screen.getByRole('group', { name: 'Heading weight' })
    expect(within(weight).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends the mapped preset value to setLeading when a line-height option is clicked', () => {
    const font = setFont()
    render(<TypographySettings />)

    const leading = screen.getByRole('group', { name: 'Line height' })
    fireEvent.click(within(leading).getByRole('button', { name: 'Relaxed' }))
    expect(font.setLeading).toHaveBeenCalledWith(LEADING_OPTIONS[2])
  })

  it('sends the mapped preset value to setTracking when a letter-spacing option is clicked', () => {
    const font = setFont()
    render(<TypographySettings />)

    const tracking = screen.getByRole('group', { name: 'Letter spacing' })
    fireEvent.click(within(tracking).getByRole('button', { name: 'Wide' }))
    expect(font.setTracking).toHaveBeenCalledWith(TRACKING_OPTIONS[2])
  })

  it('sends the mapped preset value to setHeadingWeight when a weight option is clicked', () => {
    const font = setFont()
    render(<TypographySettings />)

    const weight = screen.getByRole('group', { name: 'Heading weight' })
    fireEvent.click(within(weight).getByRole('button', { name: 'Medium' }))
    expect(font.setHeadingWeight).toHaveBeenCalledWith(HEADING_WEIGHT_OPTIONS[0])
  })
})

describe('TypographySettings — reading presets & reset', () => {
  it('renders all four one-click presets', () => {
    setFont()
    render(<TypographySettings />)

    for (const name of ['Default', 'Comfortable', 'Compact', 'High legibility']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('applies the matching preset id on click', () => {
    const font = setFont()
    render(<TypographySettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Comfortable' }))
    expect(font.applyPreset).toHaveBeenCalledWith('comfortable')
  })

  it('invokes reset() from the reset control', () => {
    const font = setFont()
    render(<TypographySettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(font.reset).toHaveBeenCalledTimes(1)
  })
})
