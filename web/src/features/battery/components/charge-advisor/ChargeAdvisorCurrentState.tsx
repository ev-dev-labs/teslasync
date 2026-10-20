import { BatteryMedium, Clock3, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Caption, MetricValue, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { isLiveFieldFresh, liveFieldAge, type VehicleLiveState } from '@/hooks/useVehicleLive';


import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ChargeAdvisorCurrentState({ analysis, state, provenance }: ChargeAdvisorComponentProps & {
  provenance: VehicleLiveState['advisorProvenance'];
}) {
  const { fmtNumber, fmtPercent } = useNumberFormatting();
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
      days: fmtNumber(current.ageMs / 86_400_000),
    });
  const retrievalLabel = current.retrievalState === 'connected'
    ? t('chargeAdvisor.current.retrievalConnected', 'Connected')
    : current.retrievalState === 'disconnected'
      ? t('chargeAdvisor.current.retrievalDisconnected', 'Disconnected')
      : current.retrievalState === 'unavailable'
        ? t('chargeAdvisor.current.retrievalUnavailable', 'Unavailable')
        : t('chargeAdvisor.current.retrievalUnknown', 'Unknown');
  const fieldEvidence = (field: keyof typeof provenance) => {
    const observation = provenance[field];
    const fieldAge = liveFieldAge(observation, analysis.currentStateNowMs);
    return (
      <Caption as="p" className="mt-2" data-testid={`charge-advisor-source-${field}`}>
        {t('chargeAdvisor.current.source', 'Source')}: {observation?.source ?? t('chargeAdvisor.current.unknown', 'Unknown')}
        {' · '}{t('chargeAdvisor.current.observed', 'Observed')}: {observation?.observedAtMs == null
          ? '—' : formatDateTime(new Date(observation.observedAtMs), { tz: analysis.timeZone })}
        {' · '}{fieldAge == null ? t('chargeAdvisor.current.unknown', 'Unknown')
          : t('chargeAdvisor.current.ageDays', '{{days}} days', { days: fmtNumber(fieldAge / 86_400_000) })}
        {' · '}{isLiveFieldFresh(observation, analysis.currentStateNowMs)
          ? t('chargeAdvisor.current.fresh', 'Fresh')
          : fieldAge == null || observation?.source === 'l2' || observation?.source === 'unknown'
            ? t('chargeAdvisor.current.unknown', 'Unknown')
            : t('chargeAdvisor.current.stale', 'Stale')}
      </Caption>
    );
  };

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.current.title', 'Current-state provenance')}
      subtitle={t(
        'chargeAdvisor.current.subtitle',
        'The value, source, retrieval state, and age used by the scenarios.',
      )}
      icon={<BatteryMedium className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />}
      state={state}
      dependency={current.source === 'drive_end' ? 'drive' : current.source === 'charge_end' ? 'charging' : 'live'}
      dataTestId="charge-advisor-current"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Caption>{t('chargeAdvisor.current.battery', 'Battery SoC')}</Caption>
          <MetricValue className="mt-1">
            {current.batteryPct == null ? '—' : fmtPercent(current.batteryPct)}
          </MetricValue>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Caption>{t('chargeAdvisor.current.source', 'Source')}</Caption>
          <Text as="p" variant="bodySm" className="mt-1">{sourceLabel}</Text>
          <Badge className="mt-2" variant={current.freshness === 'fresh' ? 'success' : 'warning'}>
            {current.freshness === 'fresh'
              ? t('chargeAdvisor.current.fresh', 'Fresh')
              : current.freshness === 'stale'
                ? t('chargeAdvisor.current.stale', 'Stale')
                : t('chargeAdvisor.current.unavailable', 'Unavailable')}
          </Badge>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Caption>{t('chargeAdvisor.current.observed', 'Observed')}</Caption>
          <Text as="p" variant="bodySm" className="mt-1">{observed}</Text>
          <Caption>{age}</Caption>
          {current.source === 'live' && fieldEvidence('batteryLevel')}
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Caption>{t('chargeAdvisor.current.state', 'Vehicle state')}</Caption>
          <Text as="p" variant="bodySm" className="mt-1">
            {current.isCharging === true
              ? t('chargeAdvisor.current.charging', 'Charging now')
              : current.isCharging === false
                ? t('chargeAdvisor.current.notCharging', 'Not charging')
                : t('chargeAdvisor.current.unknown', 'Unknown')}
          </Text>
          {fieldEvidence('isCharging')}
          <Caption>
            {current.chargeLimitPct == null
              ? t('chargeAdvisor.current.noLimit', 'Charge limit —')
              : t('chargeAdvisor.current.limit', 'Charge limit {{pct}}%', {
                pct: fmtNumber(current.chargeLimitPct),
              })}
          </Caption>
          {fieldEvidence('chargeLimitSoc')}
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Caption>{t('chargeAdvisor.current.retrieval', 'Signal retrieval')}</Caption>
          <Text as="p" variant="bodySm" className="mt-1">{retrievalLabel}</Text>
          <Badge className="mt-2" variant={current.connected === true ? 'success' : 'neutral'}>
              {current.connected === true
                ? t('chargeAdvisor.current.connected', 'Connected')
                : current.connected === false
                  ? t('chargeAdvisor.current.disconnected', 'Disconnected')
                  : t('chargeAdvisor.current.connectionUnknown', 'Unknown')}
          </Badge>
        </div>
      </div>
      <Caption as="p" className="mt-4">
        <Clock3 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        {t('chargeAdvisor.current.sourceLive', 'Live signal')}
        {' · '}{t('chargeAdvisor.current.fresh', 'Fresh')} ≤ {fmtNumber(2)} {t('common.min', 'min')}.{' '}
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
      </Caption>
    </ChargeAdvisorSection>
  );
}
