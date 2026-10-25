import { ShieldCheck, AlertTriangle, CheckCircle2, Clock, History, CalendarClock } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, QueryError } from '@/components/feedback';
import type { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';

type Props = { controller: ReturnType<typeof useSecretRotationPage> };

export function SecretRotationSummary({ controller }: Props) {
  const { fmtNumber, t, source, showError, isLoading, rowLabel, counts, total, distinctKinds, okPct, oldest, soonestExpiry, retry } = controller;

  return (
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
              <QueryError error={source.fatalError} onRetry={retry} />
            </div>
          ) : (
            <>
              <MetricCard
                label={t('admin.secretRotation.totalLabel', 'Tracked secrets')}
                value={source.hasData ? fmtNumber(total) : '—'}
                icon={<ShieldCheck className="h-5 w-5" />}
                color="cyan"
                subtitle={source.hasData ? t('admin.secretRotation.kindCount', '{{count}} kinds tracked', { count: distinctKinds }) : t('admin.secretRotation.noData', 'No data')}
              />
              <MetricCard
                label={t('admin.secretRotation.okLabel', 'Healthy')}
                value={source.hasData ? fmtNumber(counts.ok) : '—'}
                icon={<CheckCircle2 className="h-5 w-5" />}
                color="green"
                subtitle={t('admin.secretRotation.okSub', '{{pct}} of tracked', { pct: okPct })}
              />
              <MetricCard
                label={t('admin.secretRotation.warnLabel', 'Rotate soon')}
                value={source.hasData ? fmtNumber(counts.warn) : '—'}
                icon={<Clock className="h-5 w-5" />}
                color="amber"
                subtitle={t('admin.secretRotation.warnSub', 'Approaching threshold')}
              />
              <MetricCard
                label={t('admin.secretRotation.criticalLabel', 'Overdue')}
                value={source.hasData ? fmtNumber(counts.critical) : '—'}
                icon={<AlertTriangle className="h-5 w-5" />}
                color="red"
                subtitle={t('admin.secretRotation.criticalSub', 'Past critical threshold')}
              />
              <MetricCard
                label={t('admin.secretRotation.oldestLabel', 'Oldest secret')}
                value={oldest?.age_days != null ? t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(oldest.age_days) }) : '—'}
                icon={<History className="h-5 w-5" />}
                color="purple"
                subtitle={oldest ? rowLabel(oldest) : t('admin.secretRotation.noData', 'No data')}
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
                subtitle={soonestExpiry ? rowLabel(soonestExpiry) : t('admin.secretRotation.noExpiry', 'No expiry tracked')}
              />
            </>
          )}
        </section>
      </FadeIn>
  );
}
