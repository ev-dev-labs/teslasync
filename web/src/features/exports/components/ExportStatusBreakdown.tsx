import { useTranslation } from 'react-i18next';

import { Caption, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { Icons } from '@/lib/icons';


import { STATUS_ORDER, statusColor, type ExportStats } from './exportStats';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const STATUS_LABELS: Record<(typeof STATUS_ORDER)[number], string> = {
  ready: 'Ready',
  processing: 'Processing',
  queued: 'Queued',
  failed: 'Failed',
  expired: 'Expired',
};

interface ExportStatusBreakdownProps {
  stats: ExportStats;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  unresolvedMessage?: string;
}

/**
 * Context panel that sits beside the jobs table on wide screens. Renders a
 * per-status distribution bar plus the cumulative storage footprint. Owns its
 * loading / error / empty states independently of the table band.
 */
export function ExportStatusBreakdown({
  stats,
  isLoading,
  error,
  onRetry,
  unresolvedMessage,
}: ExportStatusBreakdownProps) {
  const { fmtInt, fmtPercent, formatBytes } = useNumberFormatting();
  const { t } = useTranslation();

  // Defensive: `byStatus` can be missing a key if the API ever returns a
  // status outside the known union (the codebase has repeatedly been bitten
  // by frontend/backend shape drift). Coerce an absent count to 0 so the
  // filter never produces NaN-driven rows.
  const rows = STATUS_ORDER.filter((s) => (stats.byStatus?.[s] ?? 0) > 0);

  return (
    <LayoutCard title={t('exportsList.breakdown.title', 'Status breakdown')}>

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t(
            'exportsList.breakdown.loading',
            'Loading status breakdown…',
          )}
          className="space-y-3"
        >
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : error ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          resourceName={t('exportsList.resource', 'Exports')}
        />
      ) : unresolvedMessage ? (
        <Text as="p" variant="bodySm" role="status">{unresolvedMessage}</Text>
      ) : stats.total === 0 || rows.length === 0 ? (
        <EmptyState /* no-action: transient — nothing to summarize until exports exist */
          icon={<Icons.analytics className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'exportsList.breakdown.empty',
            'No export activity to summarize yet.',
          )}
        />
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <div className="space-y-3">
            {rows.map((status) => {
              const count = stats.byStatus?.[status] ?? 0;
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <MetricBar
                  key={status}
                  label={t(`exportsList.status.${status}`, {
                    defaultValue: STATUS_LABELS[status],
                  })}
                  value={count}
                  max={stats.total}
                  color={statusColor[status]}
                  sublabel={`${fmtInt(count)} · ${fmtPercent(pct)}`}
                />
              );
            })}
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
            <Caption className="flex items-center gap-1.5">
              <Icons.hardDrive className="h-3.5 w-3.5" aria-hidden="true" />
              {t('exportsList.breakdown.storage', 'Storage used')}
            </Caption>
            <Text variant="body" mono className="tabular-nums">
              {formatBytes(stats.totalBytes, { zeroAsEmpty: true })}
            </Text>
          </div>
        </div>
      )}
    </LayoutCard>
  );
}
