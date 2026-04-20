import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import type { YearReview } from '@/api/types';
import { Calendar, Clock } from 'lucide-react';

interface Props {
  data: YearReview;
}

export function PatternsSlide({ data }: Props) {
  const { t } = useTranslation();

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
        className="text-xl text-white/50 mb-8"
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
            <p className="text-sm text-white/40">{t('yearReview.favoriteDay', 'Favorite driving day')}</p>
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
            <p className="text-sm text-white/40">{t('yearReview.peakHour', 'Peak driving hour')}</p>
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
            <p className="text-3xl font-bold text-white">{data.avg_drives_per_week.toFixed(1)}</p>
            <p className="text-xs text-white/40">{t('yearReview.drivesWeek', 'drives/week')}</p>
          </div>
          <div className="flex-1">
            <p className="text-3xl font-bold text-white">{Math.round(data.avg_distance_per_drive_km)}</p>
            <p className="text-xs text-white/40">{t('yearReview.kmPerDrive', 'km/drive avg')}</p>
          </div>
          <div className="flex-1">
            <p className="text-3xl font-bold text-white">{Math.round(data.avg_efficiency_wh_km)}</p>
            <p className="text-xs text-white/40">Wh/km {t('yearReview.avg', 'avg')}</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
