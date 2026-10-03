import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PauseCircle } from 'lucide-react';

import { Badge, DataTable, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useSilentCounter } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function SilentCounterPanel({ driveId }: { driveId: string | undefined }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useSilentCounter(driveId);
  const state = useDataState(query, { provenance: 'historical' });
  const report = state.data;
  const intervals = report?.intervals ?? [];

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="silent-counter">
      <PanelTitle className="flex items-center gap-2">
        <PauseCircle className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('driveDetail.silent.title', 'Counter silent while moving')}
      </PanelTitle>
      <StaleRefreshWarning state={state} label={t('driveDetail.silent.title', 'Counter silent while moving')} />
      {state.status === 'initial' ? (
        <Skeleton className="h-24" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : report ? (
        <>
          <Text as="p" variant="caption">{report.honesty}</Text>
          {report.unknown ? (
            <Text as="p" variant="caption">
              {t('driveDetail.silent.unknown', 'The FSD trip meter did not report on this drive. Absence is not a disengagement.')}
            </Text>
          ) : intervals.length === 0 ? (
            <Text as="p" variant="caption">
              {t('driveDetail.silent.none', 'No moving interval had a frozen FSD trip meter.')}
            </Text>
          ) : (
            <DataTable
              tableId="drive-detail:silent-intervals" name="drive-silent-intervals"
              data={intervals.map((interval, index) => ({ ...interval, index }))}
              keyExtractor={(interval) => `${interval.started_at}-${interval.index}`}
              columns={[
                { key: 'label', header: t('driveDetail.report.evidence', 'Evidence'), render: (interval) => <Badge variant="warning" size="sm">{interval.label}</Badge>, visibleOnMobile: true },
                { key: 'start', header: t('driveDetail.start', 'Start'), render: (interval) => formatDateTime(interval.started_at), visibleOnMobile: true },
                { key: 'end', header: t('driveDetail.end', 'End'), render: (interval) => formatDateTime(interval.ended_at), visibleOnMobile: true },
                { key: 'duration', header: t('driveDetail.duration', 'Duration'), render: (interval) => `${fmtNumber(interval.duration_s / 60)} ${t('driveDetail.minutesShort', 'min')}`, visibleOnMobile: true },
              ]}
              pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
            />
          )}
          <Link to="/fsd" className="text-sm text-[var(--theme-primary)] underline-offset-2 hover:underline">
            {t('driveDetail.silent.fsd', 'Open FSD insights')}
          </Link>
        </>
      ) : <EmptyState message={t('driveDetail.silent.unknown', 'The FSD trip meter did not report on this drive. Absence is not a disengagement.')}
        actionTo={{ label: t('driveDetail.silent.fsd', 'Open FSD insights'), to: '/fsd' }} />}
    </GlassPanel>
  );
}
