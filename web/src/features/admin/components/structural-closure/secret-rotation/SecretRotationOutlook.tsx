import { CalendarClock, Gauge } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Badge, Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';
import { SEVERITY_VARIANT, SEVERITY_HEX, rowKey } from './helpers';

type Props = { controller: ReturnType<typeof useSecretRotationPage> };

export function SecretRotationOutlook({ controller }: Props) {
  const { fmtNumber, t, source, showError, isLoading, rowLabel, severityLabel, urgency, expiryWatch, retry } = controller;

  return (
<FadeIn delay={0.2}>
        <section
          aria-label={t('admin.secretRotation.outlook', 'Rotation urgency and expiry outlook')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5"
        >
          <LayoutCard title={t('admin.secretRotation.urgencyTitle', 'Rotation urgency')}>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={source.fatalError} onRetry={retry} />
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
                    label={rowLabel(r)}
                    value={r.age_days}
                    max={r.critical_days != null && r.critical_days > 0 ? r.critical_days : ((r.age_days ?? 0) || 1)}
                    color={SEVERITY_HEX[r.severity] ?? SEVERITY_HEX.unknown}
                    sublabel={`${r.age_days == null ? '—' : `${fmtNumber(r.age_days)}d`} / ${r.critical_days == null ? '—' : `${fmtNumber(r.critical_days)}d`}`}
                  />
                ))}
              </div>
            )}
          </LayoutCard>

          <LayoutCard title={t('admin.secretRotation.expiryTitle', 'Expiry watch')}>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={source.fatalError} onRetry={retry} />
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
                  <li key={rowKey(r)} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Text variant="body" className="block break-words">{rowLabel(r)}</Text>
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
          </LayoutCard>
        </section>
      </FadeIn>
  );
}
