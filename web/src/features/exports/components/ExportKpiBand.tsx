import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { ExportStats } from './exportStats';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ExportKpiBandProps {
  stats: ExportStats;
  isLoading: boolean;
  hasData?: boolean;
  retained?: boolean;
}

/**
 * Full-width KPI band summarising the export-job queue. Reflows from 2 columns
 * on phones up to 5 on ultra-wide monitors so it fills the shell width.
 */
export function ExportKpiBand({ stats, isLoading, hasData = true, retained = false }: ExportKpiBandProps) {
  const { formatBytes } = useNumberFormatting();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <section
        aria-label={t('exportsList.kpi.label', 'Export summary')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-5"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              'h-[76px] w-full rounded-xl',
              // Mirror the storage card's responsive span (last cell) so the
              // placeholder previews the final layout without a reflow on load.
              i === 4 && 'col-span-2 lg:col-span-1',
            )}
          />
        ))}
      </section>
    );
  }

  return (
    <section
      aria-label={t('exportsList.kpi.label', 'Export summary')}
      className="min-w-0"
    >
      <StatStrip
        id="exports-summary"
        retained={retained}
        period={{ kind: 'unknown', label: t('exportsList.kpi.label', 'Export summary') }}
        metrics={[
          { metricId: 'count', occurrenceId: 'total', label: t('exportsList.kpi.total', 'Total exports'), rawValue: hasData ? stats.total : null },
          { metricId: 'count', occurrenceId: 'ready', label: t('exportsList.kpi.ready', 'Ready'), rawValue: hasData ? stats.ready : null },
          { metricId: 'count', occurrenceId: 'in-progress', label: t('exportsList.kpi.inProgress', 'In progress'), rawValue: hasData ? stats.inProgress : null },
          { metricId: 'count', occurrenceId: 'failed', label: t('exportsList.kpi.failed', 'Failed'), rawValue: hasData ? stats.failed : null },
          { metricId: 'text', occurrenceId: 'storage', label: t('exportsList.kpi.storage', 'Total size'), rawValue: hasData ? formatBytes(stats.totalBytes, { zeroAsEmpty: true }) : null },
        ]}
      />
    </section>
  );
}
