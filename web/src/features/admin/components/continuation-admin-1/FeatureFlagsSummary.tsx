import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Flag, History, ToggleRight, Trash2, Users } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import type { FeatureFlagChange, FeatureFlagEntry } from '@/types/admin-diagnostics';
import { classifyFlagValue } from '../feature-flags/flagValueKind';

interface FeatureFlagsSummaryProps {
  flags: FeatureFlagEntry[] | undefined;
  changes: FeatureFlagChange[] | undefined;
  flagsLoading: boolean;
  changesLoading: boolean;
}

export function FeatureFlagsSummary({
  flags, changes, flagsLoading, changesLoading,
}: FeatureFlagsSummaryProps) {
  const { t } = useTranslation();
  const booleanCount = flags?.filter(flag => classifyFlagValue(flag.value) === 'boolean').length;
  const structuredCount = flags?.filter(flag => {
    const kind = classifyFlagValue(flag.value);
    return kind === 'object' || kind === 'array';
  }).length;
  const deletes = changes?.filter(change => change.operation === 'delete').length;
  const actors = changes
    ? new Set(changes.map(change => (change.actor ?? '').trim()).filter(Boolean)).size
    : undefined;

  return (
    <section
      aria-label={t('admin.flags.stats.aria', 'Feature flag summary metrics')}
      className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6"
    >
      <SummaryMetric label={t('admin.flags.stats.total', 'Total flags')}
        value={flags?.length ?? '—'} icon={<Flag className="h-5 w-5" aria-hidden />} loading={flagsLoading} />
      <SummaryMetric label={t('admin.flags.stats.boolean', 'Boolean toggles')}
        value={booleanCount ?? '—'} icon={<ToggleRight className="h-5 w-5" aria-hidden />} color="green" loading={flagsLoading} />
      <SummaryMetric label={t('admin.flags.stats.structured', 'Structured')}
        value={structuredCount ?? '—'} icon={<Braces className="h-5 w-5" aria-hidden />} color="purple" loading={flagsLoading} />
      <SummaryMetric label={t('admin.flags.stats.changes', 'Recent changes')}
        value={changes?.length ?? '—'} icon={<History className="h-5 w-5" aria-hidden />} color="cyan" loading={changesLoading} />
      <SummaryMetric label={t('admin.flags.stats.deletes', 'Deletes')}
        value={deletes ?? '—'} icon={<Trash2 className="h-5 w-5" aria-hidden />} color="red" loading={changesLoading} />
      <SummaryMetric label={t('admin.flags.stats.actors', 'Contributors')}
        value={actors ?? '—'} icon={<Users className="h-5 w-5" aria-hidden />} color="blue" loading={changesLoading} />
    </section>
  );
}

function SummaryMetric({ loading, ...props }: ComponentProps<typeof MetricCard> & { loading: boolean }) {
  return loading ? <Skeleton height={78} /> : <MetricCard {...props} wrapLabel />;
}
