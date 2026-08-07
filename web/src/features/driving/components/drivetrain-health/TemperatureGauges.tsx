import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Grid } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { temperatureGaugeRange } from '@/components/charts/temperatureGaugeRange';
import { useUnits } from '@/hooks/useUnits';

import type { TempSensor } from './constants';
import { tempSeverityColor } from './helpers';
import { convertTempFromSI } from '@/lib/unitConversion';

interface TemperatureGaugesProps {
  sensors: TempSensor[];
  loading?: boolean;
}

export function TemperatureGauges({ sensors, loading = false }: TemperatureGaugesProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  // Null-safety: a caller may hand us `undefined`/`null` while the upstream
  // health query is still settling. Guard before reading `.length`/`.map` so a
  // transient nullish prop degrades to the empty state instead of throwing.
  const list = sensors ?? [];

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('drivetrain.tempGauges', 'Temperature Gauges')}
        </PanelTitle>
        {loading ? (
          <Skeleton height={180} />
        ) : list.length === 0 ? (
          <EmptyState /* no-action: transient — awaiting first thermal telemetry */
            message={t('drivetrain.noSensors', 'No temperature sensor data available yet')}
          />
        ) : (
          <Grid cols={{ default: 2, md: 4 }} gap={6}>
            {list.map((sensor) => (
              <div key={sensor.key} className="flex flex-col items-center">
                <RadialGauge
                  value={sensor.value != null ? toTemperatureDisplay(sensor.value) : 0}
                  {...temperatureGaugeRange(toTemperatureDisplay, { maxC: sensor.maxTemp })}
                  label={t(sensor.labelKey, sensor.defaultLabel)}
                  unit={tempUnit}
                  color={tempSeverityColor(sensor.value, sensor.maxTemp)}
                />
              </div>
            ))}
          </Grid>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
