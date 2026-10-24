import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { NextChargeVerdict } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';

function verdictLabel(v: NextChargeVerdict, t: (key: string, fallback: string) => string): string {
  switch (v) {
    case 'enough':
      return t('nextCharge.verdict.enough', 'Enough energy');
    case 'wait':
      return t('nextCharge.verdict.wait', 'Wait for off-peak');
    case 'charge_home_now':
      return t('nextCharge.verdict.charge_home_now', 'Charge home now');
    case 'supercharger':
      return t('nextCharge.verdict.supercharger', 'Use Supercharger');
    case 'skip_dc':
      return t('nextCharge.verdict.skip_dc', 'Skip DC-fast');
    default:
      return v;
  }
}

export default function NextChargeDecisionWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { formatTime } = useDateFormat();
  const { formatEnergy } = useUnits();
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
        (() => {
          const currentSoc = knownNumber(data.current_soc);
          const targetSoc = knownNumber(data.target_soc);
          const kwhNeeded = knownNumber(data.kwh_needed);
          const unknown = t('common.unknown', 'Unknown');
          const homeWaitStartValid = Boolean(data.home_wait_start)
            && Number.isFinite(Date.parse(data.home_wait_start ?? ''));
          const waitAt = homeWaitStartValid && data.home_wait_start
            ? formatTime(data.home_wait_start)
            : unknown;
          const numberOperand = (value: number | null) =>
            value == null ? unknown : fmtNumber(value);
          const currencyOperand = (value: number | null | undefined) =>
            knownNumber(value) == null ? unknown : formatCurrency(Number(value));
          const sourceReason = data.reason?.trim() || verdictLabel(data.verdict, t);
          const reason = t(`nextCharge.reason.${data.reason_key}`, sourceReason, {
            site: data.supercharger_site?.trim() || unknown,
            save: currencyOperand(data.home_savings),
            time: waitAt,
            home: currencyOperand(data.home_now_cost),
            sc: currencyOperand(data.supercharger_cost),
            soc: numberOperand(currentSoc),
            target: numberOperand(targetSoc),
          });
          return (
        <div className="flex h-full min-w-0 flex-col justify-center gap-2">
          <Text as="p" variant="body" className="font-semibold text-[var(--text-primary)]">
            {verdictLabel(data.verdict, t)}
          </Text>
          <Text as="p" variant="bodySm" className="text-[var(--text-secondary)]">{reason}</Text>
          <Caption>
            {t('nextCharge.socLine', '{{soc}}% → {{target}}% · {{kwh}} needed', {
              soc: currentSoc == null ? '—' : fmtNumber(currentSoc),
              target: targetSoc == null ? '—' : fmtNumber(targetSoc),
              kwh: kwhNeeded == null ? '—' : formatEnergy(kwhNeeded * 1000),
            })}
          </Caption>
        </div>
          );
        })()
      )}
    </WidgetShell>
  );
}
