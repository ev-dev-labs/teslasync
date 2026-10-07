import { useTranslation } from 'react-i18next';
import { useReport, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { TripOperationalBrief } from './operationalbrief-all/TripOperationalBrief';
import { Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { ListSkeleton } from '@/components/feedback';
import { JourneyEvidenceList } from './continuation-mobility-trips-watch/JourneyEvidenceList';

import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Trip report card: distance, duration, detour factor, plan/replan
 * counts, and the checklist recap. Read-only — the numbers refresh on
 * transitions, check-ins, and replans.
 */
export function ReportPanel({ session }: { session: JourneySession }) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const units = useUnits();

  const reportQuery = useReport(session.id);
  const reportState = useDataState(reportQuery);
  const report = reportQuery.data ?? null;
  const reportEvidence = safeArray(report?.evidence);
  const scope = t('trips.brief.report.scope', 'Journey #{{id}} · {{start}} – {{end}}', {
    id: session.id, start: report?.started_at ?? session.started_at ?? session.created_at,
    end: report?.ended_at ?? session.ended_at ?? t('trips.detail.inProgress', 'In progress'),
  });
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'distance', rawValue: report?.distance_m,
      label: t('journey.report.distance', 'Distance'), description: scope,
      display: { formatter: raw => ({ value: units.formatDistance(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: report?.duration_s,
      label: t('journey.report.duration', 'Trip time'), description: scope,
      display: { formatter: raw => ({ value: units.formatDuration(raw), unit: '' }) } },
    { metricId: 'multiplier', occurrenceId: 'detour', rawValue: report?.detour,
      label: t('journey.report.detour', 'Detour'), description: scope,
      display: { formatter: raw => ({ value: t('journey.report.times', '{{ratio}}×', { ratio: fmtNumber(raw) }), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'fixes', rawValue: report?.fixes,
      label: t('journey.report.fixes', 'Fixes'), description: scope,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'replans', rawValue: report?.replans,
      label: t('journey.report.replans', 'Replans'), description: scope,
      display: { countTotal: report?.plans, formatter: raw => ({ value: t('journey.report.replanCount', '{{replans}} of {{plans}} plans', {
        replans: fmtInt(raw), plans: fmtInt(report?.plans ?? 0),
      }), unit: '' }) } },
    { metricId: 'multiplier', occurrenceId: 'usual', rawValue: report?.route_factor,
      label: t('journey.report.usually', 'Usually'), description: scope,
      display: { formatter: raw => ({ value: t('journey.report.usuallyTimes', '{{ratio}}× over {{count}} trips', {
        ratio: fmtNumber(raw), count: report?.route_trips,
      }), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'checklist', rawValue: report?.checklist?.ready,
      label: t('journey.report.checklist', 'Ready at check'), description: scope,
      display: { countTotal: report?.checklist?.total, formatter: raw => ({ value: t('journey.report.readyCount', '{{ready}} of {{total}}', {
        ready: fmtInt(raw), total: fmtInt(report?.checklist?.total ?? 0),
      }), unit: '' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

  return (
    <LayoutCard title={t('journey.report.title', 'Trip report')}>
      <TripOperationalBrief source={reportState} loading={reportQuery.isLoading && !reportState.hasData}
        metrics={operationalMetrics} scope={scope}
        eyebrow={t('trips.brief.report.eyebrow', 'Journey debrief')}
        title={t('trips.brief.report.title', 'Journey report summary')}
        description={t('trips.brief.report.description', 'Recorded journey measurements, plan counts, route-history context and readiness recap.')}
        provenance={t('trips.brief.report.provenance', 'Journey report refreshed by transitions, check-ins and replans; route-history trips have a separate denominator.')} />
      <SourceContent
        state={reportState.fatalError ? 'error' : reportQuery.isLoading && !reportState.hasData
          ? 'loading' : reportState.status === 'stale' ? 'retained' : report == null ? 'empty' : 'ready'}
        label={t('journey.report.title', 'Trip report')}
        emptyMessage={t('journey.report.empty', 'No report yet.')}
        errorMessage={t('journey.report.loadFailed', 'The trip report could not be loaded.')}
        error={reportState.fatalError}
        errorRecovery={{ onRetry: reportState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.report.loading', 'Loading trip report…')} />}
      >
      {report != null ? (
        <div className="space-y-3">
          <JourneyEvidenceList evidence={reportEvidence} />
        </div>
      ) : (
        <Text as="p" variant="bodySm">{t('journey.report.empty', 'No report yet.')}</Text>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
