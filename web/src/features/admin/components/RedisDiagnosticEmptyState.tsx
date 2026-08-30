import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Database, ServerCrash, Radio, Zap } from 'lucide-react'

import { GlassPanel, Badge, Button, Heading, Text, Code } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import { type ApiError } from '@/lib/resilience'
import { useDateFormat } from '@/hooks/useDateFormat'
import {
  getRedisSignalKeys,
  type RedisSignalsMeta,
  type RedisSignalKeyEntry,
} from '@/api/devtools'

/**
 * Discriminated union for the error-aware props. The banner also speaks for
 * the upstream useQuery — when the page
 * hit a 503 or a network failure, the banner takes precedence over the
 * meta-driven empty-state branches. Three legal shapes:
 *   - no error          → both undefined / false
 *   - typed API error   → serverError = ApiError instance
 *   - network failure   → serverError = null + networkError = true
 * The illegal shape (serverError: ApiError + networkError: true) is
 * type-rejected at the call site.
 */
export type DiagnosticErrorProps =
  | { serverError?: undefined; networkError?: false }
  | { serverError: ApiError; networkError?: false }
  | { serverError: null; networkError: true }

export type RedisDiagnosticEmptyStateProps = {
  vehicleId: number
  meta: RedisSignalsMeta | undefined
  onSelectVehicle: (vehicleId: number) => void
} & DiagnosticErrorProps

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * RedisDiagnosticEmptyState replaces the legacy generic "no signals cached"
 * EmptyState with a structured, actionable banner that branches on the new
 * `meta` block returned by GET /api/v1/dev-tools/redis-signals. Each branch
 * maps to one of the five empty-state root causes (mode-local, mirror-failed,
 * TTL-expired, never-streamed, fall-through) so engineers see a specific
 * next step instead of a black box.
 *
 * Upstream request failures (503 cache not wired, 503 unreachable, generic
 * 5xx, network error) take precedence so a backend outage is never disguised
 * as an empty cache. Error branches always win over meta branches.
 */
export function RedisDiagnosticEmptyState({
  vehicleId,
  meta,
  serverError,
  networkError,
  onSelectVehicle,
}: RedisDiagnosticEmptyStateProps) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()

  const { data: keysData, isError: keysQueryError } = useQuery({
    queryKey: ['redis-signal-keys'],
    queryFn: () => getRedisSignalKeys(50),
    staleTime: 30_000,
  })

  // Branch 0.A — Redis cache wiring missing on the API server (503 + specific msg).
  if (
    serverError &&
    serverError.status === 503 &&
    /not available/i.test(serverError.message)
  ) {
    return (
      <DiagnosticBanner
        tone="danger"
        icon={<ServerCrash className="h-6 w-6" />}
        title={t('redis.diagnostic.cacheNotWired.title', 'Redis cache is not configured')}
        body={t(
          'redis.diagnostic.cacheNotWired.body',
          'The TeslaSync API server started without a Redis connection. Set REDIS_ADDR (or REDIS_HOST + REDIS_PORT) in your environment, ensure the Redis service is reachable, and restart the API. This page reads exclusively from Redis and cannot function without it.',
        )}
        cta={t('redis.diagnostic.cacheNotWired.cta', 'See cache configuration docs')}
        ctaHref="/docs/caching#configuration"
        meta={meta}
      />
    )
  }

  // Branch 0.B — Redis configured but unreachable (5xx + 'unreachable'/'upstream' msg).
  if (
    serverError &&
    (serverError.status === 503 || serverError.status === 502 || serverError.status === 504) &&
    /unreachable|upstream/i.test(serverError.message)
  ) {
    return (
      <DiagnosticBanner
        tone="danger"
        icon={<ServerCrash className="h-6 w-6" />}
        title={t('redis.diagnostic.unreachable.title', 'Redis is unreachable')}
        body={t(
          'redis.diagnostic.unreachable.body',
          'The API server is configured to use Redis, but the connection failed. Check that the Redis pod is running, that network policies allow the API to reach it, and review API server logs for "redis signal cache: GetAll failed".',
        )}
        meta={meta}
      />
    )
  }

  // Branch 0.C — Any other typed API error (4xx that shouldn't happen, generic 5xx).
  if (serverError) {
    return (
      <DiagnosticBanner
        tone="warning"
        icon={<AlertTriangle className="h-6 w-6" />}
        title={t('redis.diagnostic.requestFailed.title', 'Could not load Redis signals')}
        body={t(
          'redis.diagnostic.requestFailed.body',
          'The server returned an error: {{status}} {{message}}. The Redis Signal Viewer cannot recover automatically — try refreshing, and if the error persists check the API server logs.',
          { status: serverError.status, message: serverError.message },
        )}
        meta={meta}
      />
    )
  }

  // Branch 0.D — Network-layer failure (fetch threw before the server replied).
  if (networkError) {
    return (
      <DiagnosticBanner
        tone="warning"
        icon={<AlertTriangle className="h-6 w-6" />}
        title={t('redis.diagnostic.networkError.title', 'Cannot reach the API server')}
        body={t(
          'redis.diagnostic.networkError.body',
          'The browser failed to fetch /api/v1/dev-tools/redis-signals. Check that the API server is running, the proxy/ingress is healthy, and there are no CORS or network errors in DevTools.',
        )}
        meta={meta}
      />
    )
  }

  if (!meta) {
    // Backend doesn't expose meta yet — fall back to the legacy generic message.
    return (
      <EmptyState /* no-action: pre-meta backend rollback fallback — meta-aware diagnostic banner replaces this when meta is present */
        icon={<Database className="h-10 w-10" />}
        message={t('redis.noSignals', 'No signals cached for this vehicle')}
      />
    )
  }

  // When the keys query itself is in an error state we hide the
  // "other vehicles" sub-section rather than render misleading chips
  // — the outer banner already tells the operator the request failed.
  const otherKeys: RedisSignalKeyEntry[] = keysQueryError
    ? []
    : keysData?.keys.filter((k) => k.vehicle_id !== vehicleId && k.field_count > 0) ?? []

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
                { date: formatDateTime(lastSeenL1) },
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
  meta: RedisSignalsMeta | undefined
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
          <Heading level="panel">{title}</Heading>
          <Text as="p" size="sm" color="secondary">{body}</Text>
          {meta && <DiagnosticMetaList meta={meta} />}
          {cta && ctaHref && (
            <a href={ctaHref} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">{cta}</Button>
            </a>
          )}
          {otherKeys && otherKeys.length > 0 && (
            <div className="space-y-2 pt-2" data-testid="redis-diagnostic-other-vehicles">
              <Text as="p" size="xs" color="muted" className="uppercase tracking-wide">
                {t('redis.diagnostic.otherVehicles', 'Other vehicles with cached signals')}
              </Text>
              <div className="flex flex-wrap gap-2">
                {otherKeys.slice(0, 6).map((k) => (
                  <Button
                    key={k.vehicle_id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectVehicle?.(k.vehicle_id)}
                    data-testid={`redis-diagnostic-other-${k.vehicle_id}`}
                    className={cn(
                      'h-auto rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1 hover:bg-[var(--surface-2)]',
                      typography.size.xs,
                      typography.color.secondary,
                    )}
                  >
                    {k.display_name || k.vehicle_vin || `Vehicle ${k.vehicle_id}`}{' '}
                    <Text color="muted">· {k.field_count}</Text>
                  </Button>
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
  const { formatDateTime } = useDateFormat()
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2', typography.size.xs, typography.color.secondary)}>
      <Row label={t('redis.diagnostic.meta.mode', 'Live store mode')}>
        <Badge size="sm" variant={meta.live_signal_store_mode === 'hybrid' ? 'success' : 'danger'}>
          {meta.live_signal_store_mode}
        </Badge>
      </Row>
      <Row label={t('redis.diagnostic.meta.key', 'Redis key')}>
        <Code>{meta.redis_key}</Code>
      </Row>
      <Row label={t('redis.diagnostic.meta.l1Count', 'L1 signals')}>{meta.l1_signal_count}</Row>
      <Row label={t('redis.diagnostic.meta.l2Count', 'L2 fields (raw)')}>{meta.redis_field_count}</Row>
      <Row label={t('redis.diagnostic.meta.l1LastSeen', 'L1 last seen')}>
        {meta.l1_last_seen_at ? formatDateTime(meta.l1_last_seen_at) : '—'}
      </Row>
      <Row label={t('redis.diagnostic.meta.l2LastSeen', 'L2 last seen')}>
        {meta.l2_last_seen_at ? formatDateTime(meta.l2_last_seen_at) : '—'}
      </Row>
      {meta.vehicle_vin && (
        <Row label={t('redis.diagnostic.meta.vin', 'VIN')}>
          <Code>{meta.vehicle_vin}</Code>
        </Row>
      )}
    </dl>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className={typography.color.muted}>{label}</dt>
      <dd className={typography.color.secondary}>{children}</dd>
    </>
  )
}
