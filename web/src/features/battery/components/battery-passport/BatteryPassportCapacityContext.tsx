import { BatteryMedium, Divide, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportCapacityContextProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

export function BatteryPassportCapacityContext({
  analysis,
  state,
}: BatteryPassportCapacityContextProps) {
  const { t } = useTranslation();
  const metrics = analysis.metrics;

  return (
    <section data-testid="battery-passport-capacity-context">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BatteryMedium
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.capacity.title',
            'Capacity and reference context',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.capacity.subtitle',
            'The certificate reports capacity_kwh and original_capacity_kwh as separate kWh fields; their quotient is shown transparently.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard
              label={t(
                'batteryPassport.capacity.reported',
                'capacity_kwh',
              )}
              value={metrics.capacityKwh != null
                ? t(
                    'batteryPassport.values.kwh',
                    '{{value}} kWh',
                    { value: fmtNumber(metrics.capacityKwh, 2) },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.capacity.reportedHint',
                'reported server estimate',
              )}
              icon={<BatteryMedium className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'batteryPassport.capacity.reference',
                'original_capacity_kwh',
              )}
              value={metrics.originalCapacityKwh != null
                ? t(
                    'batteryPassport.values.kwh',
                    '{{value}} kWh',
                    {
                      value: fmtNumber(
                        metrics.originalCapacityKwh,
                        1,
                      ),
                    },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.capacity.referenceHint',
                'server-selected nameplate reference',
              )}
              icon={<Database className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'batteryPassport.capacity.ratio',
                'Reported / reference ratio',
              )}
              value={metrics.capacityRatio != null
                ? fmtPercent(metrics.capacityRatio * 100, 2)
                : '—'}
              subtitle={t(
                'batteryPassport.capacity.ratioHint',
                'frontend quotient of the two reported fields',
              )}
              icon={<Divide className="h-5 w-5" />}
              color="green"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'batteryPassport.capacity.notice',
                'The response does not identify which server nameplate fallback branch supplied original_capacity_kwh. This ratio is context for reported fields, not an independent capacity test or calibrated health measurement.',
              )}
            </Text>
          </AlertBanner>
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
