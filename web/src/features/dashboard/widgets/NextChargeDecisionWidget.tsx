import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { Badge, Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';

import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { NextChargeVerdict } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetDetailCard } from './shared';

const VERDICT_BADGE: Record<NextChargeVerdict, 'success' | 'info' | 'warning' | 'neutral'> = {
  enough: 'success',
  wait: 'info',
  charge_home_now: 'warning',
  supercharger: 'warning',
  skip_dc: 'success',
};

export default function NextChargeDecisionWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const id = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? Number(candidate) : 0;
  const stateQuery = useVehicleState(id);
  const soc = knownNumber(stateQuery.data?.state?.battery_level);
  const decisionQuery = useNextChargeDecision(id || undefined, soc ?? undefined);
  const data = decisionQuery.data;

  const isError = stateQuery.isError || decisionQuery.isError;
  const discoveryState = useDataState(vehiclesQuery);
  const liveState = useDataState({
    ...stateQuery,
    data: stateQuery.data ?? (!id || (!stateQuery.isLoading && !stateQuery.isPending && !stateQuery.isError) ? null : undefined),
  }, { provenance: 'live', unavailable: soc == null });
  const decisionState = useDataState({
    ...decisionQuery,
    data: data ?? (!id || soc == null || (!decisionQuery.isLoading && !decisionQuery.isPending && !decisionQuery.isError) ? null : undefined),
  }, { provenance: 'inferred', unavailable: !data });
  const sources = !id && vehicleId == null && discoveryState.status !== 'ok'
    ? [discoveryState] : [liveState, decisionState];
  const combined = combineDataStates(sources);
  const failure = sources.find((source) => source.fatalError)?.fatalError ?? null;
  const handleRefresh = () => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id) void stateQuery.refetch();
    if (id && soc != null) void decisionQuery.refetch();
  };
  const dataState = {
    ...combined, data, hasData: data != null,
    status: !data && failure ? 'initialFailure' as const
      : !data && sources.some((source) => source.status === 'initial') ? 'initial' as const : combined.status,
    fatalError: !data ? failure : null,
    refreshError: data ? combined.refreshError ?? failure : null,
    retry: handleRefresh,
  };

  return (
    <WidgetShell
      title={t('nextCharge.title', 'Next charge')}
      dataState={dataState}
      isFetching={stateQuery.isFetching || decisionQuery.isFetching}
      isStale={stateQuery.isStale || decisionQuery.isStale}
      isError={isError}
      updatedAt={dataState.updatedAt ?? 0}
      onRefresh={handleRefresh}
      help={{
        i18nKey: 'nextCharge.help',
        defaultValue: '12-hour verdict: charge home now, wait for off-peak, Supercharger, or skip DC-fast.',
      }}
    >
      {!data && (soc == null || !Number.isFinite(soc)) ? (
        <EmptyState /* no-action: informational empty — no CTA */
          icon={<Zap className="h-5 w-5" />}
          message={t('nextCharge.waitingSoc', 'Waiting for live battery level')}
          className="py-6"
        />
      ) : !data ? (
        <EmptyState /* no-action: informational empty — no CTA */
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
              soc: knownNumber(data.current_soc) == null ? '—' : fmtNumber(data.current_soc),
              target: knownNumber(data.target_soc) == null ? '—' : fmtNumber(data.target_soc),
              kwh: knownNumber(data.kwh_needed) == null ? '—' : fmtNumber(data.kwh_needed),
            })}
          </Caption>
          {data.home_now_cost != null ? (
            <WidgetDetailCard entries={[{
              label: t('nextCharge.homeNow', 'Home now'),
              value: knownNumber(data.home_now_cost) == null ? '—' : formatCurrency(data.home_now_cost),
            }]} />
          ) : null}
        </div>
      )}
    </WidgetShell>
  );
}
