import { AnimatedNumber } from '@/components/data-display';
import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
  field: string;
}

export function StatHeroSlide({ data, field }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const config = getStatConfig(data, field, t, distanceUnit);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.span
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-6xl md:text-8xl mb-6"
      >
        {config.emoji}
      </motion.span>

      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <AnimatedNumber
          value={config.value}
          duration={1.5}
          decimals={config.decimals}
          className="text-6xl md:text-8xl font-bold text-white"
        />
      </motion.div>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="text-xl md:text-2xl text-[var(--text-secondary)] mt-3"
      >
        {config.unit}
      </motion.p>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.4 }}
        className="text-lg text-[var(--text-muted)] mt-6 max-w-md"
      >
        {config.comparison}
      </motion.p>
    </div>
  );
}

function getStatConfig(
  data: YearReview,
  field: string,
  t: TFunction,
  distanceUnit: DistanceUnitPref,
) {
  switch (field) {
    case 'distance': {
      // backend `total_distance_km` is SI km; convert via meter floor.
      const dist = convertDistanceFromSI(data.total_distance_km * 1000, distanceUnit);
      const earthLaps = data.total_distance_km / 40075;
      return {
        emoji: '🛣️',
        value: dist,
        decimals: 0,
        unit: distanceUnit,
        comparison: earthLaps >= 0.01
          ? t('yearReview.distanceComparison', { percent: (earthLaps * 100).toFixed(1), defaultValue: "That's {{percent}}% around the Earth!" })
          : t('yearReview.distanceSmall', 'Every kilometer counts!'),
      };
    }
    case 'energy':
      return {
        emoji: '⚡',
        value: data.total_energy_kwh,
        decimals: 0,
        unit: t('yearReview.energyUnit', 'kWh charged'),
        comparison: t('yearReview.energyComparison', { days: Math.round(data.total_energy_kwh / 30), defaultValue: 'Enough to power a home for {{days}} days' }),
      };
    default:
      return {
        emoji: '📊',
        value: 0,
        decimals: 0,
        unit: '',
        comparison: '',
      };
  }
}
