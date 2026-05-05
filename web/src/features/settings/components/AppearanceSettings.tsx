import { useTranslation } from 'react-i18next'
import { GlassPanel, IconBox, ThemePicker, Toggle, Button } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { useSettings, useSaveSettings } from '@/api/hooks/useSettings'
import { useStatusBarPrefs, setStatusBarPrefs } from '@/components/layout'
import {
  useAchievementCelebrationPrefs,
  setAchievementCelebrationPrefs,
} from '@/hooks/useAchievementCelebrationPrefs'
import { cn } from '@/lib/cn'
import { Palette, CheckCircle, Rows3, PanelBottom, Trophy, Clock, Eye, PlayCircle, RotateCcw } from 'lucide-react'
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors'
import { startTour } from '@/lib/tourLauncher'
import { resetAllTours } from '@/lib/tourRegistry'

type DensityId = 'compact' | 'comfortable' | 'spacious'
type TimeFormatId = 'relative' | 'absolute'
type ChartPaletteId = 'cb_safe' | 'neon'

export function AppearanceSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()

  // Density picker. Reads/writes the same `ui_density` server-side setting
  // that `useDensitySync` applies to `body[data-density]`. We use the
  // partial-merge pattern (`{ ...settings, ui_density }`) because the
  // PUT /settings endpoint is full-replace, not patch. (Phase 40 / Prompt 44.)
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const density: DensityId =
    (settings?.ui_density as DensityId | undefined) ?? 'comfortable'

  // Time format default (Phase-45 / Prompt 22). Drives `<TimeStamp>`'s
  // visible body when no explicit `format` prop is set, and the alternate
  // value always lives in its hover tooltip.
  const timeFormat: TimeFormatId =
    (settings?.time_format_default as TimeFormatId | undefined) ?? 'relative'

  // Chart palette default (Phase-45 / Prompt 23). Drives the reactive
  // `useChartPalette()` hook so consumers re-render with the new colours
  // when the user toggles between the CB-safe Okabe-Ito default and the
  // stylistic neon palette.
  const chartPalette: ChartPaletteId =
    (settings?.chart_palette as ChartPaletteId | undefined) ?? 'cb_safe'

  // Footer status bar prefs (Phase-40 / Prompt 59). Persisted to
  // localStorage rather than the server so toggling is instant and works
  // offline; cross-tab sync is handled inside useStatusBarPrefs.
  const statusBarPrefs = useStatusBarPrefs()

  // Celebration prefs (Phase-40 / Prompt 63). Same localStorage pattern as
  // the status-bar prefs above so toggling the celebration toast / sound is
  // instant and survives offline + cross-tab.
  const celebrationPrefs = useAchievementCelebrationPrefs()

  function setDensity(next: DensityId) {
    if (!settings || next === density) return
    saveSettings.mutate({ ...settings, ui_density: next })
  }

  function setTimeFormat(next: TimeFormatId) {
    if (!settings || next === timeFormat) return
    saveSettings.mutate({ ...settings, time_format_default: next })
  }

  function setChartPalette(next: ChartPaletteId) {
    if (!settings || next === chartPalette) return
    saveSettings.mutate({ ...settings, chart_palette: next })
  }

  const chartPaletteChoices: {
    id: ChartPaletteId
    label: string
    help: string
    swatches: readonly string[]
  }[] = [
    {
      id: 'cb_safe',
      label: t('theme.chartPalette.cbSafe', 'Color-blind safe'),
      help: t(
        'theme.chartPalette.cbSafeHelp',
        'Okabe-Ito palette — distinguishable for all CVD types.',
      ),
      swatches: CHART_COLORS_CB_SAFE,
    },
    {
      id: 'neon',
      label: t('theme.chartPalette.neon', 'Stylistic neon'),
      help: t(
        'theme.chartPalette.neonHelp',
        'Bright cyan/magenta — best when colour vision is unimpaired.',
      ),
      swatches: CHART_COLORS_NEON,
    },
  ]

  const timeFormatChoices: { id: TimeFormatId; label: string; help: string }[] = [
    { id: 'relative', label: t('theme.timeFormat.relative', 'Relative (2h ago)'), help: t('theme.timeFormat.relativeHelp', 'Best for recent activity feeds') },
    { id: 'absolute', label: t('theme.timeFormat.absolute', 'Absolute (Nov 12, 13:42)'), help: t('theme.timeFormat.absoluteHelp', 'Best for trip planning and event correlation') },
  ]

  const densityChoices: { id: DensityId; label: string; help: string }[] = [
    { id: 'compact', label: t('theme.density.compact', 'Compact'), help: t('theme.density.compactHelp', 'Tight rows — fits more on screen') },
    { id: 'comfortable', label: t('theme.density.comfortable', 'Comfortable'), help: t('theme.density.comfortableHelp', 'Default sizing') },
    { id: 'spacious', label: t('theme.density.spacious', 'Spacious'), help: t('theme.density.spaciousHelp', 'Roomy — easier to read at distance') },
  ]

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="p-6 space-y-6" data-tour="settings-appearance">
        <div className="flex items-center gap-3">
          <IconBox color="purple">
            <Palette className="h-5 w-5" />
          </IconBox>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('theme.title', 'Appearance')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('theme.subtitle', 'Customize colors and display mode')}</p>
          </div>
        </div>

        {/* Phase-40 / Prompt 60 — extracted shared <ThemePicker>. The settings
            page renders the full UI (mode + accent + custom-color builder); the
            top-bar quick-switcher renders a compact variant of the same. */}
        <ThemePicker showMode showCustom />

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
                    'flex items-start gap-3 rounded-xl border p-3.5 h-auto transition-all duration-normal justify-start text-left',
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

        {/* Time format default (Phase-45 / Prompt 22) */}
        <div data-tour="settings-time-format">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('theme.timeFormat.label', 'Default time format')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {timeFormatChoices.map(choice => {
              const active = timeFormat === choice.id
              return (
                <Button
                  key={choice.id}
                  variant="ghost"
                  onClick={() => setTimeFormat(choice.id)}
                  disabled={!settings || saveSettings.isPending}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 h-auto transition-all duration-normal justify-start text-left',
                    active
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                      : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30',
                  )}
                >
                  <div className="min-w-0 flex-1">
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
            {t('theme.timeFormat.help', 'Hover any timestamp to see the alternate format. Override per-surface with the format prop where needed.')}
          </p>
        </div>

        {/* Chart palette (Phase-45 / Prompt 23) */}
        <div data-tour="settings-chart-palette">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('theme.chartPalette.label', 'Chart palette')}
            </p>
          </div>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t('theme.chartPalette.label', 'Chart palette')}
          >
            {chartPaletteChoices.map(choice => {
              const active = chartPalette === choice.id
              return (
                <Button
                  key={choice.id}
                  variant="ghost"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChartPalette(choice.id)}
                  disabled={!settings || saveSettings.isPending}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 h-auto transition-all duration-normal justify-start text-left',
                    active
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                      : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{choice.label}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{choice.help}</p>
                    <div
                      className="mt-2 flex items-center gap-1"
                      aria-hidden="true"
                    >
                      {choice.swatches.map((hex, i) => (
                        <span
                          key={`${choice.id}-${i}`}
                          className="h-3 w-3 rounded-full border border-[var(--glass-border)]"
                          style={{ background: hex }}
                        />
                      ))}
                    </div>
                  </div>
                  {active && (
                    <CheckCircle className="h-4 w-4 ml-auto shrink-0 text-[var(--theme-primary)]" />
                  )}
                </Button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t('theme.chartPalette.help', 'Defaults to the Okabe-Ito palette so series remain distinguishable for the ~8% of users with red-green colour vision deficiency.')}
          </p>
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

        {/* Achievement celebrations (Phase-40 / Prompt 63) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('achievements.celebrationSettings', 'Celebration')}
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('achievements.showToasts', 'Show celebration toasts')}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('achievements.showToastsHelp', 'Pop a celebratory toast with confetti when you unlock an achievement.')}
                </p>
              </div>
              <Toggle
                checked={celebrationPrefs.showToasts}
                onChange={(next) => setAchievementCelebrationPrefs({ showToasts: next })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('achievements.playSound', 'Play sound on unlock')}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('achievements.playSoundHelp', 'Play a short chime alongside the celebration toast. Off by default.')}
                </p>
              </div>
              <Toggle
                checked={celebrationPrefs.playSound}
                onChange={(next) => setAchievementCelebrationPrefs({ playSound: next })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('achievements.showOnDashboard', 'Show recently unlocked on dashboard')}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('achievements.showOnDashboardHelp', "Surface your latest unlocks in the dashboard's recently-unlocked widget.")}
                </p>
              </div>
              <Toggle
                checked={celebrationPrefs.showOnDashboard}
                onChange={(next) => setAchievementCelebrationPrefs({ showOnDashboard: next })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('achievements.pushOnUnlock', 'Send push notifications for achievements')}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('achievements.pushOnUnlockHelp', 'Deliver a web push notification when an achievement unlocks while the tab is closed.')}
                </p>
              </div>
              <Toggle
                checked={celebrationPrefs.pushOnUnlock}
                onChange={(next) => setAchievementCelebrationPrefs({ pushOnUnlock: next })}
              />
            </div>
          </div>
        </div>

        {/* Product tours (Phase-46 / Prompt 61) — replay or reset onboarding tours */}
        <div data-tour="settings-product-tours" data-testid="product-tours-section">
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('settings.tours.label', 'Product tours')}
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('settings.tours.title', 'Product tours')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {t('settings.tours.body', 'Re-run the guided walkthroughs that introduce major sections.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => startTour('main')}
                data-testid="replay-tour-main"
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                {t('settings.tours.replayMain', 'Replay dashboard tour')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => startTour('debugger')}
                data-testid="replay-tour-debugger"
              >
                {t('settings.tours.replayDebugger', 'Debugger tour')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => startTour('automations')}
                data-testid="replay-tour-automations"
              >
                {t('settings.tours.replayAutomations', 'Automations tour')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  resetAllTours()
                  toast.success(
                    t(
                      'settings.tours.resetDone',
                      'All tours reset — they will play next time you open the matching page',
                    ),
                  )
                }}
                data-testid="reset-all-tours"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {t('settings.tours.resetAll', 'Reset all tours')}
              </Button>
            </div>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
