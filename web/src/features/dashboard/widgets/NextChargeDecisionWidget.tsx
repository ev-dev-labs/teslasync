import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { Badge, Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { NextChargeVerdict } from '@/types/charging';

const VERDICT_BADGE: Record<NextChargeVerdict, 'success' | 'info' | 'warning' | 'neutral'> = {
  enough: 'success',
  wait: 'info',
  charge_home_now: 'warning',
  supercharger: 'warning',
  skip_dc: 'success',
};

export default function NextChargeDecisionWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stateQuery = useVehicleState(id);
  const soc = stateQuery.data?.state?.battery_level;
  const decisionQuery = useNextChargeDecision(id, soc);
  const data = decisionQuery.data;

  const loading = stateQuery.isLoading || decisionQuery.isLoading;
  const isError = stateQuery.isError || decisionQuery.isError;

  return (
    <WidgetShell
      title={t('nextCharge.title', 'Next Charge')}
      loading={loading}
      isFetching={stateQuery.isFetching || decisionQuery.isFetching}
      isStale={stateQuery.isStale || decisionQuery.isStale}
      isError={isError}
      updatedAt={Math.max(stateQuery.dataUpdatedAt ?? 0, decisionQuery.dataUpdatedAt ?? 0)}
      onRefresh={() => {
        void stateQuery.refetch();
        void decisionQuery.refetch();
      }}
      help={{
        i18nKey: 'nextCharge.help',
        defaultValue: '12-hour verdict: charge home now, wait for off-peak, Supercharger, or skip DC-fast.',
      }}
    >
      {soc == null || !Number.isFinite(soc) ? (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('nextCharge.waitingSoc', 'Waiting for live battery level')}
          className="py-6"
        />
      ) : !data ? (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('nextCharge.noData', 'No charge decision yet')}
          className="py-6"
        />
      ) : (
        <div className="flex h-full flex-col justify-center gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={VERDICT_BADGE[data.verdict] ?? 'neutral'}>
              {t(`nextCharge.verdict.${data.verdict}`, data.verdict)}
            </Badge>
          </div>
          <Text as="p">{data.reason}</Text>
          <Caption>
            {t('nextCharge.socLine', '{{soc}}% → {{target}}% · {{kwh}} kWh needed', {
              soc: data.current_soc,
              target: data.target_soc,
              kwh: fmtNumber(data.kwh_needed, 1),
            })}
          </Caption>
          {data.home_now_cost != null ? (
            <Caption>
              {t('nextCharge.homeNow', 'Home now')} {formatCurrency(data.home_now_cost)}
            </Caption>
          ) : null}
        </div>
      )}
    </WidgetShell>
  );
}
