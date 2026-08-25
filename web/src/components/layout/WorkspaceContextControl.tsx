import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings, useSaveSettings } from '@/api/hooks/useSettings'
import {
  Button,
  Caption,
  Input,
  PanelTitle,
  Popover,
  Select,
  Text,
  Toggle,
} from '@/components/ui/runtime'
import { useRangeState } from '@/hooks/useRangeState'
import { getCurrentDensity } from '@/hooks/useDensitySync'
import { getDatePreset } from '@/lib/datePresets'
import { cn } from '@/lib/cn'
import { Icons } from '@/lib/icons'
import {
  WORKSPACE_DENSITY_EVENT,
  WORKSPACE_RANGE_EVENT,
  WORKSPACE_RANGE_PRESETS,
  isWorkspaceDensity,
  isWorkspaceRangePreset,
} from '@/lib/workspacePreferences'
import { useStatusBarPopover } from './status-bar/StatusBarContext'

export interface WorkspaceContextControlProps {
  className?: string
  /** Only one mounted control should handle global command-palette events. */
  listenForCommands?: boolean
  /** Compact footer treatment coordinated with the other status popovers. */
  variant?: 'header' | 'status'
  iconOnly?: boolean
}

export function WorkspaceContextControl({
  className,
  listenForCommands = true,
  variant = 'header',
  iconOnly = false,
}: WorkspaceContextControlProps) {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { open, toggle, close } = useStatusBarPopover(
    variant === 'status' ? 'workspace-context-status' : 'workspace-context',
  )
  const range = useRangeState({
    defaultPresetId: '7d',
    enableCompare: true,
  })
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const density = settings?.ui_density ?? getCurrentDensity()
  const [draftStart, setDraftStart] = useState(range.start)
  const [draftEnd, setDraftEnd] = useState(range.end)

  useEffect(() => {
    if (!open) return
    setDraftStart(range.start)
    setDraftEnd(range.end)
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

  const rangeOptions = useMemo(
    () =>
      WORKSPACE_RANGE_PRESETS.map((id) => {
        const preset = getDatePreset(id)
        return {
          value: id,
          label: preset
            ? t(preset.i18nKey, preset.fallback)
            : id,
        }
      }),
    [t],
  )

  const densityOptions = useMemo(
    () => [
      { value: 'compact', label: t('density.compact', 'Compact') },
      { value: 'comfortable', label: t('density.comfortable', 'Comfortable') },
      { value: 'spacious', label: t('density.spacious', 'Spacious') },
    ],
    [t],
  )

  const activePreset = range.presetId
    ? getDatePreset(range.presetId)
    : undefined
  const activeLabel = activePreset
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

  const updateDensity = (next: string) => {
    if (!settings || !isWorkspaceDensity(next) || next === density) return
    saveSettings.mutate({ ...settings, ui_density: next })
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant={variant === 'status' ? 'ghost' : 'secondary'}
        icon={<Icons.calendar className="h-4 w-4" aria-hidden="true" />}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={toggle}
        className={cn(
          'max-w-40 justify-start',
          variant === 'status' &&
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs',
          className,
        )}
      >
        {!iconOnly && <span className="truncate">{visibleContextLabel}</span>}
      </Button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side={variant === 'status' ? 'top' : 'bottom'}
        align="end"
        ariaLabel={t('workspace.analysis.title', 'Workspace analysis context')}
        className="w-[min(92vw,24rem)] p-4"
      >
        <div className="space-y-4">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <Icons.preferences className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('workspace.analysis.title', 'Workspace analysis context')}
            </PanelTitle>
            <Text as="p" variant="bodySm" className="mt-1">
              {t(
                'workspace.analysis.description',
                'Vehicle-aware pages inherit this analysis window and interface density.',
              )}
            </Text>
            {(range.presetId === 'live' || range.presetId === '24h') && (
              <Caption className="mt-2 block">
                {t(
                  'workspace.analysis.liveHint',
                  'Live uses the latest available data. Precise-history views use rolling instants; calendar summaries include the local dates intersected by the selected window.',
                )}
              </Caption>
            )}
          </div>

          <Select
            label={t('workspace.analysis.range', 'Analysis window')}
            value={range.presetId ?? ''}
            placeholder={t('workspace.analysis.custom', 'Custom')}
            options={rangeOptions}
            size="sm"
            onChange={(event) => {
              if (isWorkspaceRangePreset(event.target.value)) {
                range.setPreset(event.target.value)
              }
            }}
          />

          <div className="grid grid-cols-2 gap-3">
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
            variant="outline"
            disabled={!validDraft}
            onClick={() => {
              range.setRange({ start: draftStart, end: draftEnd })
              close()
            }}
            className="w-full"
          >
            {t('workspace.analysis.applyCustom', 'Apply custom range')}
          </Button>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <Toggle
              size="sm"
              checked={range.compare}
              onChange={range.setCompare}
              label={t('date.range.compare', 'Compare to previous period')}
            />
          </div>

          <Select
            label={t('workspace.analysis.density', 'Workspace density')}
            value={density}
            options={densityOptions}
            size="sm"
            disabled={!settings || saveSettings.isPending}
            onChange={(event) => updateDensity(event.target.value)}
          />

          <Caption className="block">
            {t(
              'workspace.analysis.activeRange',
              '{{start}} to {{end}}',
              { start: range.start, end: range.end },
            )}
          </Caption>
          {range.compare && (
            <Caption className="block text-cyan-300">
              {t(
                'workspace.analysis.comparisonActive',
                'Comparison active: previous matching period',
              )}
            </Caption>
          )}
        </div>
      </Popover>
    </>
  )
}
