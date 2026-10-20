import { useTranslation } from 'react-i18next';
import { formatDayKey } from '@/lib/dateFormat';
import type { StatPeriod } from '@/lib/metric-reference';

/** Calendar query strings are preserved; this view does not prove an exclusive server window. */
export function useReturnedSessionPeriod(start: string, end: string, limit: number): StatPeriod {
  const { t } = useTranslation();
  return {
    kind: 'unknown', label: `${formatDayKey(start)} – ${formatDayKey(end)}`,
    reason: t('costAnalysis.statScope.returnedSessions',
      'Only returned charging sessions are summarized. The requested {{limit}}-row limit does not prove completeness; these are not complete-window or lifetime totals.',
      { limit }),
  };
}

/** Independent billing/forecast requests never inherit the workspace analysis period. */
export function useIndependentStatPeriod(source: 'billing' | 'forecast'): StatPeriod {
  const { t } = useTranslation();
  return {
    kind: 'unknown', label: t('common.unknown', 'Unknown'),
    reason: source === 'billing'
      ? t('costAnalysis.statScope.billing',
        'Reconciliation is independent of the selected date range; its reporting window is not supplied by this view.')
      : t('costAnalysis.statScope.forecast',
        'Forecast is independent of the selected date range; history and projection windows belong to the returned forecast, not a proven lifetime total.'),
  };
}
