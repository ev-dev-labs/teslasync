/**
 * SoftwareUpdateStatusBreakdown — distribution of updates by lifecycle status.
 *
 * Presentational: the parent page tallies the raw update rows by status and
 * passes the counts in. Renders one <MetricBar> per status that has at least
 * one update, in a stable order, so the panel reads consistently regardless of
 * which statuses are present in the current range.
 *
 * The parent gates this panel behind its own loading / error / empty
 * (`total === 0`) states, but the raw `counts` map is keyed by the wire status
 * string, which may hold values outside `UPDATE_STATUS_ORDER` (unknown or
 * future statuses). When every update falls outside the known set — or the map
 * is otherwise empty — the ordered filter yields no rows; rather than leave a
 * blank panel we surface an <EmptyState> so the section always communicates a
 * state.
 */

import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { fmtInt } from '@/lib/numberFormat';

import { UPDATE_STATUS, UPDATE_STATUS_ORDER } from './softwareUpdateStatus';

interface SoftwareUpdateStatusBreakdownProps {
  counts: Record<string, number>;
  total: number;
}

export function SoftwareUpdateStatusBreakdown({
  counts,
  total,
}: SoftwareUpdateStatusBreakdownProps) {
  const { t } = useTranslation();
  const rows = UPDATE_STATUS_ORDER.filter((key) => (counts?.[key] ?? 0) > 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks className="h-8 w-8" />}
        message={t(
          'softwareUpdates.breakdown.noKnownStatus',
          'No categorized update statuses to show',
        )}
      />
    );
  }

  return (
    <ul
      className="space-y-3"
      aria-label={t('softwareUpdates.breakdown.title', 'By Status')}
    >
      {rows.map((key) => {
        const meta = UPDATE_STATUS[key];
        const value = counts?.[key] ?? 0;
        // `total` counts ALL updates (known + unknown status), so it is the
        // correct denominator. Guard against a non-positive / NaN total — every
        // rendered row has value > 0, so falling back to `value` keeps the bar
        // at 100% instead of dividing by zero.
        const max = total > 0 ? total : value;
        return (
          <li key={key}>
            <MetricBar
              label={t(meta.labelKey, meta.labelFallback)}
              value={value}
              max={max}
              color={meta.hex}
              sublabel={fmtInt(value)}
            />
          </li>
        );
      })}
    </ul>
  );
}
