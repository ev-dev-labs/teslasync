import {
  Activity,
  Award,
  BatteryMedium,
  Gauge,
  Target,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';

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

  return (
    <section
      data-testid="battery-passport-kpis"
      aria-label={t(
        'batteryPassport.kpis.aria',
        'Certificate-reported battery metrics',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'batteryPassport.kpis.title',
            'Certificate-reported KPI band',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.kpis.subtitle',
            'Direct certificate fields and server-derived proxies; no calibration, causality, or remaining-life claim.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t(
                'batteryPassport.kpis.soh',
                'Certificate-reported SoH',
              )}
              value={metrics.sohPct != null
                ? fmtPercent(metrics.sohPct)
                : '—'}
              subtitle={t(
                'batteryPassport.kpis.sohHint',
                'server-derived estimate',
              )}
              icon={<Gauge className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'batteryPassport.kpis.capacity',
                'Reported / reference capacity',
              )}
              value={capacityValue}
              subtitle={t(
                'batteryPassport.kpis.capacityHint',
                'capacity_kwh / original_capacity_kwh',
              )}
              icon={<BatteryMedium className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'batteryPassport.kpis.efc',
                'EFC proxy',
              )}
              value={metrics.equivalentFullCycles != null
                ? fmtNumber(metrics.equivalentFullCycles)
                : '—'}
              subtitle={t(
                'batteryPassport.kpis.efcHint',
                'server-derived throughput ratio',
              )}
              icon={<Activity className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'batteryPassport.kpis.fastShare',
                'Fast-charge session share',
              )}
              value={metrics.fastChargeRatio != null
                ? fmtPercent(metrics.fastChargeRatio * 100)
                : '—'}
              subtitle={t(
                'batteryPassport.kpis.fastHint',
                'share of counted charging sessions',
              )}
              icon={<Zap className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'batteryPassport.kpis.endSoc',
                'Average charge-end SoC proxy',
              )}
              value={metrics.avgChargeLimitPct != null
                ? fmtPercent(metrics.avgChargeLimitPct)
                : '—'}
              subtitle={t(
                'batteryPassport.kpis.endSocHint',
                'average reported session end SoC',
              )}
              icon={<Target className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'batteryPassport.kpis.grade',
                'Certificate-reported grade',
              )}
              value={metrics.reportedGrade ?? '—'}
              subtitle={t(
                'batteryPassport.kpis.gradeHint',
                'server scoring output',
              )}
              icon={<Award className="h-5 w-5" />}
              color="red"
            />
          </div>
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
