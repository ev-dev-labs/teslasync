/**
 * Secret Rotation page — admin observability surface.
 *
 * Per-(kind, target) rotation tracker. Surfaces the age of every tracked
 * secret (Tesla refresh token, MQTT mTLS cert, DB password, session JWK,
 * Authentik client secret, app signing key) with a severity tier computed
 * against per-kind warn/critical thresholds on the server.
 *
 * Modern-UI full-width bento: a KPI band, an age-by-secret chart + severity
 * donut, a rotation-urgency / expiry-watch row, and a full-width detail
 * table. Every data section owns its loading / empty / error state.
 *
 * Backed by GET /api/v1/admin/observability/secret-rotation
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, Clock, History,
  CalendarClock, KeyRound, Gauge,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Badge, DataTable, PanelTitle, Caption, Text, type Column,
} from '@/components/ui';
import { MetricCard, MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState, AlertBanner, SectionErrorBoundary, Skeleton, QueryError,
} from '@/components/feedback';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { useSecretRotation } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type {
  SecretRotationSeverity,
  SecretRotationStatus,
} from '@/types/admin-operator-confidence';

const SEVERITY_VARIANT: Record<SecretRotationSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

// Chart-only hex — dynamic fill values, not static CSS vars. `unknown`
// borrows the muted slate used across the app's neutral chips.
const SEVERITY_HEX: Record<SecretRotationSeverity, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  critical: '#ef4444',
  unknown: '#64748b',
};

const SEVERITY_ORDER: SecretRotationSeverity[] = ['critical', 'warn', 'ok', 'unknown'];

// English fallback labels for the raw kind enum. The component resolves these
// through i18n (`admin.secretRotation.kind.<enum>`) using the value here as the
// default, so translators can localise them and newly-added kinds still render
// their raw value before either map is updated.
const KIND_LABELS: Record<string, string> = {
  tesla_refresh_token: 'Tesla refresh token',
  mqtt_mtls_cert: 'MQTT mTLS certificate',
  database_password: 'Database password',
  session_jwk: 'Session JWK',
  app_signing_key: 'App signing key',
  authentik_secret: 'Authentik client secret',
};

/** Stable per-row key across (kind, target) pairs. */
function rowKey(r: SecretRotationStatus): string {
  return `${r.kind}:${r.target_id ?? ''}`;
}

/** Clip long labels so axis ticks and list rows stay one line. */
function truncate(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function SecretRotationPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.secretRotation.pageTitle', 'Secret Rotation'));

  const query = useSecretRotation();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const showError = query.isError && !subsystemMissing;
  const isLoading = query.isLoading;
  const items = query.data?.items ?? [];

  // Friendly, translatable label for a secret kind — dynamic i18n key with the
  // English `KIND_LABELS` entry as the fallback default.
  const kindLabel = useCallback(
    (raw: string) => t(`admin.secretRotation.kind.${raw}`, KIND_LABELS[raw] ?? raw),
    [t],
  );

  // Compose a readable chart/list label, appending the target when set.
  const rowLabel = useCallback(
    (r: SecretRotationStatus) => (r.target_id ? `${kindLabel(r.kind)} · ${r.target_id}` : kindLabel(r.kind)),
    [kindLabel],
  );

  // Severity display labels resolved through i18n (module-level consts can't
  // call `t`); memoised so the columns/legend/list stay stable.
  const severityLabel = useMemo<Record<SecretRotationSeverity, string>>(
    () => ({
      ok: t('admin.secretRotation.severityOk', 'OK'),
      warn: t('admin.secretRotation.severityWarn', 'Rotate soon'),
      critical: t('admin.secretRotation.severityCritical', 'Overdue'),
      unknown: '—',
    }),
    [t],
  );

  const counts = useMemo(() => {
    const c: Record<SecretRotationSeverity, number> = { ok: 0, warn: 0, critical: 0, unknown: 0 };
    for (const it of items) c[it.severity] = (c[it.severity] ?? 0) + 1;
    return c;
  }, [items]);

  const total = items.length;
  const distinctKinds = useMemo(() => new Set(items.map((r) => r.kind)).size, [items]);
  const okPct = total > 0 ? `${Math.round((counts.ok / total) * 100)}%` : '—';

  const oldest = useMemo(
    () => items.reduce<SecretRotationStatus | null>(
      (best, r) => (best === null || (r.age_days ?? 0) > (best.age_days ?? 0) ? r : best),
      null,
    ),
    [items],
  );

  const soonestExpiry = useMemo(
    () => items.reduce<SecretRotationStatus | null>((best, r) => {
      const d = r.days_to_expiry;
      if (d === null || d === undefined) return best;
      if (best === null || d < (best.days_to_expiry ?? Infinity)) return r;
      return best;
    }, null),
    [items],
  );

  // Oldest secrets, capped, for the horizontal age chart.
  const topByAge = useMemo(
    () => [...items]
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 10)
      .map((r) => ({ ...r, label: rowLabel(r) })),
    [items, rowLabel],
  );

  // Rotation urgency — age relative to the per-kind critical threshold, so a
  // full bar means the secret has hit (or passed) its overdue point. Sorted by
  // that ratio so the closest-to-overdue secrets surface first.
  const urgency = useMemo(
    () => [...items]
      .map((r) => {
        const crit = r.critical_days ?? 0;
        const ratio = crit > 0 ? (r.age_days ?? 0) / crit : 0;
        return { r, ratio };
      })
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 8),
    [items],
  );

  const expiryWatch = useMemo(
    () => items
      .filter((r) => r.expires_at != null && r.days_to_expiry != null)
      .sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0)),
    [items],
  );

  const severitySlices = useMemo(
    () => SEVERITY_ORDER
      .map((key) => ({ key, label: severityLabel[key], value: counts[key] ?? 0 }))
      .filter((s) => s.value > 0),
    [counts, severityLabel],
  );

  const columns = useMemo<Column<SecretRotationStatus>[]>(
    () => [
      {
        key: 'kind',
        header: t('admin.secretRotation.colKind', 'Kind'),
        render: (r) => (
          <div className="flex flex-col">
            <Text weight="medium" color="primary">{kindLabel(r.kind)}</Text>
            {r.target_id && <Caption>{r.target_id}</Caption>}
          </div>
        ),
      },
      {
        key: 'rotated',
        header: t('admin.secretRotation.colRotated', 'Last rotated'),
        render: (r) => (
          <div>
            <Text as="div" color="primary">{formatDateTime(r.last_rotated)}</Text>
            <Caption>{formatRelative(r.last_rotated)}</Caption>
          </div>
        ),
      },
      {
        key: 'age',
        header: t('admin.secretRotation.colAge', 'Age (days)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.age_days ?? 0)}</span>,
      },
      {
        key: 'expiry',
        header: t('admin.secretRotation.colExpiry', 'Expires'),
        render: (r) => {
          if (!r.expires_at) return <Text color="secondary">—</Text>;
          return (
            <div>
              <Text as="div" color="primary">{formatDateTime(r.expires_at)}</Text>
              <Caption>
                {r.days_to_expiry !== null && r.days_to_expiry !== undefined
                  ? t('admin.secretRotation.daysToExpiry', '{{days}}d remaining', { days: r.days_to_expiry })
                  : ''}
              </Caption>
            </div>
          );
        },
      },
      {
        key: 'thresholds',
        header: t('admin.secretRotation.colThresholds', 'Warn / critical'),
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">
            {fmtNumber(r.warn_days ?? 0)}d / {fmtNumber(r.critical_days ?? 0)}d
          </span>
        ),
      },
      {
        key: 'severity',
        header: t('admin.secretRotation.colSeverity', 'Severity'),
        align: 'right',
        render: (r) => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {severityLabel[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t, severityLabel, kindLabel],
  );

  const retry = () => query.refetch();

  return (
    <PageContainer
      title={t('admin.secretRotation.pageTitle', 'Secret Rotation')}
      subtitle={t(
        'admin.secretRotation.subtitle',
        'Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible.',
      )}
      query={query}
    >
      {subsystemMissing && (
        <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
          {t(
            'admin.secretRotation.notConfigured',
            'The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.',
          )}
        </AlertBanner>
      )}

      {counts.critical > 0 && (
        <AlertBanner variant="danger" title={t('admin.secretRotation.criticalTitle', 'Overdue rotations')}>
          {t(
            'admin.secretRotation.criticalMessage',
            '{{count}} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.',
            { count: counts.critical },
          )}
        </AlertBanner>
      )}

      {/* 1 — KPI band ---------------------------------------------------- */}
      <FadeIn>
        <section
          aria-label={t('admin.secretRotation.kpis', 'Rotation summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={92} className="rounded-xl" />
            ))
          ) : showError ? (
            // A genuine (non-503) fetch failure must not surface fabricated
            // zero totals — a "0 overdue" band would falsely tell an operator
            // no secret needs rotating when the data never loaded. Mirror the
            // error state the sections below own so the whole band reads as
            // "failed", not "everything healthy".
            <div className="col-span-full">
              <QueryError error={query.error} onRetry={retry} />
            </div>
          ) : (
            <>
              <MetricCard
                label={t('admin.secretRotation.totalLabel', 'Tracked secrets')}
                value={fmtNumber(total)}
                icon={<ShieldCheck className="h-5 w-5" />}
                color="cyan"
                subtitle={t('admin.secretRotation.kindCount', '{{count}} kinds tracked', { count: distinctKinds })}
              />
              <MetricCard
                label={t('admin.secretRotation.okLabel', 'Healthy')}
                value={fmtNumber(counts.ok)}
                icon={<CheckCircle2 className="h-5 w-5" />}
                color="green"
                subtitle={t('admin.secretRotation.okSub', '{{pct}} of tracked', { pct: okPct })}
              />
              <MetricCard
                label={t('admin.secretRotation.warnLabel', 'Rotate soon')}
                value={fmtNumber(counts.warn)}
                icon={<Clock className="h-5 w-5" />}
                color="amber"
                subtitle={t('admin.secretRotation.warnSub', 'Approaching threshold')}
              />
              <MetricCard
                label={t('admin.secretRotation.criticalLabel', 'Overdue')}
                value={fmtNumber(counts.critical)}
                icon={<AlertTriangle className="h-5 w-5" />}
                color="red"
                subtitle={t('admin.secretRotation.criticalSub', 'Past critical threshold')}
              />
              <MetricCard
                label={t('admin.secretRotation.oldestLabel', 'Oldest secret')}
                value={oldest ? t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(oldest.age_days ?? 0) }) : '—'}
                icon={<History className="h-5 w-5" />}
                color="purple"
                subtitle={oldest ? truncate(kindLabel(oldest.kind)) : t('admin.secretRotation.noData', 'No data')}
              />
              <MetricCard
                label={t('admin.secretRotation.soonestExpiryLabel', 'Soonest expiry')}
                value={
                  soonestExpiry && soonestExpiry.days_to_expiry != null
                    ? t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(soonestExpiry.days_to_expiry) })
                    : '—'
                }
                icon={<CalendarClock className="h-5 w-5" />}
                color={soonestExpiry && soonestExpiry.severity === 'critical' ? 'red' : 'blue'}
                subtitle={soonestExpiry ? truncate(kindLabel(soonestExpiry.kind)) : t('admin.secretRotation.noExpiry', 'No expiry tracked')}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Secret age + severity mix ---------------------------------- */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.secretRotation.ageSection', 'Secret age and severity')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.secretRotation.ageTitle', 'Secret age by kind')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={320} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : topByAge.length === 0 ? (
              <EmptyState /* no-action: chart renders once rotation observations exist */
                icon={<KeyRound className="h-8 w-8" />}
                message={t('admin.secretRotation.noAgeData', 'No rotation ages to chart yet.')}
              />
            ) : (
              <div
                className="h-72 sm:h-80"
                role="img"
                aria-label={t('admin.secretRotation.ageAria', 'Horizontal bar chart of the oldest tracked secrets by age in days, colored by severity tier')}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={topByAge} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(v) => `${fmtNumber(Number(v))}d`}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={148}
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(v) => truncate(String(v))}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      formatter={(v) => t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(Number(v)) })}
                    />
                    <Bar
                      dataKey="age_days"
                      name={t('admin.secretRotation.colAge', 'Age (days)')}
                      radius={[0, 4, 4, 0]}
                      fillOpacity={0.9}
                    >
                      {topByAge.map((r) => (
                        <Cell key={rowKey(r)} fill={SEVERITY_HEX[r.severity] ?? SEVERITY_HEX.unknown} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.secretRotation.severityTitle', 'Severity mix')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : severitySlices.length === 0 ? (
              <EmptyState /* no-action: severity is derived from backend thresholds */
                icon={<ShieldAlert className="h-8 w-8" />}
                message={t('admin.secretRotation.noSeverity', 'No severity data available yet.')}
              />
            ) : (
              <div className="space-y-4">
                <div
                  className="h-44"
                  role="img"
                  aria-label={t('admin.secretRotation.severityAria', 'Donut chart of tracked secrets grouped by rotation severity tier')}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={severitySlices}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {severitySlices.map((s) => (
                          <Cell key={s.key} fill={SEVERITY_HEX[s.key]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-1.5">
                  {SEVERITY_ORDER.map((key) => (
                    <li key={key} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: SEVERITY_HEX[key] }}
                          aria-hidden="true"
                        />
                        <Text variant="bodySm">{severityLabel[key]}</Text>
                      </span>
                      <Badge variant={SEVERITY_VARIANT[key]} size="sm">
                        {fmtNumber(counts[key] ?? 0)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Rotation urgency & expiry watch ---------------------------- */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('admin.secretRotation.outlook', 'Rotation urgency and expiry outlook')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.secretRotation.urgencyTitle', 'Rotation urgency')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : urgency.length === 0 ? (
              <EmptyState /* no-action: urgency derives from age vs per-kind critical threshold */
                icon={<Gauge className="h-8 w-8" />}
                message={t('admin.secretRotation.noUrgency', 'No rotation ages to rank yet.')}
              />
            ) : (
              <div className="space-y-3">
                {urgency.map(({ r }) => (
                  <MetricBar
                    key={rowKey(r)}
                    label={truncate(rowLabel(r), 28)}
                    value={r.age_days ?? 0}
                    max={(r.critical_days ?? 0) > 0 ? (r.critical_days as number) : ((r.age_days ?? 0) || 1)}
                    color={SEVERITY_HEX[r.severity] ?? SEVERITY_HEX.unknown}
                    sublabel={`${fmtNumber(r.age_days ?? 0)}d / ${fmtNumber(r.critical_days ?? 0)}d`}
                  />
                ))}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.secretRotation.expiryTitle', 'Expiry watch')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : expiryWatch.length === 0 ? (
              <EmptyState /* no-action: only credentials with a hard expiry (certs, tokens) populate this list */
                icon={<CalendarClock className="h-8 w-8" />}
                title={t('admin.secretRotation.noExpiryTitle', 'No expiring credentials')}
                message={t(
                  'admin.secretRotation.noExpiryMessage',
                  'None of the tracked secrets carry a hard expiry date. Rotation is driven by age thresholds instead.',
                )}
              />
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {expiryWatch.map((r) => (
                  <li key={rowKey(r)} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Text variant="body" className="block truncate">{kindLabel(r.kind)}</Text>
                      <Caption>{formatDateTime(r.expires_at)}</Caption>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Text
                        size="sm"
                        weight="semibold"
                        className={cn('tabular-nums', r.severity === 'critical' ? 'text-rose-300' : 'text-[var(--text-primary)]')}
                      >
                        {t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(r.days_to_expiry ?? 0) })}
                      </Text>
                      <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'} size="sm">
                        {severityLabel[r.severity] ?? r.severity}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Per-secret detail table ------------------------------------ */}
      <FadeIn delay={0.3}>
        <section aria-label={t('admin.secretRotation.tableTitle', 'Rotation status')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4">{t('admin.secretRotation.tableTitle', 'Rotation status')}</PanelTitle>
            <SectionErrorBoundary name="secret-rotation-table">
              {isLoading ? (
                <Skeleton height={280} />
              ) : showError ? (
                <QueryError error={query.error} onRetry={retry} />
              ) : items.length === 0 && !subsystemMissing ? (
                // no-action: rotation events are recorded automatically by the rotation tracker; no user action seeds them
                <EmptyState
                  icon={<ShieldCheck className="h-8 w-8" />}
                  title={t('admin.secretRotation.emptyTitle', 'No tracked secrets')}
                  message={t(
                    'admin.secretRotation.emptyMessage',
                    'No rotation events have been recorded yet. The tracker captures observations on every credential rotation.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="admin:secret-rotation"
                  columns={columns}
                  data={items}
                  keyExtractor={rowKey}
                  emptyMessage={t('admin.secretRotation.emptyTable', 'No tracked secrets')}
                  pagination
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
