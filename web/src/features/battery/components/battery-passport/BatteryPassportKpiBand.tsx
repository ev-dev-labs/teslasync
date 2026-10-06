import {
  Activity,
  Award,
  BatteryMedium,
  Gauge,
  Target,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatGroup, type StatMetric } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';

import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface BatteryPassportKpiBandProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

export function BatteryPassportKpiBand({
  analysis,
  state,
}: BatteryPassportKpiBandProps) {
  const { fmtNumber, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const metrics = analysis.metrics;
  const capacityValue =
    metrics.capacityKwh != null
    && metrics.originalCapacityKwh != null
      ? t(
          'batteryPassport.kpis.capacityValue',
          '{{reported}} / {{reference}} kWh',
          {
            reported: fmtNumber(metrics.capacityKwh),
            reference: fmtNumber(metrics.originalCapacityKwh),
          },
        )
      : '—';
  const summary: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'passport-soh',
      label: t('batteryPassport.kpis.soh', 'Certificate-reported SoH'),
      rawValue: metrics.sohPct != null ? fmtPercent(metrics.sohPct) : null,
      context: <><Gauge className="h-5 w-5" aria-hidden="true" />{t('batteryPassport.kpis.sohHint', 'server-derived estimate')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'passport-capacity',
      label: t('batteryPassport.kpis.capacity', 'Reported / reference capacity'),
      rawValue: capacityValue,
      context: <><BatteryMedium className="h-5 w-5" aria-hidden="true" />{t('batteryPassport.kpis.capacityHint', 'capacity_kwh / original_capacity_kwh')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'passport-efc',
      label: t('batteryPassport.kpis.efc', 'EFC proxy'),
      rawValue: metrics.equivalentFullCycles != null ? fmtNumber(metrics.equivalentFullCycles) : null,
      context: <><Activity className="h-5 w-5" aria-hidden="true" />{t('batteryPassport.kpis.efcHint', 'server-derived throughput ratio')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'passport-fast-share',
      label: t('batteryPassport.kpis.fastShare', 'Fast-charge session share'),
      rawValue: metrics.fastChargeRatio != null ? fmtPercent(metrics.fastChargeRatio * 100) : null,
      context: <><Zap className="h-5 w-5" aria-hidden="true" />{t('batteryPassport.kpis.fastHint', 'share of counted charging sessions')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'passport-end-soc',
      label: t('batteryPassport.kpis.endSoc', 'Average charge-end SoC proxy'),
      rawValue: metrics.avgChargeLimitPct != null ? fmtPercent(metrics.avgChargeLimitPct) : null,
      context: <><Target className="h-5 w-5" aria-hidden="true" />{t('batteryPassport.kpis.endSocHint', 'average reported session end SoC')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'passport-grade',
      label: t('batteryPassport.kpis.grade', 'Certificate-reported grade'),
      rawValue: metrics.reportedGrade,
      context: <><Award className="h-5 w-5" aria-hidden="true" />{t('batteryPassport.kpis.gradeHint', 'server scoring output')}</>,
    },
  ];

  return (
    <section
      data-testid="battery-passport-kpis"
      aria-label={t(
        'batteryPassport.kpis.aria',
        'Certificate-reported battery metrics',
      )}
    >
      <LayoutCard title={t(
            'batteryPassport.kpis.title',
            'Certificate-reported KPI band',
          )} description={t(
            'batteryPassport.kpis.subtitle',
            'Direct certificate fields and server-derived proxies; no calibration, causality, or remaining-life claim.',
          )}>
        <BatteryPassportSectionBody state={state}>
          <StatGroup metrics={summary} retained={Boolean(state.refreshError)}
            period={{ kind: 'snapshot', label: state.passport?.issued_at ?? '—',
              observedAt: state.passport?.issued_at ?? null,
              provenance: t('batteryPassport.kpis.subtitle', 'Direct certificate fields and server-derived proxies; no calibration, causality, or remaining-life claim.') }} />
        </BatteryPassportSectionBody>
      </LayoutCard>
    </section>
  );
}
