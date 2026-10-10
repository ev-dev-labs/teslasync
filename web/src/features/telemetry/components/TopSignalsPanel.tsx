/**
 * TopSignalsPanel — ranks the most active signal names in the live buffer by
 * how frequently they arrive, with each signal's latest value. Fills the width
 * with a responsive multi-column bar grid so the busiest streams surface first.
 *
 * Pure presentation — the ranking is derived from the live tail buffer by the
 * page; this component never fetches.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered } from 'lucide-react';

import { GlassPanel, PanelTitle, Badge, Caption, Code, type BadgeProps } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';

import { cn } from '@/lib/cn';
import type { SignalEntry } from '@/types/telemetry';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface TopSignal {
  name: string;
  count: number;
  value: string;
  type: SignalEntry['type'];
}

export interface TopSignalsPanelProps {
  signals: TopSignal[];
  className?: string;
}

const TYPE_COLOR: Record<SignalEntry['type'], string> = {
  number: chartTokens.series[5],
  boolean: chartTokens.series[2],
  string: chartTokens.series[1],
};

const TYPE_VARIANT: Record<SignalEntry['type'], BadgeProps['variant']> = {
  number: 'info',
  boolean: 'warning',
  string: 'success',
};

// Stable empty reference so an absent `signals` prop doesn't churn the memo
// dependency (and therefore the derived scale) on every render.
const EMPTY_SIGNALS: readonly TopSignal[] = [];

export function TopSignalsPanel({ signals, className }: TopSignalsPanelProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const rows = signals ?? EMPTY_SIGNALS;

  // The bar scale is the busiest signal's arrival count. Coalesce each count so
  // a malformed entry never poisons the reduce, and `|| 1` guarantees a
  // non-zero divisor so a bar can never render a NaN/Infinity width.
  const maxCount = useMemo(
    () =>
      rows.reduce((m, s) => {
        const c = s.count ?? 0;
        return c > m ? c : m;
      }, 0) || 1,
    [rows],
  );

  return (
    <GlassPanel className={cn('min-w-0 max-w-full p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <ListOrdered className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
        {t('liveMonitor.topSignals', 'Most active signals')}
      </PanelTitle>

      {rows.length === 0 ? (
        // no-action: transient — the leaderboard fills once the live SSE tail delivers its first buffered signal frame; nothing the user can trigger.
        <EmptyState
          icon={<ListOrdered className="h-8 w-8" aria-hidden="true" />}
          message={t('liveMonitor.noBuffer', 'No signals buffered yet')}
        />
      ) : (
        <ul
          className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 2xl:grid-cols-3"
          aria-label={t(
            'liveMonitor.topSignalsList',
            'Most active signals ranked by arrival frequency',
          )}
        >
          {rows.map((s) => {
            const count = s.count ?? 0;
            return (
              <li key={s.name} className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Code className="min-w-0 break-words [overflow-wrap:anywhere]" title={s.name}>
                    {s.name}
                  </Code>
                  <Badge variant={TYPE_VARIANT[s.type] ?? 'neutral'} size="sm">
                    {fmtInt(count)}×
                  </Badge>
                </div>
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Caption>{t('liveMonitor.latest', 'Latest')}</Caption>
                  <Code className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">{s.value || '—'}</Code>
                </div>
                <MetricBar
                  label={t('liveMonitor.latest', 'Latest')}
                  value={count}
                  max={maxCount}
                  color={TYPE_COLOR[s.type] ?? chartTokens.series[0]}
                  showHeader={false}
                />
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
