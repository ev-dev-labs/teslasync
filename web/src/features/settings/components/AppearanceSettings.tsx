import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassPanel, Button, IconBox, Input, Toggle } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useTheme, type ThemeId, type ModeId } from '@/components/ui/ThemeProvider'
import { useToast } from '@/components/feedback/Toast'
import { useSettings, useSaveSettings } from '@/api/hooks/useSettings'
import { useStatusBarPrefs, setStatusBarPrefs } from '@/components/layout'
import { cn } from '@/lib/cn'
import { Palette, Sun, Moon, Monitor, Sparkles, CheckCircle, Rows3, PanelBottom } from 'lucide-react'

type DensityId = 'compact' | 'comfortable' | 'spacious'

const modeIcons: Record<string, ReactNode> = {
  dark: <Moon className="h-4 w-4" />,
  light: <Sun className="h-4 w-4" />,
  oled: <Monitor className="h-4 w-4" />,
  midnight: <Sparkles className="h-4 w-4" />,
  auto: <Monitor className="h-4 w-4" />,
  sunset: <Sun className="h-4 w-4" />,
  nord: <Sparkles className="h-4 w-4" />,
}

export function AppearanceSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { themeId, modeId, setTheme, setMode, setCustomColors, themes: allThemes, modes: allModes } = useTheme()
  const [customPrimary, setCustomPrimary] = useState(() => localStorage.getItem('teslasync-custom-primary') || '#00b4d8')
  const [customAccent, setCustomAccent] = useState(() => localStorage.getItem('teslasync-custom-accent') || '#e63946')

  // Density picker. Reads/writes the same `ui_density` server-side setting
  // that `useDensitySync` applies to `body[data-density]`. We use the
  // partial-merge pattern (`{ ...settings, ui_density }`) because the
  // PUT /settings endpoint is full-replace, not patch. (Phase 40 / Prompt 44.)
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const density: DensityId =
    (settings?.ui_density as DensityId | undefined) ?? 'comfortable'

  // Footer status bar prefs (Phase-40 / Prompt 59). Persisted to
  // localStorage rather than the server so toggling is instant and works
  // offline; cross-tab sync is handled inside useStatusBarPrefs.
  const statusBarPrefs = useStatusBarPrefs()

  function setDensity(next: DensityId) {
    if (!settings || next === density) return
    saveSettings.mutate({ ...settings, ui_density: next })
  }

  const densityChoices: { id: DensityId; label: string; help: string }[] = [
    { id: 'compact', label: t('theme.density.compact', 'Compact'), help: t('theme.density.compactHelp', 'Tight rows — fits more on screen') },
    { id: 'comfortable', label: t('theme.density.comfortable', 'Comfortable'), help: t('theme.density.comfortableHelp', 'Default sizing') },
    { id: 'spacious', label: t('theme.density.spacious', 'Spacious'), help: t('theme.density.spaciousHelp', 'Roomy — easier to read at distance') },
  ]

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <IconBox color="purple">
            <Palette className="h-5 w-5" />
          </IconBox>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('theme.title', 'Appearance')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('theme.subtitle', 'Customize colors and display mode')}</p>
          </div>
        </div>

        {/* Mode Selector */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider mb-3 text-[var(--text-muted)]">{t('theme.displayMode', 'Display Mode')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.values(allModes).map(m => (
              <Button
                key={m.id}
                variant="ghost"
                onClick={() => { setMode(m.id as ModeId); toast.info(`${t('theme.mode', 'Mode')}: ${m.name}`) }}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3.5 h-auto transition-all duration-200 justify-start',
                  modeId === m.id
                    ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                    : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30'
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
                      <div key={i} className="h-2 w-4 rounded-sm border border-[var(--glass-border)]" style={{ background: c }} />
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

        {/* Accent Color */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider mb-3 text-[var(--text-muted)]">{t('theme.accentColor', 'Accent Color')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Object.values(allThemes).filter(thm => thm.id !== 'custom').map(thm => (
              <Button
                key={thm.id}
                variant="ghost"
                onClick={() => { setTheme(thm.id as ThemeId); toast.info(`${t('theme.theme', 'Theme')}: ${thm.name}`) }}
                className={cn(
                  'group relative rounded-xl border p-4 text-left h-auto transition-all duration-200 justify-start items-start flex-col',
                  themeId === thm.id
                    ? 'bg-[var(--surface-3)]'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]',
                  themeId !== thm.id && 'border-[var(--glass-border)]'
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

            {/* Custom color picker card */}
            <Button
              variant="ghost"
              onClick={() => { setCustomColors(customPrimary, customAccent); toast.info(`${t('theme.theme', 'Theme')}: ${t('theme.custom', 'Custom')}`) }}
              className={cn(
                'group relative rounded-xl border p-4 text-left h-auto transition-all duration-200 justify-start items-start flex-col',
                themeId === 'custom'
                  ? 'bg-[var(--surface-3)]'
                  : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]',
                themeId !== 'custom' && 'border-[var(--glass-border)]'
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
          </div>

          {/* Custom color pickers — shown when custom theme is active */}
          {themeId === 'custom' && (
            <div className="flex flex-wrap gap-6 mt-4 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--glass-border)] animate-in fade-in">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.primary', 'Primary')}</span>
                <Input
                  type="color"
                  value={customPrimary}
                  onChange={e => { setCustomPrimary(e.target.value); setCustomColors(e.target.value, customAccent) }}
                  className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
                />
                <span className="text-[10px] font-mono text-[var(--text-muted)]">{customPrimary}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.accent', 'Accent')}</span>
                <Input
                  type="color"
                  value={customAccent}
                  onChange={e => { setCustomAccent(e.target.value); setCustomColors(customPrimary, e.target.value) }}
                  className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
                />
                <span className="text-[10px] font-mono text-[var(--text-muted)]">{customAccent}</span>
              </div>
            </div>
          )}
        </div>

        {/* Density (information density) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Rows3 className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('theme.density.label', 'Information density')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {densityChoices.map(choice => {
              const active = density === choice.id
              return (
                <Button
                  key={choice.id}
                  variant="ghost"
                  onClick={() => setDensity(choice.id)}
                  disabled={!settings || saveSettings.isPending}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 h-auto transition-all duration-200 justify-start text-left',
                    active
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                      : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30',
                  )}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-[2px] rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)]"
                    aria-hidden="true"
                  >
                    {choice.id === 'compact' && (
                      <>
                        <div className="h-[2px] w-4 rounded bg-[var(--text-muted)]" />
                        <div className="h-[2px] w-4 rounded bg-[var(--text-muted)]" />
                        <div className="h-[2px] w-4 rounded bg-[var(--text-muted)]" />
                        <div className="h-[2px] w-4 rounded bg-[var(--text-muted)]" />
                      </>
                    )}
                    {choice.id === 'comfortable' && (
                      <>
                        <div className="h-[3px] w-4 rounded bg-[var(--text-muted)]" />
                        <div className="h-[3px] w-4 rounded bg-[var(--text-muted)]" />
                        <div className="h-[3px] w-4 rounded bg-[var(--text-muted)]" />
                      </>
                    )}
                    {choice.id === 'spacious' && (
                      <>
                        <div className="h-[5px] w-4 rounded bg-[var(--text-muted)]" />
                        <div className="h-[5px] w-4 rounded bg-[var(--text-muted)]" />
                      </>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{choice.label}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{choice.help}</p>
                  </div>
                  {active && (
                    <CheckCircle className="h-4 w-4 ml-auto shrink-0 text-[var(--theme-primary)]" />
                  )}
                </Button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t('theme.density.help', 'Affects table rows, cards, and dashboard widgets across the app.')}
          </p>

          {/* Live preview — uses density Tailwind utilities so it reflows
              instantly when the body[data-density] attribute changes. */}
          <div className="mt-4 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] overflow-hidden">
            <div className="border-b border-[var(--glass-border)] bg-[var(--surface-3)] px-d-pad-x py-d-pad-y">
              <p className="text-d-base font-medium text-[var(--text-secondary)]">
                {t('theme.density.previewTitle', 'Preview')}
              </p>
            </div>
            <div className="divide-y divide-[var(--glass-border)]">
              {[
                t('theme.density.previewRow1', 'Sample row — Tesla Model 3'),
                t('theme.density.previewRow2', 'Sample row — Tesla Model Y'),
                t('theme.density.previewRow3', 'Sample row — Tesla Model S'),
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex min-h-d-row items-center px-d-pad-x py-d-pad-y text-d-base text-[var(--text-primary)]"
                >
                  {row}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer status bar (Phase-40 / Prompt 59) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <PanelBottom className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('theme.statusBar.label', 'Status bar')}
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('theme.statusBar.show', 'Show status bar')}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('theme.statusBar.showHelp', 'Always-on footer with API health, live telemetry, vehicle, and version.')}
                </p>
              </div>
              <Toggle
                checked={statusBarPrefs.enabled}
                onChange={(next) => {
                  setStatusBarPrefs({ enabled: next })
                  toast.info(
                    next
                      ? t('theme.statusBar.shownToast', 'Status bar shown')
                      : t('theme.statusBar.hiddenToast', 'Status bar hidden'),
                  )
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <p className={cn('text-sm font-medium text-[var(--text-primary)]', !statusBarPrefs.enabled && 'opacity-50')}>
                  {t('theme.statusBar.iconOnly', 'Always icon-only')}
                </p>
                <p className={cn('text-xs text-[var(--text-muted)]', !statusBarPrefs.enabled && 'opacity-50')}>
                  {t('theme.statusBar.iconOnlyHelp', 'Hide labels at all widths. Otherwise the bar auto-collapses on narrow screens.')}
                </p>
              </div>
              <Toggle
                checked={statusBarPrefs.iconOnly}
                onChange={(next) => setStatusBarPrefs({ iconOnly: next })}
                aria-disabled={!statusBarPrefs.enabled}
              />
            </div>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
