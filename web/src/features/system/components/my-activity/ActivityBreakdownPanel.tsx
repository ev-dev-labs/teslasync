/**
 * ActivityBreakdownPanel — a reusable ranked list of `MetricBar` rows. Used for
 * both "Top actions" and "By category" breakdowns on the My Activity page.
 * Resolves i18n labels for action slices and renders humanised category labels
 * verbatim. Owns its loading / empty / error states.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { BreakdownSlice } from './myActivityAnalytics';

export interface ActivityBreakdownPanelProps {
  title: ReactNode;
  icon?: ReactNode;
  slices: BreakdownSlice[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  error: unknown;
  onRetry: () => void;
  emptyMessage: string;
  emptyIcon: ReactNode;
  className?: string;
}

export function ActivityBreakdownPanel({
  title,
  icon,
  slices,
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  emptyMessage,
  emptyIcon,
  className,
}: ActivityBreakdownPanelProps) {
  const { t } = useTranslation();
  const rows = slices ?? [];
  const max = rows.reduce((m, r) => Math.max(m, r.count ?? 0), 0) || 1;

  return (
    <GlassPanel className={className}>
      <div className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          {icon}
          {title}
        </PanelTitle>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : isEmpty || rows.length === 0 ? (
          <EmptyState icon={emptyIcon} message={emptyMessage} />
        ) : (
          <ul className="space-y-3">
            {rows.map((slice) => {
              const label = slice.i18nKey
                ? t(slice.i18nKey, slice.fallback ?? slice.label ?? slice.key)
                : slice.label || '—';
              return (
                <li key={slice.key}>
                  <MetricBar
                    label={label}
                    value={slice.count ?? 0}
                    max={max}
                    color={slice.color}
                    sublabel={`${fmtInt(slice.count ?? 0)} · ${fmtPercent(slice.percent ?? 0, 0)}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
