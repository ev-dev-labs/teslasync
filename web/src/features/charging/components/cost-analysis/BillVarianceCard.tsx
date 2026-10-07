import { useTranslation } from 'react-i18next';
import { ReceiptText } from 'lucide-react';
import { Text, Badge } from '@/components/ui';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { useBillVariance } from '@/api/hooks/useCharging';
import { CostSection } from './CostSection';

interface BillVarianceCardProps {
  vehicleId?: number | null;
}

function VarianceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-2)] p-3">
      <Text as="p" variant="caption" className="truncate">{label}</Text>
      <Text as="p" size="sm" weight="semibold" color="primary" className="mt-0.5 tabular-nums">
        {value}
      </Text>
    </div>
  );
}

function verdictVariant(verdict: string): 'success' | 'warning' | 'neutral' {
  switch (verdict) {
    case 'reconciled':
      return 'success';
    case 'review':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Bill truth at fleet scale: reconciles pack-side measured DC totals
 * against Tesla cabinet-side invoices. Built on the CostSection idiom
 * so it reads as part of Cost Analysis, not a bolt-on.
 */
export function BillVarianceCard({ vehicleId }: BillVarianceCardProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { data, isLoading, error, refetch } = useBillVariance(vehicleId ?? undefined);

  return (
    <CostSection
      title={t('costAnalysis.billVariance.title', 'Bill Truth: Measured vs Invoiced')}
      icon={<ReceiptText className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      glow="cyan"
      isLoading={isLoading}
      error={error}
      onRetry={() => refetch()}
      isEmpty={!data}
      emptyMessage={t('costAnalysis.billVariance.noData', 'No reconciliation data yet')}
      skeletonHeight={160}
    >
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictVariant(data.verdict)} size="sm">
              {data.verdict === 'reconciled'
                ? t('costAnalysis.billVariance.reconciled', 'Reconciled')
                : data.verdict === 'review'
                  ? t('costAnalysis.billVariance.review', 'Needs review')
                  : t('costAnalysis.billVariance.missing', 'Missing invoices')}
            </Badge>
            <Text as="p" variant="caption" className="tabular-nums">
              {t('costAnalysis.billVariance.sessions', '{{measured}} measured · {{invoiced}} invoiced DC sessions', {
                measured: data.measured_sessions,
                invoiced: data.invoiced_sessions,
              })}
            </Text>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <VarianceMetric
              label={t('costAnalysis.billVariance.energyDelta', 'Energy Δ')}
              value={`${fmtNumber(data.energy_delta_wh / 1000, 1)} kWh (${fmtPercent(data.energy_delta_pct, 1)})`}
            />
            <VarianceMetric
              label={t('costAnalysis.billVariance.costDelta', 'Cost Δ')}
              value={`${formatCurrency(data.cost_delta)} (${fmtPercent(data.cost_delta_pct, 1)})`}
            />
            <VarianceMetric
              label={t('costAnalysis.billVariance.cabinetLoss', 'Cabinet loss')}
              value={fmtPercent(data.cabinet_loss_pct, 1)}
            />
            <VarianceMetric
              label={t('costAnalysis.billVariance.invoiced', 'Invoiced total')}
              value={formatCurrency(data.invoiced_cost)}
            />
          </div>
          <Text as="p" variant="bodySm">{data.explanation}</Text>
        </div>
      )}
    </CostSection>
  );
}
