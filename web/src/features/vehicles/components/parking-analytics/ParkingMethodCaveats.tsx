import { CheckCircle2, Info, MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';

import type { ParkingSummary } from '../../lib/parkingDwell';

interface ParkingMethodCaveatsProps {
  summary: ParkingSummary;
  rangeStart: string;
  rangeEnd: string;
}

/** Interpretation notes shared by populated and empty coverage states. */
export function ParkingMethodCaveats({
  summary,
  rangeStart,
  rangeEnd,
}: ParkingMethodCaveatsProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const coverage = summary.coverage;
  const nonPositiveGaps =
    coverage.overlappingGaps + coverage.zeroLengthGaps;
  const observationEnd =
    coverage.observationEndMs != null
      ? formatDateTime(new Date(coverage.observationEndMs))
      : '—';

  return (
    <div className={cn('space-y-3', coverage.recordsReturned > 0 && 'mt-5')}>
      <div className="flex items-start gap-2">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
          aria-hidden="true"
        />
        <Text as="p" variant="bodySm">
          {t(
            'parking.coverage.utcWindow',
            'The server filters drive starts from {{start}} through {{end}} as UTC calendar dates; parking before the first returned drive cannot be reconstructed.',
            { start: rangeStart, end: rangeEnd },
          )}
        </Text>
      </div>
      <div className="flex items-start gap-2">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300"
          aria-hidden="true"
        />
        <Text as="p" variant="bodySm">
          {t(
            'parking.coverage.localTime',
            'Hour, weekday, month, and the 22:00–06:00 split use {{timeZone}}. Dwell is assigned to the period in which parking starts.',
            { timeZone: coverage.timeZone },
          )}
        </Text>
      </div>
      <div className="flex items-start gap-2">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
          aria-hidden="true"
        />
        <Text as="p" variant="bodySm">
          {coverage.ongoingStints > 0
            ? t(
                'parking.coverage.ongoing',
                'The final stint is ongoing as of the frozen page clock ({{time}}); its duration can only increase.',
                { time: observationEnd },
              )
            : coverage.rightCensoredStints > 0
              ? t(
                  'parking.coverage.rangeEdge',
                  'The final stint is right-censored at the selected range edge ({{time}}); a later drive outside this window is unknown.',
                  { time: observationEnd },
                )
              : t(
                  'parking.coverage.noTrailing',
                  'No positive trailing stint was reconstructed; parking before the first usable drive remains unknown.',
                )}
        </Text>
      </div>
      <div className="flex items-start gap-2">
        <MapPinOff
          className="mt-0.5 h-4 w-4 shrink-0 text-rose-300"
          aria-hidden="true"
        />
        <Text as="p" variant="bodySm">
          {t(
            'parking.coverage.quality',
            '{{excluded}} drive records and {{gaps}} non-positive gaps were excluded; {{missing}} of {{stints}} stints lack a destination address.',
            {
              excluded: fmtInt(coverage.excludedDrives),
              gaps: fmtInt(nonPositiveGaps),
              missing: fmtInt(coverage.missingLocationStints),
              stints: fmtInt(summary.stints.length),
            },
          )}
        </Text>
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] p-3">
        <Text as="p" variant="caption">
          {coverage.possiblyCapped
            ? t(
                'parking.coverage.capped',
                'The API returned the {{limit}}-drive request cap. Because results are newest-first, older drives inside the selected window may be omitted; all results are observed-window descriptions.',
                { limit: fmtInt(coverage.rowLimit) },
              )
            : t(
                'parking.coverage.window',
                'This workspace uses {{count}} server-scoped drives from the selected window, up to the {{limit}}-drive request cap.',
                {
                  count: coverage.recordsReturned,
                  limit: fmtInt(coverage.rowLimit),
                },
              )}
        </Text>
      </div>
    </div>
  );
}
