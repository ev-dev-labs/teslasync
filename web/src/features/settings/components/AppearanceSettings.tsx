import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassPanel, Button, IconBox, Input } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useTheme, type ThemeId, type ModeId } from '@/components/ui/ThemeProvider'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'
import { Palette, Sun, Moon, Monitor, Sparkles, CheckCircle } from 'lucide-react'

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
      </GlassPanel>
    </FadeIn>
  )
}
