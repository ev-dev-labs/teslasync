import { BatteryMedium, Clock3, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorCurrentState({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const current = analysis.current;
  const sourceLabel = current.source === 'live'
    ? t('chargeAdvisor.current.sourceLive', 'Live signal')
    : current.source === 'drive_end'
      ? t('chargeAdvisor.current.sourceDrive', 'Completed drive end')
      : current.source === 'charge_end'
        ? t('chargeAdvisor.current.sourceCharge', 'Completed charge end')
        : t('chargeAdvisor.current.sourceNone', 'No valid source');
  const observed = current.observedAtMs == null
    ? '—'
    : formatDateTime(new Date(current.observedAtMs), { tz: analysis.timeZone });
  const age = current.ageMs == null
    ? '—'
    : t('chargeAdvisor.current.ageDays', '{{days}} days', {
      days: fmtInt(current.ageMs / 86_400_000),
    });
  const retrievalLabel = current.retrievalState === 'connected'
    ? t('chargeAdvisor.current.retrievalConnected', 'Connected')
    : current.retrievalState === 'disconnected'
      ? t('chargeAdvisor.current.retrievalDisconnected', 'Disconnected')
      : current.retrievalState === 'unavailable'
        ? t('chargeAdvisor.current.retrievalUnavailable', 'Unavailable')
        : t('chargeAdvisor.current.retrievalUnknown', 'Unknown');

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.current.title', 'Current-state provenance')}
      subtitle={t(
        'chargeAdvisor.current.subtitle',
        'The value, source, retrieval state, and age used by the scenarios.',
      )}
      icon={<BatteryMedium className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="both"
      dataTestId="charge-advisor-current"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="caption">{t('chargeAdvisor.current.battery', 'Battery SoC')}</Text>
          <Text className="mt-1 text-2xl font-semibold text-cyan-300">
            {current.batteryPct == null ? '—' : fmtPercent(current.batteryPct, 0)}
          </Text>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="caption">{t('chargeAdvisor.current.source', 'Source')}</Text>
          <Text className="mt-1 text-sm font-semibold">{sourceLabel}</Text>
          <Badge className="mt-2" variant={current.freshness === 'fresh' ? 'success' : 'warning'}>
            {current.freshness === 'fresh'
              ? t('chargeAdvisor.current.fresh', 'Fresh')
              : current.freshness === 'stale'
                ? t('chargeAdvisor.current.stale', 'Stale')
                : t('chargeAdvisor.current.unavailable', 'Unavailable')}
          </Badge>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="caption">{t('chargeAdvisor.current.observed', 'Observed')}</Text>
          <Text className="mt-1 text-sm font-semibold">{observed}</Text>
          <Text variant="caption">{age}</Text>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="caption">{t('chargeAdvisor.current.state', 'Vehicle state')}</Text>
          <Text className="mt-1 text-sm font-semibold">
            {current.isCharging === true
              ? t('chargeAdvisor.current.charging', 'Charging now')
              : current.isCharging === false
                ? t('chargeAdvisor.current.notCharging', 'Not charging')
                : t('chargeAdvisor.current.unknown', 'Unknown')}
          </Text>
          <Text variant="caption">
            {current.chargeLimitPct == null
              ? t('chargeAdvisor.current.noLimit', 'Charge limit —')
              : t('chargeAdvisor.current.limit', 'Charge limit {{pct}}%', {
                pct: Math.round(current.chargeLimitPct),
              })}
          </Text>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="caption">{t('chargeAdvisor.current.retrieval', 'Signal retrieval')}</Text>
          <Text className="mt-1 text-sm font-semibold">{retrievalLabel}</Text>
          <Badge className="mt-2" variant={current.connected === true ? 'success' : 'neutral'}>
              {current.connected === true
                ? t('chargeAdvisor.current.connected', 'Connected')
                : current.connected === false
                  ? t('chargeAdvisor.current.disconnected', 'Disconnected')
                  : t('chargeAdvisor.current.connectionUnknown', 'Unknown')}
          </Badge>
        </div>
      </div>
      <Text as="p" variant="caption" className="mt-4">
        <Clock3 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        {t(
          'chargeAdvisor.current.note',
          'Historical fallback values older than two days are shown as stale and cannot produce actionable guidance.',
        )}
        {current.isCharging === true && (
          <span className="ml-1">
            <PlugZap className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {t('chargeAdvisor.current.chargingNote', 'The live charging state takes precedence.')}
          </span>
        )}
      </Text>
    </ChargeAdvisorSection>
  );
}
