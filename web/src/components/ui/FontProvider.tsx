import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getApiBase } from '@/lib/resilience'
import { request } from '@/api/client'
import { broadcast, subscribe } from '@/lib/broadcast'
import { TOPICS } from '@/lib/broadcastTopics'

// ─────────────────────────────────────────────────────────────────────────────
// FontProvider — user-selectable typography, mirroring ThemeProvider.
//
// The entire app's font family / size / line-height / letter-spacing / heading
// weight is powered by a handful of CSS variables declared in index.css:
//   --font-sans --font-mono --font-scale --leading --tracking --font-weight-bold
// Tailwind (tailwind.config.js) references those vars, so changing any one of
// them re-fonts / rescales / re-weights every token-driven element at once.
//
// This provider is the single runtime writer of those vars. It persists the
// user's choices to localStorage (`teslasync-font-*`, read by the FOUC bootstrap
// in index.html + main.tsx before first paint) and to the backend `/settings`
// endpoint (`font_*` fields), and keeps other tabs in sync via the `font.changed`
// broadcast message.
// ─────────────────────────────────────────────────────────────────────────────

/** Curated UI font presets plus a free-text custom stack. */
export type FontFamilyId = 'inter' | 'system' | 'roboto' | 'source' | 'plex' | 'atkinson' | 'custom'
/** Curated monospace presets plus a free-text custom stack. */
export type MonoFamilyId = 'jetbrains' | 'fira' | 'plex-mono' | 'system' | 'custom'

export interface FontPrefs {
  sans: FontFamilyId
  mono: MonoFamilyId
  /** Free-text CSS font stack used when `sans === 'custom'`. */
  customSans: string
  /** Free-text CSS font stack used when `mono === 'custom'`. */
  customMono: string
  /** Text size multiplier written to `--font-scale`. */
  scale: number
  /** Base line-height written to `--leading`. */
  leading: number
  /** Base letter-spacing (em string) written to `--tracking`. */
  tracking: string
  /** Heading weight written to `--font-weight-bold`. */
  headingWeight: number
}

/** Resolved CSS font stacks for each non-custom preset. */
export const FONT_SANS_STACKS: Record<Exclude<FontFamilyId, 'custom'>, string> = {
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  roboto: "'Roboto', system-ui, -apple-system, sans-serif",
  source: "'Source Sans 3', system-ui, -apple-system, sans-serif",
  plex: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  atkinson: "'Atkinson Hyperlegible', system-ui, -apple-system, sans-serif",
}

export const FONT_MONO_STACKS: Record<Exclude<MonoFamilyId, 'custom'>, string> = {
  jetbrains: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  fira: "'Fira Code', ui-monospace, monospace",
  'plex-mono': "'IBM Plex Mono', ui-monospace, monospace",
  system: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

/** Fallback appended to a user's custom stack so the app stays legible. */
const CUSTOM_SANS_FALLBACK = 'system-ui, -apple-system, sans-serif'
const CUSTOM_MONO_FALLBACK = 'ui-monospace, monospace'

export const SANS_FAMILY_IDS: FontFamilyId[] = ['inter', 'system', 'roboto', 'source', 'plex', 'atkinson', 'custom']
export const MONO_FAMILY_IDS: MonoFamilyId[] = ['jetbrains', 'fira', 'plex-mono', 'system', 'custom']

// Text-scale slider bounds. Kept above the WCAG-AA body-size floor at 0.85×.
export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 1.35
export const FONT_SCALE_STEP = 0.05

// Line-height presets: Tight / Normal / Relaxed. Floor of 1.35 keeps body copy
// above the 1.4 target at the default scale while allowing a denser option.
export const LEADING_OPTIONS = [1.35, 1.5, 1.7] as const
// Letter-spacing presets: Tight / Normal / Wide.
export const TRACKING_OPTIONS = ['-0.01em', '0em', '0.03em'] as const
// Heading-weight presets: Medium / Semibold / Bold.
export const HEADING_WEIGHT_OPTIONS = [500, 600, 700] as const

export const DEFAULT_FONT_PREFS: FontPrefs = {
  sans: 'inter',
  mono: 'jetbrains',
  customSans: '',
  customMono: '',
  scale: 1,
  leading: 1.5,
  tracking: '0em',
  headingWeight: 700,
}

/** One-click reading bundles surfaced in Settings. */
export type ReadingPresetId = 'default' | 'comfortable' | 'compact' | 'legible'
export const READING_PRESETS: Record<ReadingPresetId, Partial<FontPrefs>> = {
  default: { sans: 'inter', mono: 'jetbrains', scale: 1, leading: 1.5, tracking: '0em', headingWeight: 700 },
  comfortable: { scale: 1.1, leading: 1.7, tracking: '0em' },
  compact: { scale: 0.9, leading: 1.35 },
  legible: { sans: 'atkinson', scale: 1.05, leading: 1.7, tracking: '0.03em' },
}

// ── localStorage keys (mirrors ThemeProvider's `teslasync-*` convention) ──
const LS_SANS = 'teslasync-font-family'
const LS_MONO = 'teslasync-font-mono'
const LS_CUSTOM_SANS = 'teslasync-font-custom-sans'
const LS_CUSTOM_MONO = 'teslasync-font-custom-mono'
const LS_SCALE = 'teslasync-font-scale'
const LS_LEADING = 'teslasync-font-leading'
const LS_TRACKING = 'teslasync-font-tracking'
const LS_HEADING_WEIGHT = 'teslasync-font-heading-weight'

// ── Validators / coercion — never trust stored or wire values ──

function clampScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FONT_PREFS.scale
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n))
}

function clampLeading(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FONT_PREFS.leading
  return Math.min(2.2, Math.max(1.2, n))
}

function coerceSans(v: string | null | undefined): FontFamilyId | null {
  return v && (SANS_FAMILY_IDS as string[]).includes(v) ? (v as FontFamilyId) : null
}

function coerceMono(v: string | null | undefined): MonoFamilyId | null {
  return v && (MONO_FAMILY_IDS as string[]).includes(v) ? (v as MonoFamilyId) : null
}

function coerceWeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FONT_PREFS.headingWeight
  return Math.min(900, Math.max(300, Math.round(n / 100) * 100))
}

/**
 * Parse a persisted numeric string. Returns null for absent, blank, or
 * non-finite values so the caller falls back to the default instead of
 * coercing a blank slot to a clamped floor — `Number('')` is `0`, which
 * `clampScale`/`clampLeading` would otherwise pin to their MIN bound.
 */
function parseStoredNumber(raw: string | null): number | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve the CSS font stack for the current sans preference. Falls back to
 * the Inter stack for a blank custom entry OR an unrecognised preset id, so a
 * corrupt `sans` value can never write `undefined` to `--font-sans` (this
 * runs from the pre-React FOUC bootstrap in main.tsx).
 */
export function resolveSansStack(sans: FontFamilyId, customSans: string): string {
  if (sans === 'custom') {
    const c = (customSans ?? '').trim()
    return c ? `${c}, ${CUSTOM_SANS_FALLBACK}` : FONT_SANS_STACKS.inter
  }
  return FONT_SANS_STACKS[sans] ?? FONT_SANS_STACKS.inter
}

/**
 * Resolve the CSS font stack for the current monospace preference. Falls back
 * to the JetBrains Mono stack for a blank custom entry OR an unrecognised
 * preset id, mirroring {@link resolveSansStack}.
 */
export function resolveMonoStack(mono: MonoFamilyId, customMono: string): string {
  if (mono === 'custom') {
    const c = (customMono ?? '').trim()
    return c ? `${c}, ${CUSTOM_MONO_FALLBACK}` : FONT_MONO_STACKS.jetbrains
  }
  return FONT_MONO_STACKS[mono] ?? FONT_MONO_STACKS.jetbrains
}

/**
 * Write the typography CSS variables onto <html>. This is the ONE place the
 * `--font-*` runtime values are set. Keep in sync with the FOUC bootstrap in
 * index.html + main.tsx.
 */
export function applyFontCSS(prefs: FontPrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--font-sans', resolveSansStack(prefs.sans, prefs.customSans))
  root.style.setProperty('--font-mono', resolveMonoStack(prefs.mono, prefs.customMono))
  root.style.setProperty('--font-scale', String(prefs.scale))
  root.style.setProperty('--leading', String(prefs.leading))
  root.style.setProperty('--tracking', prefs.tracking)
  root.style.setProperty('--font-weight-bold', String(prefs.headingWeight))
}

/** Read the persisted preferences from localStorage, falling back to defaults. */
export function readStoredFontPrefs(): FontPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_FONT_PREFS }
  try {
    const scale = parseStoredNumber(localStorage.getItem(LS_SCALE))
    const leading = parseStoredNumber(localStorage.getItem(LS_LEADING))
    const weight = parseStoredNumber(localStorage.getItem(LS_HEADING_WEIGHT))
    return {
      sans: coerceSans(localStorage.getItem(LS_SANS)) ?? DEFAULT_FONT_PREFS.sans,
      mono: coerceMono(localStorage.getItem(LS_MONO)) ?? DEFAULT_FONT_PREFS.mono,
      customSans: localStorage.getItem(LS_CUSTOM_SANS) ?? DEFAULT_FONT_PREFS.customSans,
      customMono: localStorage.getItem(LS_CUSTOM_MONO) ?? DEFAULT_FONT_PREFS.customMono,
      scale: scale != null ? clampScale(scale) : DEFAULT_FONT_PREFS.scale,
      leading: leading != null ? clampLeading(leading) : DEFAULT_FONT_PREFS.leading,
      tracking: localStorage.getItem(LS_TRACKING) ?? DEFAULT_FONT_PREFS.tracking,
      headingWeight: weight != null ? coerceWeight(weight) : DEFAULT_FONT_PREFS.headingWeight,
    }
  } catch {
    return { ...DEFAULT_FONT_PREFS }
  }
}

function persistLocal(p: FontPrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_SANS, p.sans)
    localStorage.setItem(LS_MONO, p.mono)
    localStorage.setItem(LS_CUSTOM_SANS, p.customSans)
    localStorage.setItem(LS_CUSTOM_MONO, p.customMono)
    localStorage.setItem(LS_SCALE, String(p.scale))
    localStorage.setItem(LS_LEADING, String(p.leading))
    localStorage.setItem(LS_TRACKING, p.tracking)
    localStorage.setItem(LS_HEADING_WEIGHT, String(p.headingWeight))
  } catch {
    // Quota / private mode — best-effort; CSS vars + backend still carry state.
  }
}

/** Map font prefs onto the backend `/settings` `font_*` field shape. */
function toBackend(p: FontPrefs): Record<string, unknown> {
  return {
    font_family: p.sans,
    font_mono: p.mono,
    font_custom_sans: p.customSans,
    font_custom_mono: p.customMono,
    font_scale: p.scale,
    font_leading: p.leading,
    font_tracking: p.tracking,
    font_heading_weight: p.headingWeight,
  }
}

/** Overlay any `font_*` fields present in a backend settings blob onto prefs. */
function mergeFromBackend(prev: FontPrefs, s: Record<string, unknown>): FontPrefs {
  const next: FontPrefs = { ...prev }
  const sans = coerceSans(typeof s.font_family === 'string' ? s.font_family : null)
  if (sans) next.sans = sans
  const mono = coerceMono(typeof s.font_mono === 'string' ? s.font_mono : null)
  if (mono) next.mono = mono
  if (typeof s.font_custom_sans === 'string') next.customSans = s.font_custom_sans
  if (typeof s.font_custom_mono === 'string') next.customMono = s.font_custom_mono
  if (typeof s.font_scale === 'number' && s.font_scale > 0) next.scale = clampScale(s.font_scale)
  if (typeof s.font_leading === 'number' && s.font_leading > 0) next.leading = clampLeading(s.font_leading)
  if (typeof s.font_tracking === 'string' && s.font_tracking) next.tracking = s.font_tracking
  if (typeof s.font_heading_weight === 'number' && s.font_heading_weight > 0) next.headingWeight = coerceWeight(s.font_heading_weight)
  return next
}

interface FontContextValue {
  prefs: FontPrefs
  setSans: (id: FontFamilyId) => void
  setMono: (id: MonoFamilyId) => void
  setCustomSans: (stack: string) => void
  setCustomMono: (stack: string) => void
  setScale: (n: number) => void
  setLeading: (n: number) => void
  setTracking: (t: string) => void
  setHeadingWeight: (w: number) => void
  applyPreset: (id: ReadingPresetId) => void
  reset: () => void
  /** True once the initial backend hydration attempt has settled. */
  initialized: boolean
}

const FontContext = createContext<FontContextValue | null>(null)

export function useFont(): FontContextValue {
  const ctx = useContext(FontContext)
  if (!ctx) throw new Error('useFont must be used within FontProvider')
  return ctx
}

export function FontProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<FontPrefs>(() => readStoredFontPrefs())
  const [initialized, setInitialized] = useState(false)

  // Keep a ref of the latest prefs so setters can compute the next value
  // without stale closures and without side effects inside the state updater.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  // Apply CSS vars on every prefs change — covers local edits AND cross-tab
  // updates (which only call setPrefs). localStorage is written eagerly in the
  // setters below so peer tabs read fresh values on the `font.changed` hint.
  useEffect(() => {
    applyFontCSS(prefs)
  }, [prefs])

  // Load persisted font prefs from backend settings on first mount. Raw fetch,
  // like ThemeProvider — the provider mounts before auth context exists.
  useEffect(() => {
    fetch(`${getApiBase()}/api/v1/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Record<string, unknown> | null) => {
        if (!s) return
        const merged = mergeFromBackend(prefsRef.current, s)
        prefsRef.current = merged
        persistLocal(merged)
        setPrefs(merged)
      })
      .catch(() => {})
      .finally(() => setInitialized(true))
  }, [])

  // Persist to backend (fire-and-forget). Mirrors ThemeProvider: read current
  // settings, then PUT the full blob with the font_* fields merged in.
  const saveToBackend = useCallback(
    (p: FontPrefs) => {
      if (!initialized) return
      request<Record<string, unknown>>('/settings')
        .then((current) => {
          if (!current) return
          request('/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...current, ...toBackend(p) }),
          }).catch(() => {})
        })
        .catch(() => {})
    },
    [initialized],
  )

  const update = useCallback(
    (patch: Partial<FontPrefs>) => {
      const next = { ...prefsRef.current, ...patch }
      prefsRef.current = next
      persistLocal(next)
      saveToBackend(next)
      broadcast({ type: TOPICS.FONT_CHANGED })
      setPrefs(next)
    },
    [saveToBackend],
  )

  const setSans = useCallback((id: FontFamilyId) => update({ sans: id }), [update])
  const setMono = useCallback((id: MonoFamilyId) => update({ mono: id }), [update])
  const setCustomSans = useCallback((stack: string) => update({ sans: 'custom', customSans: stack }), [update])
  const setCustomMono = useCallback((stack: string) => update({ mono: 'custom', customMono: stack }), [update])
  const setScale = useCallback((n: number) => update({ scale: clampScale(n) }), [update])
  const setLeading = useCallback((n: number) => update({ leading: clampLeading(n) }), [update])
  const setTracking = useCallback((t: string) => update({ tracking: t }), [update])
  const setHeadingWeight = useCallback((w: number) => update({ headingWeight: coerceWeight(w) }), [update])
  const applyPreset = useCallback((id: ReadingPresetId) => update(READING_PRESETS[id]), [update])
  const reset = useCallback(() => update({ ...DEFAULT_FONT_PREFS }), [update])

  // Cross-tab sync: a peer tab's `font.changed` means it already wrote the
  // `teslasync-font-*` keys; re-read them and re-apply. We do NOT rebroadcast
  // or re-persist to the backend, which would loop and duplicate writes.
  useEffect(() => {
    return subscribe((m) => {
      if (m.type === TOPICS.FONT_CHANGED) {
        const fresh = readStoredFontPrefs()
        prefsRef.current = fresh
        setPrefs(fresh)
      }
    })
  }, [])

  return (
    <FontContext.Provider
      value={{
        prefs,
        setSans,
        setMono,
        setCustomSans,
        setCustomMono,
        setScale,
        setLeading,
        setTracking,
        setHeadingWeight,
        applyPreset,
        reset,
        initialized,
      }}
    >
      {children}
    </FontContext.Provider>
  )
}
