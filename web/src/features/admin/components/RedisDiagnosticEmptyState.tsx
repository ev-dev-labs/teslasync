import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Database, ServerCrash, Radio, Zap } from 'lucide-react'

import { GlassPanel, Badge, Button } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import {
  getRedisSignalKeys,
  type RedisSignalsMeta,
  type RedisSignalKeyEntry,
} from '@/api/devtools'

interface Props {
  vehicleId: number
  meta: RedisSignalsMeta | undefined
  onSelectVehicle: (vehicleId: number) => void
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * RedisDiagnosticEmptyState replaces the legacy generic "no signals cached"
 * EmptyState with a structured, actionable banner that branches on the new
 * `meta` block returned by GET /api/v1/dev-tools/redis-signals. Each branch
 * maps to one of the five empty-state root causes (mode-local, mirror-failed,
 * TTL-expired, never-streamed, fall-through) so engineers see a specific
 * next step instead of a black box.
 */
export function RedisDiagnosticEmptyState({ vehicleId, meta, onSelectVehicle }: Props) {
  const { t } = useTranslation()

  const { data: keysData } = useQuery({
    queryKey: ['redis-signal-keys'],
    queryFn: () => getRedisSignalKeys(50),
    staleTime: 30_000,
  })

  if (!meta) {
    // Backend doesn't expose meta yet — fall back to the legacy generic message.
    return (
      <EmptyState /* no-action: pre-meta backend rollback fallback — meta-aware diagnostic banner replaces this when meta is present */
        icon={<Database className="h-10 w-10" />}
        message={t('redis.noSignals', 'No signals cached for this vehicle')}
      />
    )
  }

  const otherKeys: RedisSignalKeyEntry[] =
    keysData?.keys.filter((k) => k.vehicle_id !== vehicleId && k.field_count > 0) ?? []

  // Branch 1 — mode=local: structural cause; banner explains the rollback switch.
  if (meta.live_signal_store_mode === 'local') {
    return (
      <DiagnosticBanner
        tone="danger"
        icon={<ServerCrash className="h-6 w-6" />}
        title={t('redis.diagnostic.modeLocal.title', 'Redis L2 writes are disabled')}
        body={t(
          'redis.diagnostic.modeLocal.body',
          'LIVE_SIGNAL_STORE_MODE=local means the telemetry pipeline writes only to the in-process L1 store and never mirrors to Redis. This page reads exclusively from Redis, so it cannot show data while local mode is active.',
        )}
        cta={t('redis.diagnostic.modeLocal.cta', 'See live-state contract docs')}
        ctaHref="/docs/caching"
        meta={meta}
      />
    )
  }

  // Branch 2 — hybrid mode, L1 has data but L2 doesn't: mirror is broken.
  if (meta.l1_signal_count > 0 && meta.redis_field_count === 0) {
    return (
      <DiagnosticBanner
        tone="warning"
        icon={<AlertTriangle className="h-6 w-6" />}
        title={t('redis.diagnostic.mirrorBroken.title', 'L2 mirror is failing')}
        body={t(
          'redis.diagnostic.mirrorBroken.body',
          'The in-process L1 store has {{count}} signals for this vehicle but Redis is empty. The async mirror goroutine in HybridLiveSignalStore.UpdateNonBlocking may be timing out or the Redis connection may be saturated. Check pod logs for "live signal store: Redis mirror failed".',
          { count: meta.l1_signal_count },
        )}
        otherKeys={otherKeys}
        onSelectVehicle={onSelectVehicle}
        meta={meta}
      />
    )
  }

  // Branch 3 — hybrid mode, both L1 and L2 empty AND no recent L1 telemetry:
  // either TTL expired or the vehicle never streamed.
  const lastSeenL1 = meta.l1_last_seen_at ? new Date(meta.l1_last_seen_at) : null
  const ttlSuspected =
    !lastSeenL1 || Date.now() - lastSeenL1.getTime() > SEVEN_DAYS_MS
  if (meta.l1_signal_count === 0 && ttlSuspected) {
    return (
      <DiagnosticBanner
        tone="info"
        icon={<Zap className="h-6 w-6" />}
        title={t('redis.diagnostic.noTelemetry.title', 'No recent telemetry for this vehicle')}
        body={
          lastSeenL1
            ? t(
                'redis.diagnostic.noTelemetry.bodyStale',
                'Last L1 entry was {{date}}. The 7-day Redis TTL has likely expired. Wait for the next telemetry push or warm the cache from the cold-path reader.',
                { date: lastSeenL1.toLocaleString() },
              )
            : t(
                'redis.diagnostic.noTelemetry.bodyAbsent',
                'This vehicle has no L1 entries on this pod. Either telemetry has never streamed for it, or this pod restarted before any telemetry arrived.',
              )
        }
        otherKeys={otherKeys}
        onSelectVehicle={onSelectVehicle}
        meta={meta}
      />
    )
  }

  // Branch 4 — fallthrough: hybrid + both empty + recent L1 absence (rare).
  return (
    <DiagnosticBanner
      tone="neutral"
      icon={<Radio className="h-6 w-6" />}
      title={t('redis.diagnostic.empty.title', 'No signals cached for this vehicle')}
      body={t(
        'redis.diagnostic.empty.body',
        'Both L1 and L2 are empty. If this vehicle is currently streaming, give the next batch a few seconds to arrive. Otherwise check the telemetry pipeline.',
      )}
      otherKeys={otherKeys}
      onSelectVehicle={onSelectVehicle}
      meta={meta}
    />
  )
}

interface BannerProps {
  tone: 'danger' | 'warning' | 'info' | 'neutral'
  icon: React.ReactNode
  title: string
  body: string
  cta?: string
  ctaHref?: string
  otherKeys?: RedisSignalKeyEntry[]
  onSelectVehicle?: (id: number) => void
  meta: RedisSignalsMeta
}

function DiagnosticBanner({
  tone,
  icon,
  title,
  body,
  cta,
  ctaHref,
  otherKeys,
  onSelectVehicle,
  meta,
}: BannerProps) {
  const { t } = useTranslation()
  const toneClass = {
    danger: 'border-rose-500/30 bg-rose-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    info: 'border-cyan-500/30 bg-cyan-500/5',
    neutral: 'border-[var(--border-subtle)] bg-[var(--surface-2)]',
  }[tone]
  return (
    <GlassPanel className={`border ${toneClass}`} padding="md" data-testid="redis-diagnostic-banner" data-tone={tone}>
      <div className="flex items-start gap-4">
        <div className="text-[var(--text-secondary)]">{icon}</div>
        <div className="flex-1 space-y-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-sm text-[var(--text-secondary)]">{body}</p>
          <DiagnosticMetaList meta={meta} />
          {cta && ctaHref && (
            <a href={ctaHref} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">{cta}</Button>
            </a>
          )}
          {otherKeys && otherKeys.length > 0 && (
            <div className="space-y-2 pt-2" data-testid="redis-diagnostic-other-vehicles">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                {t('redis.diagnostic.otherVehicles', 'Other vehicles with cached signals')}
              </p>
              <div className="flex flex-wrap gap-2">
                {otherKeys.slice(0, 6).map((k) => (
                  <button
                    key={k.vehicle_id}
                    type="button"
                    onClick={() => onSelectVehicle?.(k.vehicle_id)}
                    data-testid={`redis-diagnostic-other-${k.vehicle_id}`}
                    className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                  >
                    {k.display_name || k.vehicle_vin || `Vehicle ${k.vehicle_id}`}{' '}
                    <span className="text-[var(--text-muted)]">· {k.field_count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  )
}

function DiagnosticMetaList({ meta }: { meta: RedisSignalsMeta }) {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
      <Row label={t('redis.diagnostic.meta.mode', 'Live store mode')}>
        <Badge size="sm" variant={meta.live_signal_store_mode === 'hybrid' ? 'success' : 'danger'}>
          {meta.live_signal_store_mode}
        </Badge>
      </Row>
      <Row label={t('redis.diagnostic.meta.key', 'Redis key')}>
        <code className="font-mono text-[var(--text-primary)]">{meta.redis_key}</code>
      </Row>
      <Row label={t('redis.diagnostic.meta.l1Count', 'L1 signals')}>{meta.l1_signal_count}</Row>
      <Row label={t('redis.diagnostic.meta.l2Count', 'L2 fields (raw)')}>{meta.redis_field_count}</Row>
      <Row label={t('redis.diagnostic.meta.l1LastSeen', 'L1 last seen')}>
        {meta.l1_last_seen_at ? new Date(meta.l1_last_seen_at).toLocaleString() : '—'}
      </Row>
      <Row label={t('redis.diagnostic.meta.l2LastSeen', 'L2 last seen')}>
        {meta.l2_last_seen_at ? new Date(meta.l2_last_seen_at).toLocaleString() : '—'}
      </Row>
      {meta.vehicle_vin && (
        <Row label={t('redis.diagnostic.meta.vin', 'VIN')}>
          <code className="font-mono text-[var(--text-primary)]">{meta.vehicle_vin}</code>
        </Row>
      )}
    </dl>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="text-[var(--text-secondary)]">{children}</dd>
    </>
  )
}
