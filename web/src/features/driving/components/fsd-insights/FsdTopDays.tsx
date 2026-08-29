import { ListOrdered } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Badge, DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { FsdInsights, FsdInsightsDay } from '@/types/fsd';

import { FsdSectionBody } from './FsdSectionBody';
import { topActiveDays } from './helpers';
import type { FsdSectionState } from './types';

const TOP_DAY_LIMIT = 10;

interface FsdTopDaysProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

/**
 * The days that actually accumulated supervised self-driving distance, ranked.
 *
 * Zero-distance days are deliberately excluded: a padded list would imply the
 * counter reported activity it never reported. The dense series lives in the
 * trend chart instead.
 */
export function FsdTopDays({ insights, state }: FsdTopDaysProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const rows = useMemo(() => topActiveDays(insights?.daily ?? [], TOP_DAY_LIMIT), [insights]);

  const columns = useMemo<Column<FsdInsightsDay>[]>(
    () => [
      {
        key: 'date',
        header: t('fsd.topDays.colDate', 'Local day'),
        render: (row) => (
          <span className="whitespace-nowrap">
            {formatDayKey(row.date, { locale: unitPrefs.locale, style: 'long' })}
          </span>
        ),
      },
      {
        key: 'fsd_distance_m',
        header: t('fsd.topDays.colDistance', 'Self-driving'),
        render: (row) => (
          <span className="tabular-nums">
            {row.fsd_distance_m != null
              ? formatDistance(row.fsd_distance_m, { precision: 1 })
              : t('fsd.notReported', 'Not reported')}
          </span>
        ),
      },
      {
        key: 'driving_distance_m',
        header: t('fsd.topDays.colDriving', 'Observed driving'),
        render: (row) => (
          <span className="tabular-nums">
            {row.driving_distance_m != null
              ? formatDistance(row.driving_distance_m, { precision: 1 })
              : t('fsd.notReported', 'Not reported')}
          </span>
        ),
      },
      {
        key: 'fsd_share_pct',
        header: t('fsd.topDays.colShare', 'Share'),
        render: (row) =>
          row.fsd_share_pct != null ? (
            <span className="tabular-nums">{fmtNumber(row.fsd_share_pct, 1)}%</span>
          ) : (
            <Text as="span" variant="caption">
              {t('fsd.notReported', 'Not reported')}
            </Text>
          ),
      },
      {
        key: 'reset_count',
        header: t('fsd.topDays.colFlags', 'Flags'),
        render: (row) =>
          row.reset_count > 0 ? (
            <Badge variant="warning" dot>
              {t('fsd.topDays.resetFlag', 'Counter reset ({{resets}})', { resets: row.reset_count })}
            </Badge>
          ) : (
            <Text as="span" variant="caption">
              {t('fsd.topDays.noFlags', 'None')}
            </Text>
          ),
      },
    ],
    [formatDistance, t, unitPrefs.locale],
  );

  return (
    <GlassPanel
      className="p-4 sm:p-5"
      role="region"
      aria-label={t('fsd.topDays.section', 'Most active supervised self-driving days')}
      data-testid="fsd-top-days"
    >
      <PanelTitle className="mb-1">{t('fsd.topDays.title', 'Most active days')}</PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {t(
          'fsd.topDays.subtitle',
          'Up to {{limit}} local days ranked by supervised self-driving distance.',
          { limit: TOP_DAY_LIMIT },
        )}
      </Text>

      <FsdSectionBody state={state} className="min-h-52">
        {rows.length > 0 ? (
          <DataTable
            tableId="fsd-top-days"
            name="FsdTopDays"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.date}
            mobileColumns={['date', 'fsd_distance_m']}
          />
        ) : (
          <EmptyState /* no-action: this ranking is a read-only view of reported counter movement; the period control in the page header is the only lever */
            icon={<ListOrdered className="h-8 w-8" aria-hidden="true" />}
            message={t('fsd.topDays.empty', 'No day in this period accumulated supervised self-driving distance.')}
          />
        )}
      </FsdSectionBody>
    </GlassPanel>
  );
}
