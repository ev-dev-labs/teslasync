import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useSettings, useSaveSettings } from '@/api/hooks/useSettings'
import {
  Button,
  Caption,
  Input,
  PanelTitle,
  Popover,
  Text,
  Toggle,
} from '@/components/ui/runtime'
import { useRangeState } from '@/hooks/useRangeState'
import { useProductPreferences } from '@/hooks/useProductPreferences'
import { getCurrentDensity } from '@/hooks/useDensitySync'
import { getDatePreset } from '@/lib/datePresets'
import { civilDateInTimeZone } from '@/lib/dateRange'
import { getWorkspaceQuickRangePresets, isWorkspaceRangePresetAvailable } from '@/lib/workspaceScope'
import { formatDate, formatDateShort } from '@/lib/dateFormat'
import { cn } from '@/lib/cn'
import { Icons } from '@/lib/icons'
import {
  WORKSPACE_DENSITY_EVENT,
  WORKSPACE_RANGE_EVENT,
  isWorkspaceDensity,
  isWorkspaceRangePreset,
  type WorkspaceDensity,
  type WorkspaceRangePreset,
} from '@/lib/workspacePreferences'
import { useStatusBarPopover } from './status-bar/StatusBarContext'

const SHORT_PRESET_LABELS: Record<WorkspaceRangePreset | 'ytd', string> = {
  live: 'Last 5 min',
  '24h': '24 hours',
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  ytd: 'Year to date',
  '1y': '1 year',
  all: 'All time',
}
export interface WorkspaceContextControlProps {
  className?: string
  /** Keep command listeners mounted while omitting a route-inapplicable trigger. */
  hidden?: boolean
  /** Only one mounted control should handle global command-palette events. */
  listenForCommands?: boolean
  /** Compact footer treatment coordinated with the other status popovers. */
  variant?: 'header' | 'status'
  iconOnly?: boolean
}

export function WorkspaceContextControl({
  className,
  hidden = false,
  listenForCommands = true,
  variant = 'header',
  iconOnly = false,
}: WorkspaceContextControlProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const quickPresets = getWorkspaceQuickRangePresets(pathname)
  const calendarRoute = isWorkspaceRangePresetAvailable(pathname, 'ytd')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { open, toggle, close } = useStatusBarPopover(
    variant === 'status' ? 'workspace-context-status' : 'workspace-context',
  )
  const { preferences } = useProductPreferences()
  const range = useRangeState({
    defaultPresetId: preferences.defaultAnalysisRange,
    enableCompare: true,
  })
  const { data: settings, isLoading: settingsLoading, refetch: refetchSettings } = useSettings()
  const saveSettings = useSaveSettings()
  const [pendingDensity, setPendingDensity] = useState<WorkspaceDensity | null>(null)
  const density = pendingDensity ?? settings?.ui_density ?? getCurrentDensity()
  const [draftStart, setDraftStart] = useState(range.start)
  const [draftEnd, setDraftEnd] = useState(range.end)
  const calendarYear = Number(civilDateInTimeZone(new Date(), range.timezone).slice(0, 4))
  const rangeYear = Number(range.start.slice(0, 4))
  const fullYear = calendarRoute && !range.presetId && rangeYear >= 1900 && rangeYear <= calendarYear &&
    range.start === `${rangeYear}-01-01` && range.end === `${rangeYear}-12-31`
    ? rangeYear
    : undefined
  const selectedYear = fullYear ?? calendarYear
  const [showCustom, setShowCustom] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraftStart(range.start)
    setDraftEnd(range.end)
    setShowCustom(false)
  }, [open, range.start, range.end])

  useEffect(() => {
    if (!listenForCommands) return
    const handleRange = (event: Event) => {
      const preset = (event as CustomEvent<{ preset?: unknown }>).detail?.preset
      if (isWorkspaceRangePreset(preset)) range.setPreset(preset)
    }
    window.addEventListener(WORKSPACE_RANGE_EVENT, handleRange)
    return () => window.removeEventListener(WORKSPACE_RANGE_EVENT, handleRange)
  }, [listenForCommands, range.setPreset])

  useEffect(() => {
    if (!listenForCommands) return
    const handleDensity = (event: Event) => {
      const next = (event as CustomEvent<{ density?: unknown }>).detail?.density
      if (!settings || !isWorkspaceDensity(next) || next === density) return
      saveSettings.mutate({ ...settings, ui_density: next })
    }
    window.addEventListener(WORKSPACE_DENSITY_EVENT, handleDensity)
    return () => window.removeEventListener(WORKSPACE_DENSITY_EVENT, handleDensity)
  }, [density, listenForCommands, saveSettings, settings])

  useEffect(() => {
    if (hidden && open) close()
  }, [close, hidden, open])

  useEffect(() => {
    if (pendingDensity && settings?.ui_density === pendingDensity) setPendingDensity(null)
  }, [pendingDensity, settings?.ui_density])

  const activePreset = range.presetId
    ? getDatePreset(range.presetId)
    : undefined
  const activeLabel = fullYear != null
    ? t('workspace.analysis.fullYear', 'Full year {{year}}', { year: String(fullYear) })
    : activePreset
      ? t(activePreset.i18nKey, activePreset.fallback)
      : t('workspace.analysis.custom', 'Custom')
  const visibleContextLabel = range.compare
    ? t(
        'workspace.analysis.rangeWithComparison',
        '{{range}} · Compare',
        { range: activeLabel },
      )
    : activeLabel
  const triggerLabel = t(
    'workspace.analysis.trigger',
    'Analysis window: {{range}}',
    { range: visibleContextLabel },
  )
  const validDraft = draftStart.length > 0 && draftEnd.length > 0 && draftStart <= draftEnd
  const legacyPreset = isWorkspaceRangePreset(range.presetId) &&
    range.presetId !== 'all' &&
    !quickPresets.some(id => id === range.presetId) &&
    isWorkspaceRangePresetAvailable(pathname, range.presetId)
    ? range.presetId
    : undefined
  const presetButton = (id: WorkspaceRangePreset | 'ytd') => (
    <Button
      key={id}
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={!showCustom && range.presetId === id}
      aria-label={id === '24h' ? t('date.preset.last24h', 'Last 24 hours') : undefined}
      onClick={() => {
        setShowCustom(false)
        range.setPreset(id)
      }}
      className={cn(
        'min-h-11 min-w-0 rounded-lg border px-2 text-xs transition-colors',
        !showCustom && range.presetId === id
          ? 'border-[var(--theme-primary)] bg-[var(--surface-1)] font-semibold text-[var(--text-primary)] shadow-e1'
          : 'border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]',
      )}
    >
      {t(`workspace.analysis.presets.${id}`, SHORT_PRESET_LABELS[id])}
    </Button>
  )
  const applyYear = (year: number) => {
    if (!Number.isInteger(year) || year < 1900 || year > calendarYear) return
    range.setRange({
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    }, 'custom')
    setShowCustom(false)
  }

  const updateDensity = (next: string) => {
    if (!settings || !isWorkspaceDensity(next) || next === density) return
    setPendingDensity(next)
    saveSettings.mutate({ ...settings, ui_density: next }, {
      onError: () => setPendingDensity(null),
    })
  }

  if (hidden) return null

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="ghost"
        icon={<Icons.calendar className="h-4 w-4" aria-hidden="true" />}
        data-active-range={visibleContextLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={toggle}
        className={cn(
          'min-w-0 max-w-40 justify-start gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          variant === 'status' &&
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs',
          className,
        )}
      >
        {!iconOnly && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">
              {visibleContextLabel}
            </span>
            <Icons.expand
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </>
        )}
      </Button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side={variant === 'status' ? 'top' : 'bottom'}
        align="end"
        zIndex={70}
        ariaLabel={t('workspace.analysis.title', 'View settings')}
        className="w-[min(92vw,27rem)] max-h-[min(80vh,38rem)] overflow-y-auto rounded-shape-xl border-[var(--panel-border)] bg-[var(--panel-bg)] p-0 shadow-e3"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-3">
          <PanelTitle className="flex items-center gap-2 text-base">
            <Icons.preferences className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />
            {t('workspace.analysis.title', 'View settings')}
          </PanelTitle>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!settings || saveSettings.isPending}
              onClick={() => {
                range.setPreset(preferences.defaultAnalysisRange)
                range.setCompare(false)
                updateDensity('comfortable')
                setShowCustom(false)
              }}
              className="text-xs font-medium text-[var(--text-muted)]"
            >
              {t('workspace.analysis.reset', 'Reset')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('workspace.analysis.close', 'Close view settings')}
              onClick={close}
              className="min-h-9 min-w-9 p-0 text-[var(--text-muted)]"
            >
              <Icons.close className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Caption className="font-semibold tracking-wide">
                {t('workspace.analysis.range', 'Date range')}
              </Caption>
              <Caption className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[var(--text-secondary)]">
                {t(
                  'workspace.analysis.activeRange',
                  '{{start}} to {{end}}',
                  { start: formatDateShort(`${range.start}T00:00:00`), end: formatDate(`${range.end}T00:00:00`) },
                )}
              </Caption>
            </div>
            <div
              role="group"
              aria-label={t('workspace.analysis.range', 'Date range')}
              className="space-y-2"
            >
              <div className="grid grid-cols-2 gap-2">
                {quickPresets.map(presetButton)}
              </div>
              {legacyPreset && presetButton(legacyPreset)}
              {calendarRoute && (
                <div role="group" aria-label={t('workspace.analysis.fullYear', 'Full year {{year}}', { year: String(selectedYear) })}
                  className={cn(
                    'flex min-w-0 items-center rounded-lg border bg-[var(--surface-1)]',
                    !showCustom && fullYear != null
                      ? 'border-[var(--theme-primary)] shadow-e1'
                      : 'border-[var(--border-default)]',
                  )}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('workspace.analysis.previousYear', 'Previous year')}
                    disabled={selectedYear <= 1900}
                    onClick={() => applyYear(selectedYear - 1)}
                    className="min-h-11 min-w-11 shrink-0 px-1"
                  >
                    <Icons.previous className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('workspace.analysis.fullYear', 'Full year {{year}}', { year: String(selectedYear) })}
                    aria-pressed={!showCustom && fullYear != null}
                    onClick={() => applyYear(selectedYear)}
                    className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-none px-0.5 text-[var(--text-primary)]"
                  >
                    <span className="text-2xs leading-none text-[var(--text-muted)]">
                      {t('workspace.analysis.fullYearLabel', 'Full year')}
                    </span>
                    <span className="text-sm font-semibold leading-none">{selectedYear}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('workspace.analysis.nextYear', 'Next year')}
                    disabled={selectedYear >= calendarYear}
                    onClick={() => applyYear(selectedYear + 1)}
                    className="min-h-11 min-w-11 shrink-0 px-1"
                  >
                    <Icons.next className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 border-t border-[var(--border-default)] pt-2">
                {presetButton('all')}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={showCustom || (!range.presetId && fullYear == null)}
                  onClick={() => setShowCustom(true)}
                  className={cn(
                    'min-h-11 min-w-0 rounded-lg border px-2 text-xs transition-colors',
                    showCustom || (!range.presetId && fullYear == null)
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-1)] font-semibold text-[var(--text-primary)] shadow-e1'
                      : 'border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]',
                  )}
                >
                  {t('workspace.analysis.custom', 'Custom')}
                </Button>
              </div>
            </div>
            {(range.presetId === 'live' || range.presetId === '24h' || range.presetId === 'today') && !showCustom && (
              <Caption className="block">
                {range.presetId === 'today'
                  ? t('workspace.analysis.todayHint', 'Today starts at midnight in your local timezone.')
                  : t('workspace.analysis.rollingHint', 'Rolling window: the last {{minutes}} of available data, refreshed as time passes.', {
                      minutes: range.presetId === 'live' ? '5 minutes' : '24 hours',
                    })}
              </Caption>
            )}
            {showCustom && (
              <div className="space-y-3 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    type="date"
                    label={t('date.range.start', 'Start date')}
                    value={draftStart}
                    max={draftEnd}
                    onChange={(event) => setDraftStart(event.target.value)}
                  />
                  <Input
                    type="date"
                    label={t('date.range.end', 'End date')}
                    value={draftEnd}
                    min={draftStart}
                    onChange={(event) => setDraftEnd(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={!validDraft}
                  onClick={() => {
                    range.setRange({ start: draftStart, end: draftEnd }, 'custom')
                    close()
                  }}
                  className="w-full"
                >
                  {t('workspace.analysis.applyCustom', 'Apply custom range')}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border-default)] pt-4">
            <Toggle
              size="sm"
              checked={range.compare}
              onChange={range.setCompare}
              label={t('date.range.compare', 'Compare to previous period')}
              className="w-full flex-row-reverse justify-between"
            />
            <Text as="p" variant="caption" className="mt-1">
              {t('workspace.analysis.compareHint', 'Adds comparison variance to supported views.')}
            </Text>
          </div>

          <div className="space-y-2 border-t border-[var(--border-default)] pt-4">
            <Caption className="block font-semibold tracking-wide">
              {t('workspace.analysis.density', 'Display density')}
            </Caption>
            <div role="group" aria-label={t('workspace.analysis.density', 'Display density')} className="grid grid-cols-3 gap-2">
              {(['compact', 'comfortable', 'spacious'] as const).map(option => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={density === option}
                  disabled={!settings || saveSettings.isPending}
                  onClick={() => updateDensity(option)}
                  className={cn(
                    'flex h-auto min-h-20 min-w-0 flex-col gap-2 rounded-shape-lg border px-1 py-2 text-xs',
                    density === option
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-2)] text-[var(--text-primary)] shadow-e1'
                      : 'border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)]',
                  )}
                >
                  <span aria-hidden className="flex h-8 w-full max-w-24 flex-col justify-center gap-1 rounded-shape-sm bg-[var(--surface-3)] px-2">
                    <span className={cn('h-1 rounded-full bg-[var(--theme-primary)]', option === 'spacious' ? 'w-1/2' : 'w-4/5')} />
                    <span className={cn('h-1 rounded-full bg-[var(--border-strong)]', option === 'compact' ? 'w-3/5' : 'w-2/5')} />
                  </span>
                  {t(`density.${option}`, { comfortable: 'Comfortable', compact: 'Compact', spacious: 'Spacious' }[option])}
                </Button>
              ))}
            </div>
            {!settings && (
              <div className="flex items-center justify-between gap-2">
                <Text as="p" variant="caption">
                  {settingsLoading
                    ? t('workspace.analysis.loadingDensity', 'Loading display settings…')
                    : t('workspace.analysis.unavailableDensity', 'Display settings unavailable. Retry to change density.')}
                </Text>
                {!settingsLoading && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void refetchSettings()}>
                    {t('workspace.analysis.retry', 'Retry')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {range.compare && (
          <div className="border-t border-[var(--border-default)] bg-[var(--surface-2)] px-5 py-3">
            <Caption className="text-cyan-700 dark:text-cyan-300">
              {t('workspace.analysis.comparisonActive', 'Comparison active: previous matching period')}
            </Caption>
          </div>
        )}
      </Popover>
    </>
  )
}
