/**
 * SignalTypeBreakdown — shows the type mix (numeric / boolean / string) of the
 * signals currently buffered in the live tail. Complements the KPI band by
 * splitting the buffer by value kind so operators can tell at a glance whether
 * the stream is mostly telemetry numbers or state/enum strings.
 *
 * Pure presentation — counts are derived from the live buffer by the page.
 */

import { useTranslation } from 'react-i18next';
import { PieChart as PieChartIcon } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

export interface SignalTypeBreakdownProps {
  numericCount: number;
  booleanCount: number;
  stringCount: number;
  className?: string;
}

export function SignalTypeBreakdown({
  numericCount,
  booleanCount,
  stringCount,
  className,
}: SignalTypeBreakdownProps) {
  const { t } = useTranslation();

  const numeric = numericCount ?? 0;
  const boolean = booleanCount ?? 0;
  const string = stringCount ?? 0;
  const total = numeric + boolean + string;

  const rows = [
    { key: 'number', label: t('liveMonitor.typeNumber', 'Numeric'), value: numeric, color: chartTokens.series[5] },
    { key: 'boolean', label: t('liveMonitor.typeBoolean', 'Boolean'), value: boolean, color: chartTokens.series[2] },
    { key: 'string', label: t('liveMonitor.typeString', 'String'), value: string, color: chartTokens.series[1] },
  ];

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <PieChartIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('liveMonitor.typeBreakdown', 'Value Types')}
        </PanelTitle>
        {total > 0 ? <Caption>{fmtInt(total)}</Caption> : null}
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<PieChartIcon className="h-8 w-8" aria-hidden="true" />}
          message={t('liveMonitor.noBuffer', 'No signals buffered yet')}
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <MetricBar
              key={row.key}
              label={row.label}
              value={row.value}
              max={total}
              color={row.color}
              sublabel={`${fmtInt(row.value)} · ${fmtPercent((row.value / total) * 100, 0)}`}
            />
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
