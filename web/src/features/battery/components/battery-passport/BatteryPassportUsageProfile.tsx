import { Activity, Target, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportUsageProfileProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

export function BatteryPassportUsageProfile({
  analysis,
  state,
}: BatteryPassportUsageProfileProps) {
  const { t } = useTranslation();
  const metrics = analysis.metrics;

  return (
    <section data-testid="battery-passport-usage-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Activity
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.usage.title',
            'Usage-factor profile',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.usage.subtitle',
            'Neutral descriptions of server rollups used by the certificate; no causal attribution or charging prescription.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard
              label={t(
                'batteryPassport.usage.efc',
                'Equivalent-full-cycle proxy',
              )}
              value={metrics.equivalentFullCycles != null
                ? fmtNumber(metrics.equivalentFullCycles, 1)
                : '—'}
              subtitle={t(
                'batteryPassport.usage.efcHint',
                'total charged energy divided by the server reference',
              )}
              icon={<Activity className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'batteryPassport.usage.fast',
                'Fast-charge session share',
              )}
              value={metrics.fastChargeRatio != null
                ? fmtPercent(metrics.fastChargeRatio * 100, 1)
                : '—'}
              subtitle={t(
                'batteryPassport.usage.fastHint',
                'sessions above the server power threshold / sessions counted',
              )}
              icon={<Zap className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'batteryPassport.usage.endSoc',
                'Average charge-end SoC',
              )}
              value={metrics.avgChargeLimitPct != null
                ? fmtPercent(metrics.avgChargeLimitPct, 1)
                : '—'}
              subtitle={t(
                'batteryPassport.usage.endSocHint',
                'average of available session end-SoC values',
              )}
              icon={<Target className="h-5 w-5" />}
              color="cyan"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'batteryPassport.usage.notice',
                'These aggregate proxies do not expose session timing, charging context, battery temperature, or other factors needed for a causal interpretation.',
              )}
            </Text>
          </AlertBanner>
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
