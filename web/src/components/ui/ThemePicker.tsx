import { useState, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Sun, Moon, Monitor, Sparkles } from 'lucide-react'
import { Button } from './Button'
import { Input } from './Input'
import { useTheme, type ThemeId, type ModeId, type ModeTheme, modeCategoryOrder } from './ThemeProvider'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'

/**
 * Shared theme picker.
 *
 * Single source of truth for the theme + mode + custom-colour UI. Used in
 * three places:
 *   1. The full Appearance settings page (`AppearanceSettings.tsx`) — all
 *      sections enabled.
 *   2. The top-bar quick-switcher popover (Layout.tsx) — `compact` and
 *      `showCustom={false}` to keep the popover small.
 *   3. The first-run dashboard banner — opens the same popover.
 *
 * Always renders without the page-level chrome (no GlassPanel/IconBox/title);
 * callers wrap it in whatever container they need.
 */
export interface ThemePickerProps {
  /** Render the mode (light/dark/oled/etc.) selector. Default true. */
  showMode?: boolean
  /** Render the custom-colour builder. Default true. */
  showCustom?: boolean
  /** Compact layout — denser grids, smaller swatches — for popover use. */
  compact?: boolean
  /** Optional callback fired after the user picks any theme. */
  onChange?: (themeId: ThemeId) => void
  /** Optional callback fired after the user picks any mode. */
  onModeChange?: (modeId: ModeId) => void
  /** Optional className applied to the outer container. */
  className?: string
}

const modeIcons: Record<string, ReactNode> = {
  dark: <Moon className="h-4 w-4" />,
  light: <Sun className="h-4 w-4" />,
  oled: <Monitor className="h-4 w-4" />,
  midnight: <Sparkles className="h-4 w-4" />,
  auto: <Monitor className="h-4 w-4" />,
  sunset: <Sun className="h-4 w-4" />,
  nord: <Sparkles className="h-4 w-4" />,
}

/** Fallback glyph for the 130+ generated presets that have no dedicated icon. */
function schemeIcon(scheme: 'dark' | 'light'): ReactNode {
  return scheme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
}

export function ThemePicker({
  showMode = true,
  showCustom = true,
  compact = false,
  onChange,
  onModeChange,
  className,
}: ThemePickerProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const { themeId, modeId, setTheme, setMode, setCustomColors, themes: allThemes, modes: allModes } = useTheme()
  const [customPrimary, setCustomPrimary] = useState(() => localStorage.getItem('teslasync-custom-primary') || '#00b4d8')
  const [customAccent, setCustomAccent] = useState(() => localStorage.getItem('teslasync-custom-accent') || '#e63946')
  const [modeQuery, setModeQuery] = useState('')

  const modeCount = Object.keys(allModes).length
  const groupedModes = useMemo(() => {
    const q = modeQuery.trim().toLowerCase()
    const list = (Object.values(allModes) as ModeTheme[]).filter(
      m => !q || (m.name ?? '').toLowerCase().includes(q) || (m.category ?? '').toLowerCase().includes(q),
    )
    const byCat = new Map<string, ModeTheme[]>()
    for (const m of list) {
      const cat = m.category ?? 'Other'
      const bucket = byCat.get(cat)
      if (bucket) bucket.push(m)
      else byCat.set(cat, [m])
    }
    const order = [...modeCategoryOrder, 'Other']
    return [...byCat.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  }, [allModes, modeQuery])

  const handleTheme = (id: ThemeId, name: string) => {
    setTheme(id)
    toast.info(`${t('theme.theme', 'Theme')}: ${name}`)
    onChange?.(id)
  }

  const handleMode = (id: ModeId, name: string) => {
    setMode(id)
    toast.info(`${t('theme.mode', 'Mode')}: ${name}`)
    onModeChange?.(id)
  }

  const handleCustom = (primary: string, accent: string) => {
    setCustomColors(primary, accent)
    onChange?.('custom')
  }

  const modeGridCols = compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'
  const themeGridCols = compact
    ? 'grid-cols-2 sm:grid-cols-3'
    : 'grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'
  const sectionSpacing = compact ? 'space-y-4' : 'space-y-6'

  return (
    <div className={cn(sectionSpacing, className)}>
      {showMode && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('theme.displayMode', 'Display Mode')}
            </p>
            <span className="text-xs text-[var(--text-muted)]">
              {t('theme.modeCount', '{{count}} modes', { count: modeCount })}
            </span>
          </div>
          <Input
            type="search"
            value={modeQuery}
            onChange={e => setModeQuery(e.target.value)}
            placeholder={t('theme.searchModes', 'Search display modes…')}
            aria-label={t('theme.searchModes', 'Search display modes…')}
            className="mb-3"
          />
          <div className={cn('space-y-5 overflow-y-auto pr-1', compact ? 'max-h-72' : 'max-h-[28rem]')}>
            {groupedModes.length === 0 && (
              <p className="py-6 text-center text-xs text-[var(--text-muted)]">
                {t('theme.noModes', 'No display modes match your search.')}
              </p>
            )}
            {groupedModes.map(([cat, items]) => (
              <div key={cat}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {cat} <span className="font-normal text-[var(--text-muted)]">({items.length})</span>
                </p>
                <div className={cn('grid gap-3', modeGridCols)}>
                  {items.map(m => (
                    <Button
                      key={m.id}
                      variant="ghost"
                      aria-pressed={modeId === m.id}
                      onClick={() => handleMode(m.id as ModeId, m.name)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-3.5 h-auto transition-all duration-normal justify-start',
                        modeId === m.id
                          ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                          : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30',
                      )}
                      style={modeId === m.id ? { boxShadow: 'inset 0 0 12px rgba(var(--theme-primary-rgb), 0.15)' } : undefined}
                    >
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
                        style={{
                          background: m.surface3,
                          border: `1px solid ${m.glassBorder}`,
                        }}
                      >
                        <span style={{ color: m.textPrimary }}>{modeIcons[m.id] ?? schemeIcon(m.colorScheme)}</span>
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{m.name}</p>
                        <div className="flex gap-1 mt-1">
                          {[m.bg, m.surface1, m.surface2, m.surface3].map((c, i) => (
                            <div
                              key={i}
                              className="h-2 w-4 rounded-sm border border-[var(--glass-border)]"
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                      </div>
                      {modeId === m.id && (
                        <CheckCircle aria-hidden="true" className="h-4 w-4 ml-auto shrink-0 text-[var(--theme-primary)]" />
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wider mb-3 text-[var(--text-muted)]">
          {t('theme.accentColor', 'Accent Color')}
        </p>
        <div className={cn('grid gap-3', themeGridCols)}>
          {Object.values(allThemes).filter(thm => thm.id !== 'custom').map(thm => (
            <Button
              key={thm.id}
              variant="ghost"
              aria-pressed={themeId === thm.id}
              onClick={() => handleTheme(thm.id as ThemeId, thm.name)}
              className={cn(
                'group relative rounded-xl border p-4 text-left h-auto transition-all duration-normal justify-start items-start flex-col',
                themeId === thm.id
                  ? 'bg-[var(--surface-3)]'
                  : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]',
                themeId !== thm.id && 'border-[var(--glass-border)]',
              )}
              style={themeId === thm.id ? { borderColor: thm.primary } : undefined}
            >
              <div
                className="h-6 w-6 rounded-full mb-3"
                style={{
                  background: `linear-gradient(135deg, ${thm.primary}, ${thm.accent})`,
                  boxShadow: themeId === thm.id ? `0 0 12px ${thm.primary}` : 'none',
                }}
              />
              <p className="text-xs font-medium text-[var(--text-primary)]">{thm.name}</p>
              {themeId === thm.id && (
                <div className="absolute top-2.5 right-2.5">
                  <CheckCircle aria-hidden="true" className="h-4 w-4" style={{ color: thm.primary }} />
                </div>
              )}
            </Button>
          ))}

          {showCustom && (
            <Button
              variant="ghost"
              aria-pressed={themeId === 'custom'}
              onClick={() => {
                handleCustom(customPrimary, customAccent)
                toast.info(`${t('theme.theme', 'Theme')}: ${t('theme.custom', 'Custom')}`)
              }}
              className={cn(
                'group relative rounded-xl border p-4 text-left h-auto transition-all duration-normal justify-start items-start flex-col',
                themeId === 'custom'
                  ? 'bg-[var(--surface-3)]'
                  : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]',
                themeId !== 'custom' && 'border-[var(--glass-border)]',
              )}
              style={themeId === 'custom' ? { borderColor: customPrimary } : undefined}
            >
              <div
                className="h-6 w-6 rounded-full mb-3"
                style={{
                  background: `linear-gradient(135deg, ${customPrimary}, ${customAccent})`,
                  boxShadow: themeId === 'custom' ? `0 0 12px ${customPrimary}` : 'none',
                }}
              />
              <p className="text-xs font-medium text-[var(--text-primary)]">{t('theme.custom', 'Custom')}</p>
              {themeId === 'custom' && (
                <div className="absolute top-2.5 right-2.5">
                  <CheckCircle aria-hidden="true" className="h-4 w-4" style={{ color: customPrimary }} />
                </div>
              )}
            </Button>
          )}
        </div>

        {showCustom && themeId === 'custom' && (
          <div className="flex flex-wrap gap-6 mt-4 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--glass-border)] animate-in fade-in">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.primary', 'Primary')}</span>
              <Input
                type="color"
                value={customPrimary}
                aria-label={t('theme.primary', 'Primary')}
                onChange={e => {
                  setCustomPrimary(e.target.value)
                  handleCustom(e.target.value, customAccent)
                }}
                className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
              />
              <span className="text-2xs font-mono text-[var(--text-muted)]">{customPrimary}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.accent', 'Accent')}</span>
              <Input
                type="color"
                value={customAccent}
                aria-label={t('theme.accent', 'Accent')}
                onChange={e => {
                  setCustomAccent(e.target.value)
                  handleCustom(customPrimary, e.target.value)
                }}
                className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
              />
              <span className="text-2xs font-mono text-[var(--text-muted)]">{customAccent}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
