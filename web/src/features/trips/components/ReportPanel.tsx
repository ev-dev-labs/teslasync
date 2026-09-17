import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { useReport, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Text } from '@/components/ui';
import { ListSkeleton, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import { safeArray } from '@/lib/safeArray';

/**
 * Trip report card: distance, duration, detour factor, plan/replan
 * counts, and the checklist recap. Read-only — the numbers refresh on
 * transitions, check-ins, and replans.
 */
export function ReportPanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const units = useUnits();

  const reportQuery = useReport(session.id);
  const reportState = useDataState(reportQuery);
  const report = reportQuery.data ?? null;
  const reportEvidence = safeArray(report?.evidence);

  return (
    <div className="space-y-4">
      <Text as="p" variant="label" className="flex items-center gap-2">
        <Icons.receipt className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('journey.report.title', 'Trip report')}
      </Text>

      {reportQuery.isLoading ? (
        <ListSkeleton label={t('journey.report.loading', 'Loading trip report…')} />
      ) : reportState.fatalError ? (
        <QueryError error={reportState.fatalError} onRetry={() => reportState.retry?.()} />
      ) : report == null ? (
        <Text as="p" size="sm" color="secondary">
          {t('journey.report.empty', 'No report yet.')}
        </Text>
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.distance', 'Distance')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {report.distance_m != null ? units.formatDistance(report.distance_m) : '—'}
              </Text>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.duration', 'Trip time')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {report.duration_s != null ? units.formatDuration(report.duration_s) : '—'}
              </Text>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.detour', 'Detour')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {report.detour != null
                  ? t('journey.report.times', '{{ratio}}×', { ratio: fmtNumber(report.detour, 2) })
                  : '—'}
              </Text>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.fixes', 'Fixes')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {fmtNumber(report.fixes, 0)}
              </Text>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.replans', 'Replans')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {t('journey.report.replanCount', '{{replans}} of {{plans}} plans', {
                  replans: fmtNumber(report.replans, 0),
                  plans: fmtNumber(report.plans, 0),
                })}
              </Text>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.usually', 'Usually')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {report.route_factor != null
                  ? t('journey.report.usuallyTimes', '{{ratio}}× over {{count}} trips', {
                      ratio: fmtNumber(report.route_factor, 2),
                      count: report.route_trips,
                    })
                  : '—'}
              </Text>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <Text as="dt" variant="caption">
                {t('journey.report.checklist', 'Ready at check')}
              </Text>
              <Text as="dd" variant="label" className="tabular-nums">
                {report.checklist != null
                  ? t('journey.report.readyCount', '{{ready}} of {{total}}', {
                      ready: fmtNumber(report.checklist.ready, 0),
                      total: fmtNumber(report.checklist.total, 0),
                    })
                  : '—'}
              </Text>
            </div>
          </dl>

          {reportEvidence.length > 0 ? (
            <ul className="space-y-1">
              {reportEvidence.map((line) => (
                <Text as="li" key={line} size="xs" color="muted">
                  · {line}
                </Text>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
