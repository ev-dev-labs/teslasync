import { useTranslation } from 'react-i18next';
import { Badge, Caption, Text } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import type { AlignedSignalSeries } from '../../lib/timelineAlignment';
import { COVERAGE_BADGE_VARIANT, COVERAGE_LABELS } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
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
              <Text variant="label" className="break-words">{s.signal}</Text>
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant={COVERAGE_BADGE_VARIANT[s.coverage]}>
                  {t(`dashcam.reconstruction.coverage.${s.coverage}`, COVERAGE_LABELS[s.coverage])}
                </Badge>
                <Caption>
                  {t('dashcam.reconstruction.pointCount', '{{count}} sample(s)', { count: s.points.length })}
                </Caption>
              </div>
            </div>
            {first && last && (
              <Text as="p" variant="caption" className="mt-1 break-words">
                {t('dashcam.reconstruction.firstLast', 'First: {{first}} at t={{firstAt}}s · last: {{last}} at t={{lastAt}}s', {
                  first: String(first.value ?? '—'),
                  firstAt: fmtNumber(first.atSeconds),
                  last: String(last.value ?? '—'),
                  lastAt: fmtNumber(last.atSeconds),
                })}
              </Text>
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
