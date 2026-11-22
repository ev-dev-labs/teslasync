import { createElement } from 'react';
import { TrendingUp, Route, Gauge, Clock } from 'lucide-react';
import { formatDurationMinutes } from '@/lib/dateConvert';
import type { useDrivesListPageData } from '../../hooks/useDrivesListPageData';
import type { useDrivesListRange } from '../../hooks/useDrivesListRange';

type HighlightsInput = ReturnType<typeof useDrivesListPageData>
  & ReturnType<typeof useDrivesListRange>;

export function buildDrivesListHighlights(input: HighlightsInput) {
  const {
    currentStats, t, fmtInt, toSpeedDisplay, speedUnit,
    fmtNumber, toDistanceDisplay, distanceUnit,
  } = input;
  /* ---- Highlights rows — "fold-down" period stats (top speed, longest,
 * avg trip, avg duration) surfaced beside the trend chart. Real period
 * data, formatted at the display boundary via the unit converters. ---- */
  const highlightRows = currentStats.count > 0 ? [
    {
      key: 'topSpeed',
      icon: createElement(TrendingUp, { className: 'h-3.5 w-3.5 text-[var(--text-muted)]', 'aria-hidden': 'true' }),
      label: t('drives.topSpeed', 'Top speed'),
      value: currentStats.topSpeedMps != null
        ? `${fmtInt(toSpeedDisplay(currentStats.topSpeedMps))} ${speedUnit}` : '—',
    },
    {
      key: 'longest',
      icon: createElement(Route, { className: 'h-3.5 w-3.5 text-[var(--text-muted)]', 'aria-hidden': 'true' }),
      label: t('drives.longest', 'Longest'),
      value: `${fmtNumber(toDistanceDisplay(currentStats.longestDistanceM ?? 0))} ${distanceUnit}`,
    },
    {
      key: 'avgTrip',
      icon: createElement(Gauge, { className: 'h-3.5 w-3.5 text-[var(--text-muted)]', 'aria-hidden': 'true' }),
      label: t('drives.avgTrip', 'Avg trip'),
      value: `${fmtNumber(toDistanceDisplay(currentStats.totalDistanceM / currentStats.count))} ${distanceUnit}`,
    },
    {
      key: 'avgDuration',
      icon: createElement(Clock, { className: 'h-3.5 w-3.5 text-[var(--text-muted)]', 'aria-hidden': 'true' }),
      label: t('drives.avgDuration', 'Avg duration'),
      value: formatDurationMinutes(currentStats.totalDurationS / 60 / currentStats.count),
    },
  ] : [];
  return highlightRows;
}
