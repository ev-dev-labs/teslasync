import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Sun, Moon, Monitor, Sparkles } from 'lucide-react'
import { Button } from './Button'
import { Input } from './Input'
import { useTheme, type ThemeId, type ModeId } from './ThemeProvider'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'

/**
 * Phase-40 / Prompt 60 — shared theme picker.
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
          <p className="text-xs font-medium uppercase tracking-wider mb-3 text-[var(--text-muted)]">
            {t('theme.displayMode', 'Display Mode')}
          </p>
          <div className={cn('grid gap-3', modeGridCols)}>
            {Object.values(allModes).map(m => (
              <Button
                key={m.id}
                variant="ghost"
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
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: m.surface3,
                    border: `1px solid ${m.glassBorder}`,
                  }}
                >
                  <span style={{ color: m.textPrimary }}>{modeIcons[m.id]}</span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{m.name}</p>
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
                  <CheckCircle className="h-4 w-4 ml-auto text-[var(--theme-primary)]" />
                )}
              </Button>
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
                  <CheckCircle className="h-4 w-4" style={{ color: thm.primary }} />
                </div>
              )}
            </Button>
          ))}

          {showCustom && (
            <Button
              variant="ghost"
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
                  <CheckCircle className="h-4 w-4" style={{ color: customPrimary }} />
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
                onChange={e => {
                  setCustomPrimary(e.target.value)
                  handleCustom(e.target.value, customAccent)
                }}
                className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
              />
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{customPrimary}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.accent', 'Accent')}</span>
              <Input
                type="color"
                value={customAccent}
                onChange={e => {
                  setCustomAccent(e.target.value)
                  handleCustom(customPrimary, e.target.value)
                }}
                className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
              />
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{customAccent}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
