import { useTranslation } from 'react-i18next';

import { formatDateTime, formatDayKey } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { FsdInsightsPeriod, FsdInsightsQuality } from '@/types/fsd';

/** One label/value row of the confidence table. */
export interface FsdConfidenceItem {
  label: string;
  value: string;
}

/**
 * Build the confidence table rows.
 *
 * Kept out of the panel component so the copy — which is the part reviewers
 * actually diff — has one home, and so the panel stays inside the file-size
 * cap. Returns `[]` until both quality and period have loaded, which the panel
 * renders as its own empty body rather than as fabricated rows.
 */
export function useFsdConfidenceItems(
  quality: FsdInsightsQuality | undefined,
  period: FsdInsightsPeriod | undefined,
  locale: string | undefined,
): FsdConfidenceItem[] {
  const { t } = useTranslation();
  if (quality == null || period == null) return [];

  return [
    {
      label: t('fsd.confidence.window', 'Observation window'),
      value: t('fsd.confidence.windowValue', '{{start}} – {{end}} ({{timezone}})', {
        start: formatDayKey(period.start_date, { locale, style: 'long' }),
        end: formatDayKey(period.end_date, { locale, style: 'long' }),
        timezone: period.timezone,
      }),
    },
    {
      label: t('fsd.confidence.fsdReported', 'Self-driving counter reported'),
      value: quality.fsd_reported_in_period
        ? quality.fsd_distance_derivable
          ? t('fsd.confidence.fsdReportedYes', 'Yes — distance is derivable')
          : t(
              'fsd.confidence.fsdReportedNotDerivable',
              'Reported once, but no second reading to difference against',
            )
        : t(
            'fsd.confidence.fsdReportedNo',
            'No — nothing was reported inside this period, so every self-driving distance is unavailable',
          ),
    },
    {
      label: t('fsd.confidence.measuredDays', 'Days with a measured self-driving distance'),
      value: t('fsd.confidence.measuredDaysValue', '{{measured}} of {{total}}', {
        measured: fmtInt(quality.fsd_measured_days),
        total: fmtInt(period.days),
      }),
    },
    {
      label: t('fsd.confidence.coverage', 'Days with distance-counter observations'),
      value: t('fsd.confidence.coverageValue', '{{observed}} of {{total}} ({{pct}}%)', {
        observed: fmtInt(quality.counter_observation_days),
        total: fmtInt(period.days),
        pct: fmtNumber(quality.counter_observation_day_pct, 1),
      }),
    },
    {
      label: t('fsd.confidence.gaps', 'Days without a distance-counter observation'),
      value: fmtInt(quality.days_without_counter_observation),
    },
    {
      label: t('fsd.confidence.samples', 'Counter observations used'),
      value: t('fsd.confidence.samplesValue', '{{fsd}} self-driving / {{driving}} driving', {
        fsd: fmtInt(quality.fsd_sample_count),
        driving: fmtInt(quality.driving_sample_count),
      }),
    },
    {
      label: t('fsd.confidence.rejected', 'Observations rejected'),
      value: t('fsd.confidence.rejectedValue', '{{invalid}} invalid / {{duplicate}} duplicate', {
        invalid: fmtInt(quality.fsd_invalid_sample_count + quality.driving_invalid_sample_count),
        duplicate: fmtInt(
          quality.fsd_duplicate_sample_count + quality.driving_duplicate_sample_count,
        ),
      }),
    },
    {
      label: t('fsd.confidence.resets', 'Counter resets detected'),
      value: t('fsd.confidence.resetsValue', '{{fsd}} self-driving / {{driving}} driving', {
        fsd: fmtInt(quality.fsd_reset_count),
        driving: fmtInt(quality.driving_reset_count),
      }),
    },
    {
      label: t('fsd.confidence.fsdBaseline', 'Self-driving pre-window baseline'),
      value: quality.fsd_baseline_available
        ? t('fsd.confidence.baselineYes', 'Available — first in-window change is attributable')
        : t('fsd.confidence.baselineNo', 'Missing — the first observation is not counted as distance'),
    },
    {
      label: t('fsd.confidence.drivingBaseline', 'Observed-driving pre-window baseline'),
      value: quality.driving_baseline_available
        ? t('fsd.confidence.baselineYes', 'Available — first in-window change is attributable')
        : t('fsd.confidence.baselineNo', 'Missing — the first observation is not counted as distance'),
    },
    {
      label: t('fsd.confidence.denominator', 'Observed-driving denominator'),
      value: quality.driving_denominator_available
        ? t('fsd.confidence.denominatorYes', 'Available')
        : t('fsd.confidence.denominatorNo', 'Not reported — usage share is unavailable'),
    },
    {
      label: t('fsd.confidence.shareBasis', 'Usage-share counter basis'),
      value: quality.share_basis_available
        ? t('fsd.confidence.shareBasisYes', 'Aligned — both counters cover the same derivable span')
        : t(
            'fsd.confidence.shareBasisNo',
            'Not aligned — standalone distances remain visible, but usage share is unavailable',
          ),
    },
    {
      label: t('fsd.confidence.historyGuard', 'Historical normalization guard'),
      value: quality.historical_data_guarded
        ? quality.fsd_untrusted_sample_count + quality.driving_untrusted_sample_count > 0
          ? t(
              'fsd.confidence.historyGuardExcluded',
              'Active — {{excluded}} legacy observations with unknown unit provenance were excluded',
              {
                excluded: fmtInt(
                  quality.fsd_untrusted_sample_count + quality.driving_untrusted_sample_count,
                ),
              },
            )
          : t(
              'fsd.confidence.historyGuardTrusted',
              'Active — all included observations use normalization contract v{{version}} or newer',
              { version: fmtInt(quality.required_normalization_version) },
            )
        : t(
            'fsd.confidence.historyGuardUnavailable',
            'Unavailable — historical unit provenance could not be verified',
          ),
    },
    {
      label: t('fsd.confidence.firstObservation', 'First observation'),
      value: quality.first_observation_at
        ? formatDateTime(quality.first_observation_at, { locale })
        : t('fsd.notReported', 'Not reported'),
    },
    {
      label: t('fsd.confidence.lastObservation', 'Last observation'),
      value: quality.last_observation_at
        ? formatDateTime(quality.last_observation_at, { locale })
        : t('fsd.notReported', 'Not reported'),
    },
    {
      label: t('fsd.confidence.fsdLastObservation', 'Last self-driving observation'),
      value: quality.fsd_last_observation_at
        ? formatDateTime(quality.fsd_last_observation_at, { locale })
        : t('fsd.notReported', 'Not reported'),
    },
  ];
}
