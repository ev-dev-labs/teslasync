import { Activity, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';


import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ChargeAdvisorFrequencySupport({ analysis, state }: ChargeAdvisorComponentProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const support = analysis.evidence.support;
  const gate = analysis.evidenceGatePassed;

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.support.title', 'Drive-day frequency and support')}
      subtitle={t(
        'chargeAdvisor.support.subtitle',
        'A hard evidence gate prevents actionable guidance from sparse history.',
      )}
      icon={<ShieldCheck className="h-4 w-4 text-theme-accent" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-support"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div data-app-part="metric" data-app-metric="tile"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text data-app-part="metric-label" variant="caption">{t('chargeAdvisor.support.window', 'Observed span')}</Text>
          <Text data-app-part="metric-reading metric-value" className="mt-1 text-xl font-semibold">
            {t('chargeAdvisor.support.spanDays', '{{count}} days', {
              count: support.observedSpanDays,
            })}
          </Text>
          <Text data-app-part="metric-context" variant="caption">{t('chargeAdvisor.support.calendar', 'between first and latest included local day')}</Text>
        </div>
        <div data-app-part="metric" data-app-metric="tile"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text data-app-part="metric-label" variant="caption">{t('chargeAdvisor.support.activeDays', 'Active local days')}</Text>
          <Text data-app-part="metric-reading metric-value" className="mt-1 text-xl font-semibold">{fmtInt(support.activeLocalDays)}</Text>
          <Text data-app-part="metric-context" variant="caption">{t('chargeAdvisor.support.weeks', '{{count}} active weeks', { count: support.activeWeeks })}</Text>
        </div>
        <div data-app-part="metric" data-app-metric="tile"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text data-app-part="metric-label" variant="caption">{t('chargeAdvisor.support.score', 'Support score')}</Text>
          <Text data-app-part="metric-reading metric-value" className="mt-1 text-xl font-semibold text-theme-accent">{fmtPercent(support.score * 100)}</Text>
          <div data-app-part="metric-context">
            <Badge className="mt-2" variant={support.band === 'strong' ? 'success' : support.band === 'moderate' ? 'info' : 'warning'}>
              {t(
                `chargeAdvisor.support.band.${support.band}`,
                support.band === 'strong'
                  ? 'strong'
                  : support.band === 'moderate'
                    ? 'moderate'
                    : support.band === 'thin'
                      ? 'thin'
                      : 'none',
              )}
            </Badge>
          </div>
        </div>
        <div data-app-part="metric" data-app-metric="tile"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text data-app-part="metric-label" variant="caption">{t('chargeAdvisor.support.gate', 'Evidence gate')}</Text>
          <Text data-app-part="metric-reading metric-value" className="mt-1 text-xl font-semibold">
            {gate ? t('chargeAdvisor.support.met', 'Met') : t('chargeAdvisor.support.notMet', 'Not met')}
          </Text>
          <Text data-app-part="metric-context" variant="caption">
            <Activity className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {t('chargeAdvisor.support.rule', '28 calendar days · 8 active days · 4 active weeks')}
          </Text>
        </div>
      </div>
    </ChargeAdvisorSection>
  );
}
