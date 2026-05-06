import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { YearReviewDriveHighlight } from '@/api/types';
import { MapPin, Clock, Zap, ArrowRight } from 'lucide-react';

const KM_PER_MILE = 1.609344;

interface Props {
  drive: YearReviewDriveHighlight | null;
  label: string;
  emoji: string;
}

export function DriveHighlightSlide({ drive, label, emoji }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  if (!drive) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center">
        <span className="text-6xl mb-4">{emoji}</span>
        <p className="text-xl text-[var(--text-secondary)]">{t('yearReview.noDriveData', 'No drive data for this year')}</p>
      </div>
    );
  }

  const hours = Math.floor(drive.duration_min / 60);
  const mins = drive.duration_min % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  // backend `distance_km` is SI km; `efficiency_wh_km` is SI Wh/km.
  const distDisplay = convertDistanceFromSI(drive.distance_km * 1000, distanceUnit);
  const effDisplay = distanceUnit === 'mi'
    ? drive.efficiency_wh_km * KM_PER_MILE
    : drive.efficiency_wh_km;

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.span
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 14 }}
        className="text-5xl md:text-6xl mb-4"
      >
        {emoji}
      </motion.span>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-lg text-[var(--text-secondary)] uppercase tracking-wider mb-3"
      >
        {label}
      </motion.p>

      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="bg-white/[0.05] backdrop-blur-sm rounded-2xl p-6 max-w-sm w-full border border-white/[0.08]"
      >
        {/* Route */}
        <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-4 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <span className="truncate">{drive.start_address || '—'}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
          <span className="truncate">{drive.end_address || '—'}</span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-2xl font-bold text-white">
              {Math.round(distDisplay)}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{distanceUnit}</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1">
              <Clock className="h-3 w-3 text-[var(--text-muted)]" />
              <p className="text-2xl font-bold text-white">{durationStr}</p>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{t('yearReview.duration', 'duration')}</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1">
              <Zap className="h-3 w-3 text-[var(--text-muted)]" />
              <p className="text-2xl font-bold text-white">
                {drive.efficiency_wh_km > 0 ? Math.round(effDisplay) : '—'}
              </p>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{efficiencyUnit}</p>
          </div>
        </div>

        {/* Date */}
        <p className="text-xs text-[var(--text-muted)] mt-4">{drive.date}</p>
      </motion.div>
    </div>
  );
}
