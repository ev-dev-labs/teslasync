/**
 * SignalLogBreakdownPanel — value-type composition for a query result.
 *
 * Fills the narrow column beside the chart on wide screens. Renders the
 * numeric / text / boolean split as proportional `MetricBar`s plus the
 * earliest and latest sample timestamps. Owns its loading + empty state so
 * it never blanks the bento column.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Clock } from 'lucide-react';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import type { SignalLogSummary } from './signalLogSummary';

export interface SignalLogBreakdownPanelProps {
  summary: SignalLogSummary;
  hasQueried: boolean;
  loading?: boolean;
  className?: string;
}

const BAR_COLORS = {
  numeric: '#22d3ee',
  text: '#34d399',
  boolean: '#fbbf24',
} as const;

export function SignalLogBreakdownPanel({
  summary,
  hasQueried,
  loading = false,
  className,
}: SignalLogBreakdownPanelProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();

  // Null-safe reads: the prop is typed non-null, but the page may thread
  // through `data?.summary` before its query resolves. Defend so the panel
  // renders an empty/loading state instead of throwing (mirrors the
  // `rows ?? []` guard in SignalDiffTable).
  const total = summary?.totalRecords ?? 0;
  const earliest = summary?.earliest ?? null;
  const latest = summary?.latest ?? null;

  const bars = useMemo(
    () => [
      { key: 'numeric', label: t('signalLog.type.numeric', 'Numeric'), value: summary?.numericPoints ?? 0, color: BAR_COLORS.numeric },
      { key: 'text', label: t('signalLog.type.text', 'Text'), value: summary?.textPoints ?? 0, color: BAR_COLORS.text },
      { key: 'boolean', label: t('signalLog.type.boolean', 'Boolean'), value: summary?.boolPoints ?? 0, color: BAR_COLORS.boolean },
    ],
    [summary, t],
  );

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <PanelTitle className="mb-3 flex items-center gap-2">
          <PieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('signalLog.composition', 'Value Composition')}
        </PanelTitle>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : !hasQueried ? (
          <EmptyState
            /* no-action: results not yet requested — the query cockpit above drives this panel. */
            icon={<PieChart className="h-8 w-8" aria-hidden="true" />}
            message={t('signalLog.composition.empty', 'Run a query to see the value-type breakdown.')}
          />
        ) : total === 0 ? (
          <EmptyState
            /* no-action: the query returned no rows for this range — the cockpit above drives a re-query. */
            icon={<PieChart className="h-8 w-8" aria-hidden="true" />}
            message={t('signalLog.composition.noRecords', 'No records in the selected range.')}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {bars.map((bar) => (
                <MetricBar
                  key={bar.key}
                  label={bar.label}
                  value={bar.value}
                  max={total}
                  color={bar.color}
                  sublabel={`${fmtInt(bar.value)} · ${fmtPercent(total > 0 ? (bar.value / total) * 100 : 0, 0)}`}
                />
              ))}
            </div>

            <dl className="space-y-2 border-t border-[var(--glass-border)] pt-3">
              <div className="flex items-center justify-between gap-3">
                <Text as="dt" size="xs" color="muted" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('signalLog.earliest', 'Earliest')}
                </Text>
                <Text as="dd" mono size="xs" color="secondary" className="text-right">
                  {earliest ? formatDateTime(earliest) : '—'}
                </Text>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Text as="dt" size="xs" color="muted" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('signalLog.latest', 'Latest')}
                </Text>
                <Text as="dd" mono size="xs" color="secondary" className="text-right">
                  {latest ? formatDateTime(latest) : '—'}
                </Text>
              </div>
            </dl>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
