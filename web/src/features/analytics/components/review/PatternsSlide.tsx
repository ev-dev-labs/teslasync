import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';
import { Calendar, Clock } from 'lucide-react';

const KM_PER_MILE = 1.609344;

interface Props {
  data: YearReview;
}

export function PatternsSlide({ data }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `avg_distance_per_drive_km` is SI km; `avg_efficiency_wh_km` is SI Wh/km.
  const avgDistDisplay = convertDistanceFromSI(data.avg_distance_per_drive_km * 1000, distanceUnit);
  const avgEffDisplay = distanceUnit === 'mi'
    ? data.avg_efficiency_wh_km * KM_PER_MILE
    : data.avg_efficiency_wh_km;

  const hourLabel = data.most_active_hour >= 12
    ? `${data.most_active_hour === 12 ? 12 : data.most_active_hour - 12} PM`
    : `${data.most_active_hour === 0 ? 12 : data.most_active_hour} AM`;

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-5xl mb-6"
      >
        📊
      </motion.span>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-xl text-[var(--text-secondary)] mb-8"
      >
        {t('yearReview.drivingPatterns', 'Your driving patterns')}
      </motion.p>

      <div className="space-y-6 max-w-sm w-full">
        {/* Most active day */}
        <motion.div
          initial={{ x: -40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="bg-white/[0.05] rounded-xl p-5 border border-white/[0.08] flex items-center gap-4"
        >
          <Calendar className="h-8 w-8 text-indigo-400 shrink-0" />
          <div className="text-left">
            <p className="text-sm text-[var(--text-muted)]">{t('yearReview.favoriteDay', 'Favorite driving day')}</p>
            <p className="text-2xl font-bold text-white">{data.most_active_day_of_week || '—'}</p>
          </div>
        </motion.div>

        {/* Most active hour */}
        <motion.div
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="bg-white/[0.05] rounded-xl p-5 border border-white/[0.08] flex items-center gap-4"
        >
          <Clock className="h-8 w-8 text-sky-400 shrink-0" />
          <div className="text-left">
            <p className="text-sm text-[var(--text-muted)]">{t('yearReview.peakHour', 'Peak driving hour')}</p>
            <p className="text-2xl font-bold text-white">{hourLabel}</p>
          </div>
        </motion.div>

        {/* Avg drives per week */}
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="flex justify-between text-center"
        >
          <div className="flex-1">
            <p className="text-3xl font-bold text-white">{fmtNumber(data.avg_drives_per_week, 1)}</p>
            <p className="text-xs text-[var(--text-muted)]">{t('yearReview.drivesWeek', 'drives/week')}</p>
          </div>
          <div className="flex-1">
            <p className="text-3xl font-bold text-white">{Math.round(avgDistDisplay)}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {t('yearReview.distancePerDrive', { unit: distanceUnit, defaultValue: '{{unit}}/drive avg' })}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-3xl font-bold text-white">{Math.round(avgEffDisplay)}</p>
            <p className="text-xs text-[var(--text-muted)]">{efficiencyUnit} {t('yearReview.avg', 'avg')}</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
