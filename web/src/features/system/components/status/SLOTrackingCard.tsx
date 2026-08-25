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

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Target, Info } from 'lucide-react'
import { GlassPanel, Button, Input } from '@/components/ui'
import { request } from '@/api/client'
import { cn } from '@/lib/cn'
import { fmtPercent, isFiniteNumber } from '@/lib/numberFormat'

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
  const { t } = useTranslation()
  const [win, setWin] = useState<Window>('30d')
  const [target, setTargetState] = useState<number>(() => loadTarget())
  const [editing, setEditing] = useState(false)
  const [draftTarget, setDraftTarget] = useState<string>(String(target))

  const { data, isLoading, error } = useQuery({
    queryKey: ['status-uptime', win],
    queryFn: () => request<UptimeWindow>(`/status/uptime?window=${win}`),
    refetchInterval: 60_000,
  })

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
  const pct = isFiniteNumber(rawPct) ? rawPct : null
  const rawHealthy = data?.healthy_count
  const healthy = isFiniteNumber(rawHealthy) ? rawHealthy : null
  const rawTotal = data?.total_count
  const totalComponents = isFiniteNumber(rawTotal) ? rawTotal : null

  const tone = useMemo(() => {
    if (pct == null) return 'text-[var(--text-muted)]'
    if (pct >= target) return 'text-green-300'
    if (pct >= target - 1) return 'text-amber-300'
    return 'text-red-300'
  }, [pct, target])

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
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('Uptime & SLO')}</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          {editing ? (
            <>
              <span>{t('Target')}</span>
              <Input
                value={draftTarget}
                onChange={(e) => setDraftTarget(e.target.value)}
                onKeyDown={handleTargetKeyDown}
                type="number"
                min={1}
                max={100}
                step={0.1}
                className="w-20"
                aria-label={t('Target uptime percentage')}
              />
              <span>%</span>
              <Button type="button" size="sm" variant="primary" onClick={handleSaveTarget}>{t('Save')}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={handleCancelEdit}>{t('Cancel')}</Button>
            </>
          ) : (
            <>
              <span>{t('Target {{target}}%', { target })}</span>
              <Button type="button" size="sm" variant="ghost" onClick={handleStartEdit} className="text-xs">{t('Edit')}</Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-3">
        <div className={cn('text-3xl font-semibold tabular-nums', tone)} aria-live="polite">
          {pct == null ? '—' : fmtPercent(pct, 2)}
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          {t(WINDOW_LABEL[win])}
          {' · '}
          {t('{{healthy}} / {{total}} components healthy', {
            healthy: healthy ?? '—',
            total: totalComponents ?? '—',
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label={t('Uptime window selector')}>
        {(Object.keys(WINDOW_LABEL) as Window[]).map((w) => (
          <Button
            key={w}
            type="button"
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={win === w}
            title={t(WINDOW_LABEL[w])}
            onClick={() => setWin(w)}
            className={cn(
              'h-auto rounded-full px-3 py-1 text-xs font-medium',
              win === w
                ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40'
                : 'bg-white/[0.04] text-[var(--text-secondary)] hover:bg-white/[0.08]',
            )}
          >
            {w}
          </Button>
        ))}
      </div>

      {data?.historical_source && data.historical_source !== 'series' && (
        <p role="note" className="mt-3 inline-flex items-start gap-1.5 text-xs text-amber-200/80">
          <Info aria-hidden="true" className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            {data.note ?? t('Per-window historical uptime requires the heartbeat history backend (planned). This figure reflects the current snapshot.')}
          </span>
        </p>
      )}

      {isLoading && <p role="status" className="mt-3 text-xs text-[var(--text-muted)]">{t('Loading uptime…')}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{t('Failed to load uptime data.')}</p>}
    </GlassPanel>
  )
}
