import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PauseCircle } from 'lucide-react';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { useSilentCounter } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';

export function SilentCounterPanel({ driveId }: { driveId: string | undefined }) {
  const { t } = useTranslation();
  const query = useSilentCounter(driveId);
  const state = useDataState(query, { provenance: 'historical' });
  const report = state.data;

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="silent-counter">
      <PanelTitle className="flex items-center gap-2">
        <PauseCircle className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('driveDetail.silent.title', 'Counter silent while moving')}
      </PanelTitle>
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
          ) : report.intervals.length === 0 ? (
            <Text as="p" variant="caption">
              {t('driveDetail.silent.none', 'No moving interval had a frozen FSD trip meter.')}
            </Text>
          ) : (
            <ul className="space-y-2">
              {report.intervals.map((interval) => (
                <li key={interval.started_at} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="warning" size="sm">{interval.label}</Badge>
                  <span>{formatDateTime(interval.started_at)} → {formatDateTime(interval.ended_at)}</span>
                  <span className="text-[var(--text-muted)]">{fmtNumber(interval.duration_s / 60, 1)} min</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/fsd" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
            {t('driveDetail.silent.fsd', 'Open FSD Insights')}
          </Link>
        </>
      ) : null}
    </GlassPanel>
  );
}
