import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CarbonReconciliation } from '../../lib/carbonIntelligence';
import type { CarbonSectionProps } from './types';

function checkLabel(
  id: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const labels: Record<string, string> = {
    'curve.minimum': t('carbon.accounting.curveMinimum', 'Curve minimum vs API minimum'),
    'curve.maximum': t('carbon.accounting.curveMaximum', 'Curve maximum vs API maximum'),
    'curve.greenest_hours': t(
      'carbon.accounting.greenestHours',
      'Derived vs API greenest-hour set',
    ),
    'curve.dirtiest_hours': t(
      'carbon.accounting.dirtiestHours',
      'Derived vs API dirtiest-hour set',
    ),
    'period.monthly_energy': t(
      'carbon.accounting.periodEnergy',
      'Period monthly energy sum vs period total',
    ),
    'period.monthly_co2': t(
      'carbon.accounting.periodCo2',
      'Period monthly CO₂ sum vs period total',
    ),
    'period.gas_less_charging': t(
      'carbon.accounting.periodSavings',
      'Period gas less charging vs reported saving',
    ),
    'lifetime.monthly_energy': t(
      'carbon.accounting.lifetimeEnergy',
      'Lifetime monthly energy sum vs lifetime total',
    ),
    'lifetime.monthly_co2': t(
      'carbon.accounting.lifetimeCo2',
      'Lifetime monthly CO₂ sum vs lifetime total',
    ),
    'lifetime.gas_less_charging': t(
      'carbon.accounting.lifetimeSavings',
      'Lifetime gas less charging vs reported saving',
    ),
    'recommendation.current_intensity': t(
      'carbon.accounting.currentIntensity',
      'Lifetime CO₂/energy intensity vs recommendation average',
    ),
    'recommendation.window_start': t(
      'carbon.accounting.windowStart',
      'Independent best-window start vs recommendation',
    ),
    'recommendation.window_end': t(
      'carbon.accounting.windowEnd',
      'Independent best-window end vs recommendation',
    ),
    'recommendation.window_average': t(
      'carbon.accounting.windowAverage',
      'Independent window mean vs recommendation',
    ),
    'recommendation.saving_mass': t(
      'carbon.accounting.savingMass',
      'Independent scenario saving vs reported kg',
    ),
    'recommendation.saving_percentage': t(
      'carbon.accounting.savingPercent',
      'Independent intensity reduction vs reported percent',
    ),
  };
  return labels[id] ?? id;
}

function checkValue(
  value: number | null,
  check: CarbonReconciliation,
  display: CarbonSectionProps['display'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (value == null) return '—';
  if (check.unit === 'Wh') return display.formatEnergy(value, { precision: 3 });
  if (check.unit === 'kg') return display.formatSignedKg(value, 4);
  if (check.unit === 'g/kWh') return display.formatIntensity(value, 3);
  if (check.unit === '%') return display.formatPercent(value, 3);
  return t('carbon.units.hours', '{{value}} h', {
    value: display.formatNumber(value, 0),
  });
}

function hourSetValue(
  hours: readonly number[] | undefined,
  display: CarbonSectionProps['display'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (hours == null) return '—';
  if (hours.length === 0) {
    return t('carbon.accounting.noHours', 'None reported');
  }
  return hours.map((hour) => display.formatHour(hour)).join(', ');
}

export function CarbonAccountingIdentities({
  analysis,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();

  return (
    <section
      data-testid="carbon-accounting-identities"
      aria-label={t(
        'carbon.accounting.aria',
        'Exact carbon accounting identities and tolerances',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <Binary
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.accounting.title', 'Exact accounting identities')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'carbon.accounting.subtitle',
            'Each row compares independently returned or independently derived values. Tolerances explicitly include backend wire rounding; unavailable inputs never pass by default.',
          )}
        </Text>
        <ul className="grid gap-2 lg:grid-cols-2">
          {analysis.reconciliations.map((check) => {
            const status = check.status === 'balances'
              ? {
                label: t('carbon.accounting.balances', 'Balances'),
                variant: 'success' as const,
              }
              : check.status === 'outside_tolerance'
                ? {
                  label: t('carbon.accounting.outside', 'Outside tolerance'),
                  variant: 'danger' as const,
                }
                : {
                  label: t('carbon.accounting.unavailable', 'Unavailable'),
                  variant: 'neutral' as const,
                };
            return (
              <li
                key={check.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Text as="p" variant="label">{checkLabel(check.id, t)}</Text>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                {check.unit === 'hour_set' ? (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <Text as="span" variant="caption">
                      {t('carbon.accounting.expected', 'Expected')}
                    </Text>
                    <Text as="span" variant="caption" mono>
                      {hourSetValue(check.expectedHours, display, t)}
                    </Text>
                    <Text as="span" variant="caption">
                      {t('carbon.accounting.observed', 'Observed')}
                    </Text>
                    <Text as="span" variant="caption" mono>
                      {hourSetValue(check.observedHours, display, t)}
                    </Text>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <Text as="span" variant="caption">
                      {t('carbon.accounting.expected', 'Expected')}
                    </Text>
                    <Text as="span" variant="caption" mono>
                      {checkValue(check.expected, check, display, t)}
                    </Text>
                    <Text as="span" variant="caption">
                      {t('carbon.accounting.observed', 'Observed')}
                    </Text>
                    <Text as="span" variant="caption" mono>
                      {checkValue(check.observed, check, display, t)}
                    </Text>
                    <Text as="span" variant="caption">
                      {t('carbon.accounting.residual', 'Residual')}
                    </Text>
                    <Text as="span" variant="caption" mono>
                      {checkValue(check.residual, check, display, t)}
                    </Text>
                    <Text as="span" variant="caption">
                      {t('carbon.accounting.tolerance', 'Tolerance')}
                    </Text>
                    <Text as="span" variant="caption" mono>
                      {checkValue(check.tolerance, check, display, t)}
                    </Text>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </GlassPanel>
    </section>
  );
}
