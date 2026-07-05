import { useTranslation } from 'react-i18next';
import { Gauge, Flame, Snowflake } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;

/** Record-setting moments of the year: top speed and temperature extremes. */
export function YearExtremes({ data }: Props) {
  const { t } = useTranslation();
  const { formatSpeed, formatTemperature } = useUnits();

  // fastest_speed_kmh is km/h → SI m/s for the display-boundary formatter.
  // Guard on finiteness: JS arithmetic coerces `null` to 0, so a year with
  // no recorded top speed would otherwise surface a fabricated "0". Passing
  // `null` lets formatSpeed emit its "—" placeholder, matching how the
  // temperature extremes below defer to the formatter for missing data.
  const rawSpeedKmh = data.fastest_speed_kmh;
  const topSpeedMps =
    typeof rawSpeedKmh === 'number' && Number.isFinite(rawSpeedKmh)
      ? (rawSpeedKmh * METERS_PER_KM) / SECONDS_PER_HOUR
      : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      <MetricCard
        label={t('yearReview.topSpeed', 'Top speed')}
        value={formatSpeed(topSpeedMps)}
        icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('yearReview.hottestDrive', 'Hottest drive')}
        value={formatTemperature(data.hottest_drive_temp_c)}
        icon={<Flame className="h-4 w-4" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('yearReview.coldestDrive', 'Coldest drive')}
        value={formatTemperature(data.coldest_drive_temp_c)}
        icon={<Snowflake className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
      />
    </div>
  );
}
