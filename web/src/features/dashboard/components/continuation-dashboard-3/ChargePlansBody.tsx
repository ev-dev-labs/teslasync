import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Badge, Caption, Subhead } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import type { ChargePlan } from '@/types/charging';
import { WidgetDetailCard, WidgetStatGrid, type DetailEntry, type StatGridItem } from '../../widgets/shared';
import { sourcePresentation } from './sourcePresentation';

interface ChargePlansBodyProps {
  activePlan: ChargePlan | null;
  statusVariant: 'success' | 'warning' | 'danger' | 'neutral';
  summaryStats: StatGridItem[];
  planEntries: DetailEntry[];
  rateEntries: DetailEntry[];
  compactDetails: boolean;
  hasData: boolean;
  plansState: DataState<unknown>;
  ratesState: DataState<unknown>;
}

export function ChargePlansBody({
  activePlan, statusVariant, summaryStats, planEntries, rateEntries,
  compactDetails, hasData, plansState, ratesState,
}: ChargePlansBodyProps) {
  const { t } = useTranslation('dashboard');
  return (
    <div className="h-full min-w-0 flex flex-col gap-3 overflow-y-auto">
      <SourceContent
        state={sourcePresentation(plansState, activePlan != null)}
        label={t('widget.chargePlans.title', 'Charge plans')}
        emptyMessage={t('widget.chargePlans.noPlans', 'No charge plans')}
        errorMessage={t('widget.chargePlans.plansError', 'Unable to load charge plans')}
        error={plansState.fatalError}
        errorRecovery={{ onRetry: plansState.retry ?? undefined }}
        loadingContent={<Skeleton className="h-24" />}
      >
        {activePlan && (
          <div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 mb-1">
              <Badge variant={statusVariant} size="sm" dot>{activePlan.status ?? '—'}</Badge>
              <Caption className="min-w-0 [overflow-wrap:anywhere]">{activePlan.rate_plan ?? ''}</Caption>
            </div>
            <WidgetStatGrid stats={summaryStats} />
            <WidgetDetailCard
              entries={planEntries.slice(2)}
              compact={compactDetails}
              emptyMessage={t('widget.chargePlans.noDetails', 'No plan details')}
              emptyIcon={<Clock className="h-5 w-5" />}
            />
          </div>
        )}
      </SourceContent>

      <div className="border-t border-[var(--border-subtle)] pt-2">
        <Subhead>{t('widget.chargePlans.ratePlans', 'Rate plans')}</Subhead>
        <SourceContent
          state={sourcePresentation(ratesState, rateEntries.length > 0)}
          label={t('widget.chargePlans.ratePlans', 'Rate plans')}
          emptyMessage={t('widget.chargePlans.noRates', 'No rate plans')}
          errorMessage={t('widget.chargePlans.ratesError', 'Unable to load rate plans')}
          error={ratesState.fatalError}
          errorRecovery={{ onRetry: ratesState.retry ?? undefined }}
        >
          <WidgetDetailCard
            entries={rateEntries}
            compact={compactDetails}
            emptyMessage={t('widget.chargePlans.noRates', 'No rate plans')}
            emptyIcon={<Clock className="h-5 w-5" />}
          />
        </SourceContent>
      </div>
      {!hasData && !plansState.fatalError && !ratesState.fatalError && (
        <EmptyState /* no-action: read-only plan and rate summaries retain shell refresh */
          icon={<Clock className="h-5 w-5" />}
          message={t('widget.chargePlans.noData', 'No charge plans or rate data')}
          className="py-4"
        />
      )}
    </div>
  );
}
