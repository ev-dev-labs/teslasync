import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import type { AlignedSignalSeries } from '../../lib/timelineAlignment';
import { COVERAGE_BADGE_VARIANT, COVERAGE_LABELS } from './constants';

export interface ReconstructionSeriesListProps {
  series: AlignedSignalSeries[];
}

/**
 * Per-signal coverage summary for a reconstruction: point count, coverage
 * quality badge, and any gap/sparsity notes. Values are shown as raw
 * numbers/strings — signal units are not known to this feature (the
 * telemetry catalog is fully dynamic), so no unit conversion is applied.
 */
export function ReconstructionSeriesList({ series }: ReconstructionSeriesListProps) {
  const { t } = useTranslation();
  if (series.length === 0) return null;

  return (
    <ul className="space-y-2">
      {series.map((s) => {
        const first = s.points[0];
        const last = s.points[s.points.length - 1];
        return (
          <li key={s.signal} className="rounded-lg border border-[var(--border-subtle)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">{s.signal}</span>
              <div className="flex items-center gap-2">
                <Badge size="sm" variant={COVERAGE_BADGE_VARIANT[s.coverage]}>
                  {t(`dashcam.reconstruction.coverage.${s.coverage}`, COVERAGE_LABELS[s.coverage])}
                </Badge>
                <span className="text-xs text-[var(--text-muted)]">
                  {t('dashcam.reconstruction.pointCount', '{{count}} sample(s)', { count: s.points.length })}
                </span>
              </div>
            </div>
            {first && last && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t('dashcam.reconstruction.firstLast', 'First: {{first}} at t={{firstAt}}s · Last: {{last}} at t={{lastAt}}s', {
                  first: String(first.value ?? '—'),
                  firstAt: first.atSeconds.toFixed(1),
                  last: String(last.value ?? '—'),
                  lastAt: last.atSeconds.toFixed(1),
                })}
              </p>
            )}
            {s.gapNotes.map((note, i) => (
              <InlineCallout key={i} variant="warning" className="mt-2">
                {note}
              </InlineCallout>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
