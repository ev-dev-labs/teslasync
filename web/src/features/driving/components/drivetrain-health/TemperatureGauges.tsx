import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';

import type { TempSensor } from './constants';
import { tempSeverityColor } from './helpers';
import { convertTempFromSI } from '@/lib/unitConversion';

interface TemperatureGaugesProps {
  sensors: TempSensor[];
}

export function TemperatureGauges({ sensors }: TemperatureGaugesProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="p-6">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <Thermometer className="mr-2 inline-block h-4 w-4" />
          {t('drivetrain.tempGauges', 'Temperature Gauges')}
        </h3>
        <Grid cols={{ default: 2, md: 4 }} gap={6}>
          {sensors.map((sensor) => (
            <div key={sensor.key} className="flex flex-col items-center">
              <RadialGauge
                value={sensor.value !== null ? toTemperatureDisplay(sensor.value) : 0}
                max={toTemperatureDisplay(sensor.maxTemp)}
                label={t(sensor.labelKey, sensor.defaultLabel)}
                unit={tempUnit}
                color={tempSeverityColor(sensor.value, sensor.maxTemp)}
              />
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {t('drivetrain.maxLabel', 'Max')}: {fmtNumber(toTemperatureDisplay(sensor.maxTemp), 0)}
                {tempUnit}
              </p>
            </div>
          ))}
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
