import { AlertTriangle, ArchiveRestore, ClipboardCheck, UserRoundX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RepairCaseStats as RepairCaseStatsData } from '@/api/hooks/useRepairCaseStats';
import { Skeleton } from '@/components/feedback';
import { MetricLabel, MetricValue, Text } from '@/components/ui';

interface RepairCaseStatsProps {
  statistics?: RepairCaseStatsData;
  loading?: boolean;
}

export function RepairCaseStats({ statistics, loading = false }: RepairCaseStatsProps) {
  const { t } = useTranslation();
  const metrics = [
    {
      label: t('dataRepair.cases.open', 'Open cases'),
      value: statistics?.open,
      hint: t('dataRepair.cases.openHint', 'Awaiting operator review'),
      icon: AlertTriangle,
      iconClass: 'bg-amber-400/10 text-amber-300',
    },
    {
      label: t('dataRepair.cases.inReview', 'In review'),
      value: statistics?.in_review,
      hint: t('dataRepair.cases.inReviewHint', 'Actively triaged'),
      icon: ClipboardCheck,
      iconClass: 'bg-sky-400/10 text-sky-300',
    },
    {
      label: t('dataRepair.cases.quarantined', 'Quarantined'),
      value: statistics?.quarantined,
      hint: t('dataRepair.cases.quarantinedHint', 'Reversible removals'),
      icon: ArchiveRestore,
      iconClass: 'bg-violet-400/10 text-violet-300',
    },
    {
      label: t('dataRepair.cases.active', 'Active cases'),
      value: (statistics?.open ?? 0) + (statistics?.in_review ?? 0),
      hint: t('dataRepair.cases.activeHint', 'Active review workload'),
      icon: UserRoundX,
      iconClass: 'bg-rose-400/10 text-rose-300',
    },
  ];

  return (
    <section
      className="grid grid-cols-2 gap-px border-t border-[var(--border-subtle)] bg-[var(--border-subtle)] lg:grid-cols-4"
      aria-label={t('dataRepair.cases.metricsLabel', 'Repair case metrics')}
    >
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.label}
            className="min-w-0 bg-[var(--panel-bg)] px-4 py-4 sm:px-5 sm:py-5"
          >
            <div className="flex items-center justify-between gap-2">
              <MetricLabel className="truncate">{metric.label}</MetricLabel>
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-shape-md ${metric.iconClass}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <MetricValue className="mt-2 tabular-nums">{metric.value ?? 0}</MetricValue>
            )}
            <Text as="p" variant="caption" className="mt-1 truncate">
              {metric.hint}
            </Text>
          </div>
        );
      })}
    </section>
  );
}
