import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { fmtInt, formatBytes } from '@/lib/numberFormat';

import type { ExportStats } from './exportStats';

interface ExportKpiBandProps {
  stats: ExportStats;
  isLoading: boolean;
}

/**
 * Full-width KPI band summarising the export-job queue. Reflows from 2 columns
 * on phones up to 5 on ultra-wide monitors so it fills the shell width.
 */
export function ExportKpiBand({ stats, isLoading }: ExportKpiBandProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <section
        aria-label={t('exportsList.kpi.label', 'Export summary')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-5"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
        ))}
      </section>
    );
  }

  return (
    <section
      aria-label={t('exportsList.kpi.label', 'Export summary')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-5"
    >
      <MetricCard
        label={t('exportsList.kpi.total', 'Total Exports')}
        value={fmtInt(stats.total)}
        icon={<Icons.package className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('exportsList.kpi.ready', 'Ready')}
        value={fmtInt(stats.ready)}
        icon={<Icons.success className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('exportsList.kpi.inProgress', 'In Progress')}
        value={fmtInt(stats.inProgress)}
        icon={<Icons.clock className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('exportsList.kpi.failed', 'Failed')}
        value={fmtInt(stats.failed)}
        icon={<Icons.warning className="h-5 w-5" aria-hidden="true" />}
        color="red"
      />
      <MetricCard
        label={t('exportsList.kpi.storage', 'Total Size')}
        value={formatBytes(stats.totalBytes, { zeroAsEmpty: true })}
        icon={<Icons.hardDrive className="h-5 w-5" aria-hidden="true" />}
        color="purple"
        className="col-span-2 lg:col-span-1"
      />
    </section>
  );
}
