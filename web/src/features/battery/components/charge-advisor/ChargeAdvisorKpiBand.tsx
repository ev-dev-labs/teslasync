import {
  Activity,
  BatteryMedium,
  Database,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, QueryError } from '@/components/feedback';
import { type StatMetric } from '@/components/data-display';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { LayoutCard } from '@/components/layout';
import { Badge, Button, Text } from '@/components/ui';


import type { ChargeAdvisorComponentProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ChargeAdvisorKpiBand({ analysis, state }: ChargeAdvisorComponentProps) {
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const guidanceLabel: Record<string, string> = {
    current_state_unavailable: t(
      'chargeAdvisor.guidance.currentStateUnavailable',
      'Current state unavailable',
    ),
    stale: t('chargeAdvisor.guidance.stale', 'Current state is stale'),
    already_charging: t('chargeAdvisor.guidance.alreadyCharging', 'Already charging'),
    insufficient_history: t(
      'chargeAdvisor.guidance.insufficientHistory',
      'More history needed',
    ),
    charge_before_next_use: t(
      'chargeAdvisor.guidance.chargeBeforeNextUse',
      'Charge before next use',
    ),
    monitor: t('chargeAdvisor.guidance.monitor', 'Monitor the threshold'),
    no_immediate_need: t(
      'chargeAdvisor.guidance.noImmediateNeed',
      'No immediate need',
    ),
  };
  const currentSubtitle = analysis.current.freshness === 'fresh'
    ? t('chargeAdvisor.kpis.currentFresh', 'Fresh observed state')
    : analysis.current.freshness === 'stale'
      ? t('chargeAdvisor.kpis.currentStale', 'Displayed as stale; guidance is blocked')
      : t('chargeAdvisor.kpis.currentMissing', 'No valid observed state');
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'advisor-guidance',
      label: t('chargeAdvisor.kpis.guidance', 'Guidance'),
      rawValue: state.vehicleSelected ? guidanceLabel[analysis.guidance] : null,
      context: <><PlugZap className="h-5 w-5" aria-hidden="true" /><Badge variant={analysis.guidance === 'charge_before_next_use' ? 'warning' : 'neutral'}>
        {analysis.evidenceGatePassed
          ? t('chargeAdvisor.kpis.gated', 'Evidence gate passed')
          : t('chargeAdvisor.kpis.notGated', 'Descriptive evidence gate not met')}
      </Badge></>,
    },
    {
      metricId: 'percent', occurrenceId: 'advisor-current-soc',
      label: t('chargeAdvisor.kpis.current', 'Current SoC'),
      rawValue: state.vehicleSelected ? analysis.current.batteryPct : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: <><BatteryMedium className="h-5 w-5" aria-hidden="true" />{currentSubtitle}</>,
    },
    {
      metricId: 'count', occurrenceId: 'advisor-drive-evidence',
      label: t('chargeAdvisor.kpis.history', 'Drive evidence'),
      rawValue: state.driveAvailable ? analysis.evidence.includedRows : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: <><Database className="h-5 w-5" aria-hidden="true" />{t('chargeAdvisor.kpis.historyDetail', '{{days}} active local days · {{weeks}} active weeks', {
        days: analysis.evidence.activeLocalDays, weeks: analysis.evidence.activeWeeks,
      })}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'advisor-daily-drop',
      label: t('chargeAdvisor.kpis.typicalUse', 'Daily SoC drop'),
      rawValue: analysis.burnDistribution.medianPct,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: <><Activity className="h-5 w-5" aria-hidden="true" />{t('chargeAdvisor.kpis.dailyUseDetail', 'Median across active local days')}</>,
    },
    {
      metricId: 'count', occurrenceId: 'advisor-charging-evidence',
      label: t('chargeAdvisor.kpis.charging', 'Charging evidence'),
      rawValue: state.chargingAvailable ? analysis.chargingProfile.sessions : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: <><ShieldCheck className="h-5 w-5" aria-hidden="true" />{state.chargingAvailable
        ? t('chargeAdvisor.kpis.chargingDetail', 'Completed sessions in window')
        : t('chargeAdvisor.kpis.chargingMissing', 'Charging history unavailable')}</>,
    },
  ];

  return (
    <section data-testid="charge-advisor-kpis" aria-label={t(
      'chargeAdvisor.kpis.aria',
      'Charge advisor guidance and evidence summary',
    )}>
      <LayoutCard title={t('chargeAdvisor.kpis.title', 'Observed charge planning evidence')}>
        <BatteryEvidenceBrief title={t('chargeAdvisor.kpis.title', 'Observed charge planning evidence')} metrics={metrics} loading={state.isLoading} retained={Boolean(state.refreshError)}
          period={{ kind: 'unknown', label: t('chargeAdvisor.kpis.title', 'Observed charge planning evidence'),
            reason: t('chargeAdvisor.summaryScope', 'History evidence uses the returned drive and charging windows; current SoC is a separate observed snapshot.') }} />

        {!state.vehicleSelected ? (
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'chargeAdvisor.states.selectVehicleBand',
              'Choose a vehicle above to load drive and charging evidence.',
            )}
          </Text>
        ) : state.initialError ? (
          <div className="mt-4" data-testid="charge-advisor-initial-error">
            <QueryError error={state.initialError} onRetry={state.onRetry} />
          </div>
        ) : state.refreshError ? (
          <AlertBanner
            className="mt-4"
            variant="warning"
            role="alert"
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Text as="p" variant="caption">
                {t(
                  'chargeAdvisor.states.refreshError',
                  'A history refresh failed. Showing the most recently loaded evidence.',
                )}
              </Text>
              <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
                {t('chargeAdvisor.states.retry', 'Retry')}
              </Button>
            </div>
          </AlertBanner>
        ) : null}

        {state.vehicleSelected && analysis.evidence.historyCapReached ? (
          <AlertBanner className="mt-4" variant="warning">
            <Text as="p" variant="caption">
              {t(
                'chargeAdvisor.states.driveCap',
                'Exactly {{limit}} drive rows were returned; this is the latest observed window, not a lifetime claim.',
                { limit: analysis.evidence.historyLimit },
              )}
            </Text>
          </AlertBanner>
        ) : null}
        {state.vehicleSelected && state.chargingAvailable && analysis.chargingEvidence.historyCapReached ? (
          <AlertBanner className="mt-4" variant="warning">
            <Text as="p" variant="caption">
              {t(
                'chargeAdvisor.states.chargingCap',
                'Exactly {{limit}} charging rows were returned; this is the latest observed window, not a lifetime claim.',
                { limit: analysis.chargingEvidence.historyLimit },
              )}
            </Text>
          </AlertBanner>
        ) : null}
      </LayoutCard>
    </section>
  );
}
