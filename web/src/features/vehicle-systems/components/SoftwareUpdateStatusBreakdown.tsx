/**
 * SoftwareUpdateStatusBreakdown — distribution of updates by lifecycle status.
 *
 * Presentational: the parent page tallies the raw update rows by status and
 * passes the counts in. Renders one <MetricBar> per status that has at least
 * one update, in a stable order, so the panel reads consistently regardless of
 * which statuses are present in the current range.
 */

import { useTranslation } from 'react-i18next';

import { MetricBar } from '@/components/data-display';
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
  const rows = UPDATE_STATUS_ORDER.filter((key) => (counts[key] ?? 0) > 0);

  return (
    <ul className="space-y-3">
      {rows.map((key) => {
        const meta = UPDATE_STATUS[key];
        const value = counts[key] ?? 0;
        return (
          <li key={key}>
            <MetricBar
              label={t(meta.labelKey, meta.labelFallback)}
              value={value}
              max={total || value}
              color={meta.hex}
              sublabel={fmtInt(value)}
            />
          </li>
        );
      })}
    </ul>
  );
}
