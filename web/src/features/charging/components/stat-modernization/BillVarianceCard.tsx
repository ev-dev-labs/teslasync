import { useTranslation } from 'react-i18next';
import { ReceiptText } from 'lucide-react';
import { Text, Badge } from '@/components/ui';
import { StatGroup } from '@/components/data-display/stat-reference';
import { useBillVariance } from '@/api/hooks/useCharging';
import { CostStatSection } from './CostStatSection';
import { useIndependentStatPeriod } from './useSourceStatPeriod';
import { useStatFormatting } from './useStatFormatting';
import { energyDisplay } from './displayBoundary';

interface BillVarianceCardProps {
  vehicleId?: number | null;
}

function verdictVariant(verdict: string): 'success' | 'warning' | 'neutral' {
  switch (verdict) {
    case 'reconciled': return 'success';
    case 'review': return 'warning';
    default: return 'neutral';
  }
}

/** Same independent reconciliation query, verdict, operands, session counts and explanation. */
export function BillVarianceCard({ vehicleId }: BillVarianceCardProps) {
  const { t } = useTranslation();
  const { text, preferences } = useStatFormatting();
  const period = useIndependentStatPeriod('billing');
  const { data, isLoading, error, refetch } = useBillVariance(vehicleId ?? undefined);

  return (
    <CostStatSection title={t('costAnalysis.billVariance.title', 'Bill Truth: Measured vs Invoiced')}
      icon={<ReceiptText className="h-4 w-4 text-cyan-300" aria-hidden="true" />} glow="cyan"
      isLoading={isLoading} error={error} onRetry={() => refetch()} retained={data != null}
      isEmpty={!data} period={period}
      emptyMessage={t('costAnalysis.billVariance.noData', 'No reconciliation data yet')} skeletonHeight={160}>
      {periodHeaderId => (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictVariant(data?.verdict ?? '')} size="sm">
              {data?.verdict === 'reconciled'
                ? t('costAnalysis.billVariance.reconciled', 'Reconciled')
                : data?.verdict === 'review'
                  ? t('costAnalysis.billVariance.review', 'Needs review')
                  : t('costAnalysis.billVariance.missing', 'Missing invoices')}
            </Badge>
            <Text as="p" variant="caption" className="tabular-nums">
              {t('costAnalysis.billVariance.sessions', '{{measured}} measured · {{invoiced}} invoiced DC sessions', {
                measured: text('count', data?.measured_sessions),
                invoiced: text('count', data?.invoiced_sessions),
              })}
            </Text>
          </div>
          <StatGroup period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
            metrics={[
              { metricId: 'energy', rawValue: data?.energy_delta_wh, display: energyDisplay,
                label: t('costAnalysis.billVariance.energyDelta', 'Energy Δ'),
                context: `(${text('percent', data?.energy_delta_pct)})` },
              { metricId: 'currency', rawValue: data?.cost_delta,
                label: t('costAnalysis.billVariance.costDelta', 'Cost Δ'),
                context: `(${text('percent', data?.cost_delta_pct)})` },
              { metricId: 'percent', rawValue: data?.cabinet_loss_pct,
                label: t('costAnalysis.billVariance.cabinetLoss', 'Cabinet loss') },
              { metricId: 'currency', rawValue: data?.invoiced_cost,
                label: t('costAnalysis.billVariance.invoiced', 'Invoiced total') },
            ]} />
          <Text as="p" variant="bodySm">{data?.explanation}</Text>
        </div>
      )}
    </CostStatSection>
  );
}
