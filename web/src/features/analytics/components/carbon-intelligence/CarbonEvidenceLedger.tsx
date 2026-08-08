import {
  Activity,
  CalendarRange,
  Factory,
  Fuel,
  Gauge,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonEvidenceLedger({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const period = analysis.period;
  const resolved = states.period.hasData;
  const netLabel = period.netDisposition === 'excess'
    ? t('carbon.evidence.netExcess', 'Excess vs gas baseline')
    : period.netDisposition === 'unknown'
      ? t('carbon.evidence.netUnavailable', 'Baseline comparison unavailable')
      : period.netDisposition === 'balanced'
        ? t('carbon.evidence.netBalanced', 'At gas baseline')
        : t('carbon.evidence.netAvoided', 'Net avoided vs gas baseline');

  return (
    <section
      data-testid="carbon-evidence-ledger"
      aria-label={t(
        'carbon.evidence.aria',
        'Selected-period carbon KPI and evidence ledger',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <CalendarRange
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.evidence.title', 'Selected-period evidence ledger')}
        </PanelTitle>
        <CarbonSectionBody state={states.period}>
          <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
            <MetricCard
              label={t('carbon.evidence.energy', 'Charging energy')}
              value={resolved ? display.formatEnergy(period.totalEnergyWh) : '—'}
              subtitle={t(
                'carbon.evidence.energyHint',
                'Normalized once from the legacy API wire value',
              )}
              icon={<Zap className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('carbon.evidence.co2', 'Attributed charging CO₂')}
              value={resolved ? display.formatKg(period.totalCo2Kg) : '—'}
              subtitle={t(
                'carbon.evidence.co2Hint',
                'Energy attributed by backend model clock-hour',
              )}
              icon={<Factory className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('carbon.evidence.sessions', 'Sessions scored')}
              value={resolved
                ? display.formatNumber(period.sessionsScored, 0)
                : '—'}
              subtitle={t(
                'carbon.evidence.sessionsHint',
                'Positive-energy charging sessions',
              )}
              icon={<Activity className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('carbon.evidence.average', 'Energy-weighted intensity')}
              value={resolved
                ? display.formatIntensity(
                  period.energyWeightedIntensityGPerKwh,
                )
                : '—'}
              subtitle={t(
                'carbon.evidence.averageHint',
                'Derived from returned CO₂ and energy',
              )}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('carbon.evidence.gas', 'Gas-car baseline')}
              value={resolved
                ? display.formatKg(period.gasBaselineCo2Kg)
                : '—'}
              subtitle={t(
                'carbon.evidence.gasHint',
                'Fixed 0.192 kg CO₂ per km',
              )}
              icon={<Fuel className="h-5 w-5" aria-hidden="true" />}
              color="red"
            />
            <MetricCard
              label={netLabel}
              value={resolved
                ? display.formatSignedKg(period.netAvoidedCo2Kg)
                : '—'}
              subtitle={t(
                'carbon.evidence.netHint',
                'Gas baseline minus attributed charging CO₂',
              )}
              icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
              color={period.netDisposition === 'excess'
                ? 'red'
                : period.netDisposition === 'unknown'
                  ? 'blue'
                  : 'green'}
            />
          </Grid>
          {period.availability === 'empty' ? (
            <AlertBanner className="mt-4" variant="info">
              {t(
                'carbon.evidence.validEmpty',
                'The selected-period endpoint returned a valid zero-evidence response.',
              )}
            </AlertBanner>
          ) : period.availability === 'invalid' ? (
            <AlertBanner className="mt-4" variant="warning">
              {t(
                'carbon.evidence.invalid',
                'Some selected-period fields failed runtime validation; unknown values remain withheld.',
              )}
            </AlertBanner>
          ) : null}
        </CarbonSectionBody>
      </GlassPanel>
    </section>
  );
}
