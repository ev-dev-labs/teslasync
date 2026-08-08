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
import { MetricCard } from '@/components/data-display';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorKpiBand({ analysis, state }: ChargeAdvisorComponentProps) {
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
  const currentValue = analysis.current.batteryPct == null
    ? '—'
    : fmtPercent(analysis.current.batteryPct, 0);
  const currentSubtitle = analysis.current.freshness === 'fresh'
    ? t('chargeAdvisor.kpis.currentFresh', 'Fresh observed state')
    : analysis.current.freshness === 'stale'
      ? t('chargeAdvisor.kpis.currentStale', 'Displayed as stale; guidance is blocked')
      : t('chargeAdvisor.kpis.currentMissing', 'No valid observed state');

  return (
    <section data-testid="charge-advisor-kpis" aria-label={t(
      'chargeAdvisor.kpis.aria',
      'Charge advisor guidance and evidence summary',
    )}>
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('chargeAdvisor.kpis.title', 'Observed charge planning evidence')}
        </PanelTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label={t('chargeAdvisor.kpis.guidance', 'Guidance')}
            value={state.vehicleSelected ? guidanceLabel[analysis.guidance] : '—'}
            subtitle={analysis.evidenceGatePassed
              ? t('chargeAdvisor.kpis.gated', 'Evidence gate passed')
              : t('chargeAdvisor.kpis.notGated', 'Descriptive evidence gate not met')}
            icon={<PlugZap className="h-5 w-5" />}
            color={analysis.guidance === 'charge_before_next_use' ? 'amber' : 'cyan'}
          />
          <MetricCard
            label={t('chargeAdvisor.kpis.current', 'Current SoC')}
            value={state.vehicleSelected ? currentValue : '—'}
            subtitle={currentSubtitle}
            icon={<BatteryMedium className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('chargeAdvisor.kpis.history', 'Drive evidence')}
            value={state.vehicleSelected ? fmtInt(analysis.evidence.includedRows) : '—'}
            subtitle={t(
              'chargeAdvisor.kpis.historyDetail',
              '{{days}} active local days · {{weeks}} active weeks',
              {
                days: analysis.evidence.activeLocalDays,
                weeks: analysis.evidence.activeWeeks,
              },
            )}
            icon={<Database className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('chargeAdvisor.kpis.typicalUse', 'Daily SoC drop')}
            value={analysis.burnDistribution.medianPct == null
              ? '—'
              : fmtPercent(analysis.burnDistribution.medianPct, 1)}
            subtitle={t(
              'chargeAdvisor.kpis.dailyUseDetail',
              'Median across active local days',
            )}
            icon={<Activity className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('chargeAdvisor.kpis.charging', 'Charging evidence')}
            value={state.chargingAvailable ? fmtInt(analysis.chargingProfile.sessions) : '—'}
            subtitle={state.chargingAvailable
              ? t('chargeAdvisor.kpis.chargingDetail', 'Completed sessions in window')
              : t('chargeAdvisor.kpis.chargingMissing', 'Charging history unavailable')}
            icon={<ShieldCheck className="h-5 w-5" />}
            color="green"
          />
        </div>

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
      </GlassPanel>
    </section>
  );
}
