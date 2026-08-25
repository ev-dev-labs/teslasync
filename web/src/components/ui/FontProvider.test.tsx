import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook, screen, act, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'

import {
  FontProvider,
  useFont,
  resolveSansStack,
  resolveMonoStack,
  applyFontCSS,
  fontStylesheetHref,
  readStoredFontPrefs,
  DEFAULT_FONT_PREFS,
  FONT_SANS_STACKS,
  FONT_MONO_STACKS,
  SANS_FAMILY_IDS,
  MONO_FAMILY_IDS,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  LEADING_OPTIONS,
  TRACKING_OPTIONS,
  HEADING_WEIGHT_OPTIONS,
  READING_PRESETS,
  type FontFamilyId,
  type MonoFamilyId,
  type FontPrefs,
} from './FontProvider'

// ─────────────────────────────────────────────────────────────────────────────
// FontProvider is a mirror of ThemeProvider: it hydrates from the backend
// `/settings` blob via a RAW `fetch` (mounts before auth context exists),
// persists edits back through the resilient `request()` client, writes six
// `--font-*` CSS vars onto <html>, and keeps peer tabs in sync via the
// `font.changed` broadcast. These tests exercise every export: the pure
// resolver/reader utilities AND the provider/hook runtime behaviour.
// ─────────────────────────────────────────────────────────────────────────────

// Fire-and-forget backend save goes through request(); make it a spy so the
// PUT contract is observable and never hits the network.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('@/api/client', () => ({ request: requestMock }))

// Preserve the real cross-tab bus (`subscribe`) but replace the outbound
// `broadcast` with a spy so we can assert the `font.changed` hint
// deterministically without depending on BroadcastChannel delivery timing.
const { broadcastSpy } = vi.hoisted(() => ({ broadcastSpy: vi.fn() }))
vi.mock('@/lib/broadcast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/broadcast')>()
  return { ...actual, broadcast: broadcastSpy }
})

// localStorage keys — mirror the private constants inside FontProvider.
const LS = {
  sans: 'teslasync-font-family',
  mono: 'teslasync-font-mono',
  customSans: 'teslasync-font-custom-sans',
  customMono: 'teslasync-font-custom-mono',
  scale: 'teslasync-font-scale',
  leading: 'teslasync-font-leading',
  tracking: 'teslasync-font-tracking',
  weight: 'teslasync-font-heading-weight',
} as const

const FONT_VARS = [
  '--font-sans',
  '--font-mono',
  '--font-scale',
  '--leading',
  '--tracking',
  '--font-weight-bold',
] as const

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

const wrapper = ({ children }: { children: ReactNode }) => <FontProvider>{children}</FontProvider>

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  document.getElementById('teslasync-active-fonts')?.remove()
  for (const v of FONT_VARS) document.documentElement.style.removeProperty(v)
  requestMock.mockReset()
  // Default: GET /settings resolves an (empty) blob so the PUT branch runs.
  requestMock.mockResolvedValue({})
  broadcastSpy.mockReset()
  // Default hydration: a non-ok response → provider keeps stored/default prefs
  // but still flips `initialized`.
  fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ── Pure utilities ───────────────────────────────────────────────────────────

describe('resolveSansStack', () => {
  it('returns the exact preset stack for a known sans id', () => {
    expect(resolveSansStack('roboto', '')).toBe(FONT_SANS_STACKS.roboto)
    expect(resolveSansStack('atkinson', 'ignored')).toBe(FONT_SANS_STACKS.atkinson)
  })

  it('appends the legible fallback to a non-empty custom stack', () => {
    const out = resolveSansStack('custom', 'Comic Sans MS')
    expect(out).toContain('Comic Sans MS,')
    expect(out).toContain('sans-serif')
  })

  it('falls back to Inter for a blank/whitespace custom stack', () => {
    expect(resolveSansStack('custom', '   ')).toBe(FONT_SANS_STACKS.inter)
    expect(resolveSansStack('custom', '')).toBe(FONT_SANS_STACKS.inter)
  })

  it('falls back to Inter for an unrecognised preset id (never returns undefined)', () => {
    // Hardening: a corrupt persisted value must not write `undefined` to
    // `--font-sans` from the pre-React FOUC bootstrap.
    expect(resolveSansStack('bogus' as FontFamilyId, '')).toBe(FONT_SANS_STACKS.inter)
    expect(resolveSansStack(undefined as unknown as FontFamilyId, '')).toBe(FONT_SANS_STACKS.inter)
  })
})

describe('resolveMonoStack', () => {
  it('returns the exact preset stack for a known mono id', () => {
    expect(resolveMonoStack('fira', '')).toBe(FONT_MONO_STACKS.fira)
    expect(resolveMonoStack('plex-mono', '')).toBe(FONT_MONO_STACKS['plex-mono'])
  })

  it('appends the mono fallback to a non-empty custom stack', () => {
    const out = resolveMonoStack('custom', 'Comic Mono')
    expect(out).toContain('Comic Mono,')
    expect(out).toContain('monospace')
  })

  it('falls back to JetBrains Mono for a blank custom or unknown id', () => {
    expect(resolveMonoStack('custom', '  ')).toBe(FONT_MONO_STACKS.jetbrains)
    expect(resolveMonoStack('nope' as MonoFamilyId, '')).toBe(FONT_MONO_STACKS.jetbrains)
  })
})

describe('applyFontCSS', () => {
  it('writes all six typography CSS variables onto <html>', () => {
    const prefs: FontPrefs = {
      ...DEFAULT_FONT_PREFS,
      sans: 'roboto',
      mono: 'fira',
      scale: 1.2,
      leading: 1.7,
      tracking: '0.03em',
      headingWeight: 600,
    }
    applyFontCSS(prefs)
    expect(cssVar('--font-sans')).toBe(FONT_SANS_STACKS.roboto)
    expect(cssVar('--font-mono')).toBe(FONT_MONO_STACKS.fira)
    expect(cssVar('--font-scale')).toBe('1.2')
    expect(cssVar('--leading')).toBe('1.7')
    expect(cssVar('--tracking')).toBe('0.03em')
    expect(cssVar('--font-weight-bold')).toBe('600')
  })

  describe('fontStylesheetHref', () => {
    it('loads only the active sans and monospace families', () => {
      const href = fontStylesheetHref(DEFAULT_FONT_PREFS)
      expect(href).toContain('family=Inter:wght@300;400;500;600;700;800;900')
      expect(href).toContain('family=JetBrains+Mono:wght@400;500;600')
      expect(href).not.toContain('Roboto')
      expect(href).not.toContain('Atkinson')
    })

    it('does not request Google Fonts for system or custom stacks', () => {
      expect(
        fontStylesheetHref({
          ...DEFAULT_FONT_PREFS,
          sans: 'system',
          mono: 'system',
        }),
      ).toBeNull()
    })
  })

  it('resolves a custom sans stack into --font-sans', () => {
    applyFontCSS({ ...DEFAULT_FONT_PREFS, sans: 'custom', customSans: 'Papyrus' })
    expect(cssVar('--font-sans')).toContain('Papyrus,')
  })
})

describe('readStoredFontPrefs', () => {
  it('returns the defaults when nothing is persisted', () => {
    expect(readStoredFontPrefs()).toEqual(DEFAULT_FONT_PREFS)
  })

  it('parses a full set of valid persisted values', () => {
    localStorage.setItem(LS.sans, 'plex')
    localStorage.setItem(LS.mono, 'fira')
    localStorage.setItem(LS.customSans, 'Foo')
    localStorage.setItem(LS.customMono, 'Bar')
    localStorage.setItem(LS.scale, '1.1')
    localStorage.setItem(LS.leading, '1.7')
    localStorage.setItem(LS.tracking, '-0.01em')
    localStorage.setItem(LS.weight, '500')
    expect(readStoredFontPrefs()).toEqual({
      sans: 'plex',
      mono: 'fira',
      customSans: 'Foo',
      customMono: 'Bar',
      scale: 1.1,
      leading: 1.7,
      tracking: '-0.01em',
      headingWeight: 500,
    })
  })

  it('coerces an unrecognised persisted sans/mono id back to the default', () => {
    localStorage.setItem(LS.sans, 'wingdings')
    localStorage.setItem(LS.mono, 'papyrus')
    const prefs = readStoredFontPrefs()
    expect(prefs.sans).toBe(DEFAULT_FONT_PREFS.sans)
    expect(prefs.mono).toBe(DEFAULT_FONT_PREFS.mono)
  })

  it('clamps out-of-range numeric values into their bounds', () => {
    localStorage.setItem(LS.scale, '9')
    localStorage.setItem(LS.leading, '0.2')
    localStorage.setItem(LS.weight, '9999')
    const prefs = readStoredFontPrefs()
    expect(prefs.scale).toBe(FONT_SCALE_MAX)
    expect(prefs.leading).toBe(1.2)
    expect(prefs.headingWeight).toBe(900)
  })

  it('rounds a heading weight to the nearest 100 within [300, 900]', () => {
    localStorage.setItem(LS.weight, '640')
    expect(readStoredFontPrefs().headingWeight).toBe(600)
    localStorage.setItem(LS.weight, '10')
    expect(readStoredFontPrefs().headingWeight).toBe(300)
  })

  it('treats a blank stored number as unset (default) rather than clamping to the floor', () => {
    // Regression: `Number('')` is 0, which clampScale/clampLeading would
    // otherwise pin to their MIN — a blank slot must mean "use the default".
    localStorage.setItem(LS.scale, '')
    localStorage.setItem(LS.leading, '   ')
    expect(readStoredFontPrefs().scale).toBe(DEFAULT_FONT_PREFS.scale)
    expect(readStoredFontPrefs().leading).toBe(DEFAULT_FONT_PREFS.leading)
  })

  it('falls back to the default for a non-numeric stored value', () => {
    localStorage.setItem(LS.scale, 'abc')
    expect(readStoredFontPrefs().scale).toBe(DEFAULT_FONT_PREFS.scale)
  })
})

describe('exported constants + presets', () => {
  it('exposes coherent family id lists including the custom escape hatch', () => {
    expect(SANS_FAMILY_IDS).toContain('inter')
    expect(SANS_FAMILY_IDS).toContain('custom')
    expect(MONO_FAMILY_IDS).toContain('jetbrains')
    expect(MONO_FAMILY_IDS).toContain('custom')
  })

  it('exposes a sane scale range and slider presets', () => {
    expect(FONT_SCALE_MIN).toBeLessThan(FONT_SCALE_MAX)
    expect(FONT_SCALE_STEP).toBeGreaterThan(0)
    expect(DEFAULT_FONT_PREFS.scale).toBeGreaterThanOrEqual(FONT_SCALE_MIN)
    expect(DEFAULT_FONT_PREFS.scale).toBeLessThanOrEqual(FONT_SCALE_MAX)
    expect(LEADING_OPTIONS).toContain(1.5)
    expect(TRACKING_OPTIONS).toContain('0em')
    expect(HEADING_WEIGHT_OPTIONS).toContain(700)
  })

  it('defines the reading presets with the expected shapes', () => {
    expect(Object.keys(READING_PRESETS)).toEqual(
      expect.arrayContaining(['default', 'comfortable', 'compact', 'legible']),
    )
    expect(READING_PRESETS.default.scale).toBe(1)
    expect(READING_PRESETS.legible.sans).toBe('atkinson')
    expect(READING_PRESETS.compact.scale).toBe(0.9)
  })
})

// ── Provider + hook ──────────────────────────────────────────────────────────

describe('useFont guard', () => {
  it('throws a helpful error when used outside a FontProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useFont())).toThrow('useFont must be used within FontProvider')
    spy.mockRestore()
  })
})

describe('FontProvider — mount + hydration', () => {
  it('starts from stored prefs, applies CSS vars, and flips initialized once hydration settles', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    expect(result.current.prefs).toEqual(DEFAULT_FONT_PREFS)
    // Effect applies the CSS vars from the initial (default) prefs.
    expect(cssVar('--font-scale')).toBe('1')
    expect(cssVar('--font-sans')).toBe(FONT_SANS_STACKS.inter)
    const stylesheet = document.getElementById('teslasync-active-fonts') as HTMLLinkElement
    expect(stylesheet.href).toContain('family=Inter')
    expect(stylesheet.href).toContain('family=JetBrains+Mono')
    await waitFor(() => expect(result.current.initialized).toBe(true))
    // Raw fetch, not the resilient client, drives hydration.
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/settings')
  })

  it('merges font_* fields from the backend blob and persists + applies them', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        font_family: 'plex',
        font_scale: 1.25,
        font_heading_weight: 500,
        font_tracking: '-0.01em',
      }),
    })
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.prefs.sans).toBe('plex'))
    expect(result.current.prefs.scale).toBe(1.25)
    expect(result.current.prefs.headingWeight).toBe(500)
    expect(result.current.prefs.tracking).toBe('-0.01em')
    expect(localStorage.getItem(LS.sans)).toBe('plex')
    expect(cssVar('--font-sans')).toBe(FONT_SANS_STACKS.plex)
  })

  it('ignores an invalid backend font_family and clamps an out-of-range scale', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ font_family: 'nonsense', font_scale: 999 }),
    })
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))
    expect(result.current.prefs.sans).toBe(DEFAULT_FONT_PREFS.sans)
    expect(result.current.prefs.scale).toBe(FONT_SCALE_MAX)
  })

  it('still flips initialized when the hydration fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))
    expect(result.current.prefs).toEqual(DEFAULT_FONT_PREFS)
  })
})

describe('FontProvider — setters', () => {
  it('setScale clamps, persists to localStorage, applies the CSS var, and broadcasts', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setScale(5))
    expect(result.current.prefs.scale).toBe(FONT_SCALE_MAX)
    expect(localStorage.getItem(LS.scale)).toBe(String(FONT_SCALE_MAX))
    expect(cssVar('--font-scale')).toBe(String(FONT_SCALE_MAX))
    expect(broadcastSpy).toHaveBeenCalledWith({ type: 'font.changed' })
  })

  it('setScale persists to the backend with a merged PUT once initialized', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setScale(1.15))

    await waitFor(() => {
      const put = requestMock.mock.calls.find((c) => c[1]?.method === 'PUT')
      expect(put).toBeTruthy()
    })
    const put = requestMock.mock.calls.find((c) => c[1]?.method === 'PUT')!
    expect(requestMock).toHaveBeenCalledWith('/settings')
    expect(JSON.parse(put[1].body as string).font_scale).toBe(1.15)
  })

  it('setSans and setMono update prefs, CSS vars, and localStorage', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setSans('roboto'))
    act(() => result.current.setMono('fira'))
    expect(result.current.prefs.sans).toBe('roboto')
    expect(result.current.prefs.mono).toBe('fira')
    expect(cssVar('--font-sans')).toBe(FONT_SANS_STACKS.roboto)
    expect(cssVar('--font-mono')).toBe(FONT_MONO_STACKS.fira)
    expect(localStorage.getItem(LS.sans)).toBe('roboto')
  })

  it('setCustomSans flips sans to custom and resolves the custom stack', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setCustomSans('Papyrus'))
    expect(result.current.prefs.sans).toBe('custom')
    expect(result.current.prefs.customSans).toBe('Papyrus')
    expect(cssVar('--font-sans')).toContain('Papyrus,')
    expect(localStorage.getItem(LS.customSans)).toBe('Papyrus')
  })

  it('setCustomMono flips mono to custom and resolves the custom stack', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setCustomMono('Comic Mono'))
    expect(result.current.prefs.mono).toBe('custom')
    expect(cssVar('--font-mono')).toContain('Comic Mono,')
  })

  it('setLeading clamps and setHeadingWeight rounds to the nearest 100', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setLeading(9))
    act(() => result.current.setHeadingWeight(640))
    expect(result.current.prefs.leading).toBe(2.2)
    expect(result.current.prefs.headingWeight).toBe(600)
    expect(cssVar('--font-weight-bold')).toBe('600')
  })

  it('setTracking passes the raw em string through to the CSS var', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setTracking('0.03em'))
    expect(result.current.prefs.tracking).toBe('0.03em')
    expect(cssVar('--tracking')).toBe('0.03em')
  })
})

describe('FontProvider — presets + reset', () => {
  it('applyPreset overlays only the preset fields, leaving the rest intact', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.applyPreset('legible'))
    expect(result.current.prefs.sans).toBe('atkinson')
    expect(result.current.prefs.scale).toBe(1.05)
    expect(result.current.prefs.leading).toBe(1.7)
    expect(result.current.prefs.tracking).toBe('0.03em')
    // 'legible' does not specify a mono → the default is preserved.
    expect(result.current.prefs.mono).toBe(DEFAULT_FONT_PREFS.mono)
  })

  it('reset restores every default and re-applies the CSS vars', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))

    act(() => result.current.setSans('roboto'))
    act(() => result.current.setScale(1.3))
    act(() => result.current.reset())
    expect(result.current.prefs).toEqual(DEFAULT_FONT_PREFS)
    expect(cssVar('--font-scale')).toBe('1')
    expect(cssVar('--font-sans')).toBe(FONT_SANS_STACKS.inter)
  })
})

describe('FontProvider — cross-tab sync', () => {
  it('re-reads localStorage and re-applies on a peer font.changed, without re-saving to the backend', async () => {
    const { result } = renderHook(() => useFont(), { wrapper })
    await waitFor(() => expect(result.current.initialized).toBe(true))
    requestMock.mockClear()

    // A peer tab already wrote the shared localStorage keys; deliver its
    // `font.changed` hint through the storage-event fallback transport.
    localStorage.setItem(LS.sans, 'roboto')
    localStorage.setItem(LS.scale, '1.15')
    act(() => {
      const env = { _from: 'peer-tab', _ts: Date.now(), msg: { type: 'font.changed' } }
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `__teslasync_bus_${Date.now()}`,
          newValue: JSON.stringify(env),
        }),
      )
    })

    await waitFor(() => {
      expect(result.current.prefs.sans).toBe('roboto')
      expect(result.current.prefs.scale).toBe(1.15)
    })
    expect(cssVar('--font-sans')).toBe(FONT_SANS_STACKS.roboto)
    // Mirroring a peer must NOT loop a backend PUT.
    expect(requestMock).not.toHaveBeenCalledWith('/settings', expect.objectContaining({ method: 'PUT' }))
  })
})

describe('FontProvider — user interaction', () => {
  function Consumer() {
    const { prefs, initialized, setScale, applyPreset, reset } = useFont()
    return (
      <div>
        <output data-testid="ready">{String(initialized)}</output>
        <output data-testid="scale">{prefs.scale}</output>
        <output data-testid="sans">{prefs.sans}</output>
        <button type="button" onClick={() => setScale(1.25)}>
          bigger
        </button>
        <button type="button" onClick={() => applyPreset('compact')}>
          compact
        </button>
        <button type="button" onClick={reset}>
          reset
        </button>
      </div>
    )
  }

  it('reflects setter clicks in the rendered consumer', async () => {
    render(
      <FontProvider>
        <Consumer />
      </FontProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))

    fireEvent.click(screen.getByRole('button', { name: 'bigger' }))
    expect(screen.getByTestId('scale')).toHaveTextContent(/^1\.25$/)

    fireEvent.click(screen.getByRole('button', { name: 'compact' }))
    expect(screen.getByTestId('scale')).toHaveTextContent(/^0\.9$/)
    // 'compact' only touches scale + leading, not the family.
    expect(screen.getByTestId('sans')).toHaveTextContent(DEFAULT_FONT_PREFS.sans)

    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(screen.getByTestId('scale')).toHaveTextContent(/^1$/)
  })
})
