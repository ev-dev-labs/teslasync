/**
 * Personal SLO visualisation.
 *
 * Per the spec, this is a personal-goal surface for self-hosted
 * operators (no customer SLA framing). Window selector spans
 * 24h / 7d / 30d / 90d / 1y; the API endpoint
 * GET /api/v1/status/uptime?window=… returns the current uptime
 * percentage and a `historical_source` discriminator so we know whether
 * to draw a real per-window line or a "current snapshot" caveat.
 *
 * Personal target line: defaults to 99% (the spec's example). Persisted
 * in localStorage so it survives reloads — there is no backend field for
 * this yet, and "personal" means truly personal.
 */

import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Target, Info } from 'lucide-react'
import { GlassPanel, Button, Input, PanelTitle, Text, Caption, Tabs } from '@/components/ui'
import { QueryError, StaleRefreshWarning } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import { request } from '@/api/client'
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'
import { isFiniteNumber } from '@/lib/numberFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type Window = '24h' | '7d' | '30d' | '90d' | '1y'

const WINDOW_LABEL: Record<Window, string> = {
  '24h': 'Last 24 hours',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y':  'Last year',
}

interface UptimeWindow {
  window: string
  uptime_percent: number
  healthy_count: number
  total_count: number
  generated_at: string
  historical_source: string
  note?: string
}

const TARGET_KEY = 'teslasync.status.slo.target'

function loadTarget(): number {
  if (typeof window === 'undefined') return 99
  const v = window.localStorage.getItem(TARGET_KEY)
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 99
}

export function SLOTrackingCard() {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation()
  const [win, setWin] = useState<Window>('30d')
  const [target, setTargetState] = useState<number>(() => loadTarget())
  const [editing, setEditing] = useState(false)
  const [draftTarget, setDraftTarget] = useState<string>(String(target))
  const tabsId = useId()
  const windowLabels: Record<Window, string> = {
    '24h': t('systemStatus.slo.windows.day', 'Last 24 hours'),
    '7d': t('systemStatus.slo.windows.week', 'Last 7 days'),
    '30d': t('systemStatus.slo.windows.month', 'Last 30 days'),
    '90d': t('systemStatus.slo.windows.quarter', 'Last 90 days'),
    '1y': t('systemStatus.slo.windows.year', 'Last year'),
  }
  const windowTabs = (Object.keys(WINDOW_LABEL) as Window[]).map((key) => ({
    key,
    label: t('systemStatus.slo.windowLabel', '{{window}} · {{label}}', { window: key, label: windowLabels[key] }),
  }))

  const query = useQuery({
    queryKey: ['status-uptime', win],
    queryFn: () => request<UptimeWindow>(`/status/uptime?window=${win}`),
    refetchInterval: 60_000,
  })
  const { data, isLoading } = query
  const state = useDataState(query, { provenance: 'historical' })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TARGET_KEY, String(target))
    }
  }, [target])

  // Uptime is only meaningful when the API returns a finite percentage. A
  // missing / null / NaN value must read as "unknown" (—), never a misleading
  // 0.00% painted in the failure tone (which is what an unguarded `?? null`
  // that lets NaN through would produce, since `NaN == null` is false).
  const rawPct = data?.uptime_percent
  const hasHistory = data?.historical_source === 'series'
  const showControls = !data || hasHistory
  const pct = hasHistory && isFiniteNumber(rawPct) ? rawPct : null
  const rawHealthy = data?.healthy_count
  const healthy = isFiniteNumber(rawHealthy) ? rawHealthy : null
  const rawTotal = data?.total_count
  const totalComponents = isFiniteNumber(rawTotal) ? rawTotal : null

  const handleSaveTarget = useCallback(() => {
    const n = Number(draftTarget)
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      setDraftTarget(String(target))
      setEditing(false)
      return
    }
    setTargetState(n)
    setEditing(false)
  }, [draftTarget, target])

  const handleCancelEdit = useCallback(() => {
    setEditing(false)
    setDraftTarget(String(target))
  }, [target])

  // Always seed the draft from the current target so the input never opens on
  // a stale value, regardless of how `target` last changed.
  const handleStartEdit = useCallback(() => {
    setDraftTarget(String(target))
    setEditing(true)
  }, [target])

  const handleTargetKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveTarget()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    },
    [handleSaveTarget, handleCancelEdit],
  )

  return (
    <GlassPanel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Target className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <PanelTitle as="h3">{t('systemStatus.slo.title', 'Uptime & SLO')}</PanelTitle>
        </div>
        {showControls && <div className="flex flex-wrap items-center gap-1.5">
          {editing ? (
            <>
              <Caption>{t('systemStatus.slo.target', 'Target')}</Caption>
              <Input
                value={draftTarget}
                onChange={(e) => setDraftTarget(e.target.value)}
                onKeyDown={handleTargetKeyDown}
                type="number"
                min={1}
                max={100}
                step={0.1}
                className="w-20"
                aria-label={t('systemStatus.slo.targetAria', 'Target uptime percentage')}
              />
              <Caption>%</Caption>
              <Button type="button" size="sm" variant="primary" wrapLabel onClick={handleSaveTarget}>{t('common.save', 'Save')}</Button>
              <Button type="button" size="sm" variant="ghost" wrapLabel onClick={handleCancelEdit}>{t('common.cancel', 'Cancel')}</Button>
            </>
          ) : (
            <>
              <Caption>{t('systemStatus.slo.targetValue', 'Target {{target}}%', { target })}</Caption>
              <Button type="button" size="sm" variant="ghost" wrapLabel onClick={handleStartEdit}>{t('common.edit', 'Edit')}</Button>
            </>
          )}
        </div>}
      </div>

      <StaleRefreshWarning state={state} label={t('systemStatus.slo.title', 'Uptime & SLO')} />
      {showControls && (
        <Tabs
          tabs={windowTabs}
          activeTab={win}
          onChange={(key) => {
            if (Object.prototype.hasOwnProperty.call(WINDOW_LABEL, key)) setWin(key as Window)
          }}
          idBase={tabsId}
          ariaLabel={t('systemStatus.slo.windowAria', 'Uptime window selector')}
          className="mt-3"
        />
      )}
      <div
        role={showControls ? 'tabpanel' : undefined}
        id={showControls ? `${tabsId}-panel-${win}` : undefined}
        aria-labelledby={showControls ? `${tabsId}-tab-${win}` : undefined}
        tabIndex={showControls ? 0 : undefined}
        className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
      <div className="mt-3" aria-live="polite">
        <SystemSummaryBrief
          title={t('systemStatus.slo.metricsTitle', 'Uptime evidence')}
          description={data?.note ?? t('systemStatus.slo.briefDescription', 'Historical uptime is shown only for a series-backed response; current component health is separate snapshot evidence.')}
          scope={hasHistory ? windowLabels[win] : t('systemStatus.currentHealthOnly', 'Current component health')}
          freshness={data?.generated_at}
          available={state.hasData} loading={isLoading && !state.hasData} retained={state.hasData && query.isError}
          metricTones={{ uptime: pct == null ? 'neutral' : pct >= target ? 'success' : pct >= target - 1 ? 'warning' : 'danger' }}
          metrics={[
            { metricId: 'percent', occurrenceId: 'uptime', rawValue: pct, label: t('systemStatus.slo.uptimeMetric', 'Historical uptime'),
              context: t('systemStatus.slo.targetValue', 'Target {{target}}%', { target }),
              display: { formatter: (raw) => ({ value: fmtPercent(raw) }) } },
            { metricId: 'count', occurrenceId: 'healthy-components', rawValue: healthy,
              label: t('systemStatus.slo.componentsMetric', 'Healthy components'),
              display: totalComponents == null ? undefined : { countTotal: totalComponents },
              context: t('systemStatus.slo.healthyComponents', '{{healthy}} / {{total}} components healthy', { healthy: healthy ?? '—', total: totalComponents ?? '—' }) },
          ]}
        />
      </div>

      {data?.historical_source && data.historical_source !== 'series' && (
        <Text as="p" variant="caption" role="note" className="mt-3 inline-flex items-start gap-1.5 text-amber-300">
          <Info aria-hidden="true" className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            {data.note ?? t('systemStatus.slo.snapshotNote', 'Per-window historical uptime requires the heartbeat history backend (planned). This figure reflects the current snapshot.')}
          </span>
        </Text>
      )}

      {isLoading && !state.hasData && <Text as="p" variant="caption" role="status" className="mt-3">{t('systemStatus.slo.loading', 'Loading uptime…')}</Text>}
      {state.fatalError && <QueryError
        error={state.fatalError}
        message={t('systemStatus.slo.loadFailed', 'Failed to load uptime data.')}
        onRetry={() => { void query.refetch(); }}
      />}
      </div>
    </GlassPanel>
  )
}
