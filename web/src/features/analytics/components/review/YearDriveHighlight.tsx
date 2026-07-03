import { useTranslation } from 'react-i18next';
import { MapPin, ArrowRight, Clock, Zap } from 'lucide-react';

import { GlassPanel, Text, Caption, Label, MetricValue } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtInt } from '@/lib/numberFormat';
import type { YearReviewDriveHighlight } from '@/api/types';
import type { LucideIcon } from 'lucide-react';

const KM_PER_MILE = 1.609344;

interface Props {
  drive: YearReviewDriveHighlight | null;
  label: string;
  icon: LucideIcon;
}

/** Highlight card for a single notable drive (longest, most efficient, …). */
export function YearDriveHighlight({ drive, label, icon: Icon }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  return (
    <GlassPanel className="flex h-full flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20">
          <Icon className="h-4 w-4 text-amber-300" aria-hidden="true" />
        </span>
        <Label>{label}</Label>
      </div>

      {!drive ? (
        <EmptyState message={t('yearReview.noDriveData', 'No drive data for this year')} />
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <Text variant="bodySm" className="truncate">{drive.start_address || '—'}</Text>
            <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <Text variant="bodySm" className="truncate">{drive.end_address || '—'}</Text>
          </div>

          <div className="mt-auto grid grid-cols-3 gap-2">
            <div>
              <MetricValue className="text-xl sm:text-2xl">
                {fmtInt(convertDistanceFromSI((drive.distance_km ?? 0) * 1000, distanceUnit))}
              </MetricValue>
              <Caption>{distanceUnit}</Caption>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                <MetricValue className="text-xl sm:text-2xl">{formatDuration(drive.duration_min ?? 0)}</MetricValue>
              </div>
              <Caption>{t('yearReview.duration', 'duration')}</Caption>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <Zap className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                <MetricValue className="text-xl sm:text-2xl">
                  {(drive.efficiency_wh_km ?? 0) > 0
                    ? fmtInt(distanceUnit === 'mi' ? drive.efficiency_wh_km * KM_PER_MILE : drive.efficiency_wh_km)
                    : '—'}
                </MetricValue>
              </div>
              <Caption>{efficiencyUnit}</Caption>
            </div>
          </div>

          <Caption>{drive.date}</Caption>
        </>
      )}
    </GlassPanel>
  );
}

/** Format a whole-minute duration as `1h 24m` / `24m`. */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}
