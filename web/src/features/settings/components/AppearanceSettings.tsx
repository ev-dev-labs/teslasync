import { useTranslation } from 'react-i18next'
import { GlassPanel, IconBox, ThemePicker, Toggle, Button, HelpIcon, Heading, Text, HelperText, Label } from '@/components/ui'
import { useToast } from '@/components/feedback/Toast'
import { useSettings, useSaveSettings } from '@/api/hooks/useSettings'
import { useStatusBarPrefs, setStatusBarPrefs } from '@/components/layout'
import {
  useAchievementCelebrationPrefs,
  setAchievementCelebrationPrefs,
} from '@/hooks/useAchievementCelebrationPrefs'
import { cn } from '@/lib/cn'
import { Palette, CheckCircle, Rows3, PanelBottom, Trophy, Clock, Eye, PlayCircle, RotateCcw, Sidebar } from 'lucide-react'
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors'
import { startTour } from '@/lib/tourLauncher'
import { resetAllTours } from '@/lib/tourRegistry'
import {
  useSidebarStyle,
  setSidebarStyle,
  type SidebarStyle,
} from '@/hooks/useSidebarStyle'

type DensityId = 'compact' | 'comfortable' | 'spacious'
type TimeFormatId = 'relative' | 'absolute'
type ChartPaletteId = 'cb_safe' | 'neon'

export function AppearanceSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()

  // Density picker. Reads/writes the same `ui_density` server-side setting
  // that `useDensitySync` applies to `body[data-density]`. We use the
  // partial-merge pattern (`{ ...settings, ui_density }`) because the
  // PUT /settings endpoint is full-replace, not patch. (.)
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const density: DensityId =
    (settings?.ui_density as DensityId | undefined) ?? 'comfortable'

  // Time format default (). Drives `<TimeStamp>`'s
  // visible body when no explicit `format` prop is set, and the alternate
  // value always lives in its hover tooltip.
  const timeFormat: TimeFormatId =
    (settings?.time_format_default as TimeFormatId | undefined) ?? 'relative'

  // Chart palette default (). Drives the reactive
  // `useChartPalette()` hook so consumers re-render with the new colours
  // when the user toggles between the CB-safe Okabe-Ito default and the
  // stylistic neon palette.
  const chartPalette: ChartPaletteId =
    (settings?.chart_palette as ChartPaletteId | undefined) ?? 'cb_safe'

  // Footer status bar prefs (). Persisted to
  // localStorage rather than the server so toggling is instant and works
  // offline; cross-tab sync is handled inside useStatusBarPrefs.
  const statusBarPrefs = useStatusBarPrefs()

  // Celebration prefs (). Same localStorage pattern as
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

  // Sidebar style — localStorage-backed, instant + cross-tab sync. See
  // hooks/useSidebarStyle.ts for the rationale on why this lives on the
  // client (vs the server settings blob).
  const sidebarStyle = useSidebarStyle()
  const sidebarStyleChoices: { id: SidebarStyle; label: string; help: string }[] = [
    {
      id: 'linear',
      label: t('theme.sidebarStyle.linear', 'Minimal'),
      help: t(
        'theme.sidebarStyle.linearHelp',
        'Single column with section headers and a 2px accent bar on the active row. Recommended.',
      ),
    },
    {
      id: 'notion',
      label: t('theme.sidebarStyle.notion', 'All groups'),
      help: t(
        'theme.sidebarStyle.notionHelp',
        'Complete navigation catalog with collapsible sections. Best when you want every group available in the sidebar.',
      ),
    },
    {
      id: 'legacy',
      label: t('theme.sidebarStyle.legacy', 'Classic'),
      help: t(
        'theme.sidebarStyle.legacyHelp',
        'Colorful icon tiles with a pill on the active item. The most visual option.',
      ),
    },
  ]

  return (
    <>
      <GlassPanel id="appearance" className="p-6 space-y-6" data-tour="settings-appearance">
        <div className="flex items-center gap-3">
          <IconBox color="purple">
            <Palette className="h-5 w-5" />
          </IconBox>
          <div>
            <Heading level="panel">{t('theme.title', 'Appearance')}</Heading>
            <HelperText>{t('theme.subtitle', 'Customize colors and display mode')}</HelperText>
          </div>
        </div>

        {/* Shared <ThemePicker>: the settings page renders the full UI, while
            the top-bar quick-switcher renders a compact variant. */}
        <ThemePicker showMode showCustom />
      </GlassPanel>

      <GlassPanel className="p-6 space-y-6">
        {/* Density (information density) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Rows3 className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('theme.density.label', 'Information density')}
            </Label>
            <HelpIcon
              i18nKey="help.fields.settings.appearanceDensity"
              for="appearance-density"
            />
          </div>
          <div
            role="radiogroup"
            aria-label={t('theme.density.label', 'Information density')}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {densityChoices.map(choice => {
              const active = density === choice.id
              return (
                <Button
                  key={choice.id}
                  variant="ghost"
                  role="radio"
                  aria-checked={active}
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
                    <Text as="p" variant="body" className="font-medium">{choice.label}</Text>
                    <HelperText>{choice.help}</HelperText>
                  </div>
                  {active && (
                    <CheckCircle className="h-4 w-4 ml-auto shrink-0 text-[var(--theme-primary)]" />
                  )}
                </Button>
              )
            })}
          </div>
          <HelperText className="mt-2">
            {t('theme.density.help', 'Affects table rows, cards, and dashboard widgets across the app.')}
          </HelperText>

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

        {/* Sidebar style — localStorage-backed user preference. */}
        <div data-tour="settings-sidebar-style" data-testid="settings-sidebar-style">
          <div className="flex items-center gap-2 mb-3">
            <Sidebar className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('theme.sidebarStyle.label', 'Sidebar style')}
            </Label>
          </div>
          <div
            role="radiogroup"
            aria-label={t('theme.sidebarStyle.label', 'Sidebar style')}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {sidebarStyleChoices.map(choice => {
              const active = sidebarStyle === choice.id
              return (
                <Button
                  key={choice.id}
                  variant="ghost"
                  role="radio"
                  aria-checked={active}
                  data-testid={`sidebar-style-${choice.id}`}
                  onClick={() => setSidebarStyle(choice.id)}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 h-auto transition-all duration-normal justify-start text-left',
                    active
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                      : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30',
                  )}
                >
                  <SidebarStyleSwatch style={choice.id} />
                  <div className="min-w-0">
                    <Text as="p" variant="body" className="font-medium">{choice.label}</Text>
                    <HelperText>{choice.help}</HelperText>
                  </div>
                  {active && (
                    <CheckCircle className="h-4 w-4 ml-auto shrink-0 text-[var(--theme-primary)]" />
                  )}
                </Button>
              )
            })}
          </div>
          <HelperText className="mt-2">
            {t(
              'theme.sidebarStyle.help',
              'Applies instantly. Saved per device — your other devices keep their own choice.',
            )}
          </HelperText>
        </div>

        {/* Time format default */}
        <div data-tour="settings-time-format">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('theme.timeFormat.label', 'Default time format')}
            </Label>
            <HelpIcon
              i18nKey="help.fields.settings.timeFormat"
              for="time-format"
            />
          </div>
          <div
            role="radiogroup"
            aria-label={t('theme.timeFormat.label', 'Default time format')}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {timeFormatChoices.map(choice => {
              const active = timeFormat === choice.id
              return (
                <Button
                  key={choice.id}
                  variant="ghost"
                  role="radio"
                  aria-checked={active}
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
                    <Text as="p" variant="body" className="font-medium">{choice.label}</Text>
                    <HelperText>{choice.help}</HelperText>
                  </div>
                  {active && (
                    <CheckCircle className="h-4 w-4 ml-auto shrink-0 text-[var(--theme-primary)]" />
                  )}
                </Button>
              )
            })}
          </div>
          <HelperText className="mt-2">
            {t('theme.timeFormat.help', 'Hover any timestamp to see the alternate format. Override per-surface with the format prop where needed.')}
          </HelperText>
        </div>
      </GlassPanel>

      <GlassPanel className="p-6 space-y-6">
        {/* Chart palette */}
        <div data-tour="settings-chart-palette">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('theme.chartPalette.label', 'Chart palette')}
            </Label>
            <HelpIcon
              i18nKey="help.fields.settings.chartPalette"
              for="chart-palette"
            />
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
                    <Text as="p" variant="body" className="font-medium">{choice.label}</Text>
                    <HelperText>{choice.help}</HelperText>
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
          <HelperText className="mt-2">
            {t('theme.chartPalette.help', 'Defaults to the Okabe-Ito palette so series remain distinguishable for the ~8% of users with red-green colour vision deficiency.')}
          </HelperText>
        </div>

        {/* Footer status bar */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <PanelBottom className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('theme.statusBar.label', 'Status bar')}
            </Label>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Text as="p" variant="body" className="font-medium">
                  {t('theme.statusBar.show', 'Show status bar')}
                </Text>
                <HelperText>
                  {t(
                    'theme.statusBar.showHelp',
                    'Always-on footer with connection health, live freshness, priority alerts, recent pages, and operational activity.',
                  )}
                </HelperText>
              </div>
              <Toggle
                data-testid="statusbar-toggle-enabled"
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
                <Text as="p" variant="body" className={cn('font-medium', !statusBarPrefs.enabled && 'opacity-50')}>
                  {t('theme.statusBar.iconOnly', 'Always icon-only')}
                </Text>
                <HelperText className={cn(!statusBarPrefs.enabled && 'opacity-50')}>
                  {t(
                    'theme.statusBar.iconOnlyHelp',
                    'Hide labels at all widths. Lower-priority tools move into More on constrained screens.',
                  )}
                </HelperText>
              </div>
              <Toggle
                checked={statusBarPrefs.iconOnly}
                onChange={(next) => {
                  // The icon-only sub-preference is meaningless while the bar
                  // is hidden: the row is dimmed and marked aria-disabled, so
                  // make the control truly inert instead of silently mutating
                  // a preference the user can't see take effect.
                  if (!statusBarPrefs.enabled) return
                  setStatusBarPrefs({ iconOnly: next })
                }}
                aria-disabled={!statusBarPrefs.enabled}
                data-testid="statusbar-toggle-icon-only"
              />
            </div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="p-6 space-y-6">
        {/* Achievement celebrations */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('achievements.celebrationSettings', 'Celebration')}
            </Label>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Text as="p" variant="body" className="font-medium">
                  {t('achievements.showToasts', 'Show celebration toasts')}
                </Text>
                <HelperText>
                  {t('achievements.showToastsHelp', 'Pop a celebratory toast with confetti when you unlock an achievement.')}
                </HelperText>
              </div>
              <Toggle
                data-testid="celebration-toggle-toasts"
                checked={celebrationPrefs.showToasts}
                onChange={(next) => setAchievementCelebrationPrefs({ showToasts: next })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <Text as="p" variant="body" className="font-medium">
                  {t('achievements.playSound', 'Play sound on unlock')}
                </Text>
                <HelperText>
                  {t('achievements.playSoundHelp', 'Play a short chime alongside the celebration toast. Off by default.')}
                </HelperText>
              </div>
              <Toggle
                data-testid="celebration-toggle-sound"
                checked={celebrationPrefs.playSound}
                onChange={(next) => setAchievementCelebrationPrefs({ playSound: next })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <Text as="p" variant="body" className="font-medium">
                  {t('achievements.showOnDashboard', 'Show recently unlocked on dashboard')}
                </Text>
                <HelperText>
                  {t('achievements.showOnDashboardHelp', "Surface your latest unlocks in the dashboard's recently-unlocked widget.")}
                </HelperText>
              </div>
              <Toggle
                data-testid="celebration-toggle-dashboard"
                checked={celebrationPrefs.showOnDashboard}
                onChange={(next) => setAchievementCelebrationPrefs({ showOnDashboard: next })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] pt-3">
              <div className="min-w-0">
                <Text as="p" variant="body" className="font-medium">
                  {t('achievements.pushOnUnlock', 'Send push notifications for achievements')}
                </Text>
                <HelperText>
                  {t('achievements.pushOnUnlockHelp', 'Deliver a web push notification when an achievement unlocks while the tab is closed.')}
                </HelperText>
              </div>
              <Toggle
                data-testid="celebration-toggle-push"
                checked={celebrationPrefs.pushOnUnlock}
                onChange={(next) => setAchievementCelebrationPrefs({ pushOnUnlock: next })}
              />
            </div>
          </div>
        </div>

        {/* Product tours — replay or reset onboarding tours */}
        <div data-tour="settings-product-tours" data-testid="product-tours-section">
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>
              {t('settings.tours.label', 'Product tours')}
            </Label>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
            <div>
              <Text as="p" variant="body" className="font-medium">
                {t('settings.tours.title', 'Product tours')}
              </Text>
              <HelperText>
                {t('settings.tours.body', 'Re-run the guided walkthroughs that introduce major sections.')}
              </HelperText>
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
    </>
  )
}

/**
 * SidebarStyleSwatch — miniature visual preview rendered next to each
 * sidebar-style choice button. Pure CSS bars (no real navigation) so it
 * stays fast and never out-of-sync with the live sidebar code (it just
 * communicates the silhouette: accent bar vs caret-on-row vs icon-tile).
 */
function SidebarStyleSwatch({ style }: { style: SidebarStyle }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-12 w-9 shrink-0 flex-col gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] p-1.5"
    >
      {style === 'linear' && (
        <>
          {/* Three rows. The middle one is "active" — 2px left accent bar. */}
          <div className="h-1 w-full rounded bg-[var(--text-muted)]/30" />
          <div className="relative flex h-1 items-center">
            <span className="absolute left-[-6px] h-2 w-[2px] rounded-full bg-[var(--theme-primary)]" />
            <span className="ms-0.5 h-1 w-full rounded bg-[var(--text-primary)]/80" />
          </div>
          <div className="h-1 w-3/4 rounded bg-[var(--text-muted)]/30" />
        </>
      )}
      {style === 'notion' && (
        <>
          {/* Four denser rows. Active row uses subtle bg-tint, no accent. */}
          <div className="flex h-1 items-center gap-0.5">
            <span className="h-1 w-1 rounded-full bg-[var(--text-muted)]/60" />
            <span className="h-1 flex-1 rounded bg-[var(--text-muted)]/30" />
          </div>
          <div className="flex h-1 items-center gap-0.5 rounded bg-white/[0.08] px-0.5">
            <span className="h-1 w-1 rounded-full bg-[var(--text-primary)]" />
            <span className="h-1 flex-1 rounded bg-[var(--text-primary)]/80" />
          </div>
          <div className="flex h-1 items-center gap-0.5">
            <span className="h-1 w-1 rounded-full bg-[var(--text-muted)]/60" />
            <span className="h-1 flex-1 rounded bg-[var(--text-muted)]/30" />
          </div>
          <div className="flex h-1 items-center gap-0.5">
            <span className="h-1 w-1 rounded-full bg-[var(--text-muted)]/60" />
            <span className="h-1 flex-1 rounded bg-[var(--text-muted)]/30" />
          </div>
        </>
      )}
      {style === 'legacy' && (
        <>
          {/* Two rows with colored icon tiles — the "loudest" silhouette. */}
          <div className="flex h-2 items-center gap-1">
            <span className="h-2 w-2 rounded bg-cyan-400/70 ring-1 ring-cyan-400/30" />
            <span className="h-1 flex-1 rounded bg-[var(--text-primary)]/80" />
          </div>
          <div className="flex h-2 items-center gap-1">
            <span className="h-2 w-2 rounded bg-violet-400/70 ring-1 ring-violet-400/30" />
            <span className="h-1 flex-1 rounded bg-[var(--text-muted)]/40" />
          </div>
          <div className="flex h-2 items-center gap-1">
            <span className="h-2 w-2 rounded bg-emerald-400/70 ring-1 ring-emerald-400/30" />
            <span className="h-1 flex-1 rounded bg-[var(--text-muted)]/40" />
          </div>
        </>
      )}
    </div>
  )
}
