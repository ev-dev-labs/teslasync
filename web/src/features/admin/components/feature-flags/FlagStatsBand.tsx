/**
 * Feature Flags — summary KPI band.
 *
 * Derives operator-facing metrics from the two feature-flag feeds:
 *   • the current registry (`flags`)   → total / boolean / structured counts
 *   • the recent change-audit (`changes`) → change / delete / contributor counts
 *
 * Rendered as a full-width responsive metric grid that reflows from 2
 * columns on phones up to 6 on wide monitors. Owns its own loading
 * (skeleton grid) and error (QueryError) states so the band is
 * self-sufficient and never gates the rest of the page.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Flag, History, ToggleRight, Trash2, Users } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { QueryError, Skeleton } from '@/components/feedback';
import type {
  FeatureFlagChange,
  FeatureFlagEntry,
} from '@/types/admin-diagnostics';

import { classifyFlagValue } from './flagValueKind';

interface FlagStatsBandProps {
  flags: FeatureFlagEntry[];
  changes: FeatureFlagChange[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

const GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6';

export function FlagStatsBand({
  flags,
  changes,
  loading,
  error,
  onRetry,
}: FlagStatsBandProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const safeFlags = flags ?? [];
    const safeChanges = changes ?? [];
    let booleanCount = 0;
    let structuredCount = 0;
    for (const flag of safeFlags) {
      const kind = classifyFlagValue(flag?.value);
      if (kind === 'boolean') booleanCount += 1;
      else if (kind === 'object' || kind === 'array') structuredCount += 1;
    }
    const deleteCount = safeChanges.filter(
      (c) => c?.operation === 'delete',
    ).length;
    const actors = new Set(
      safeChanges
        .map((c) => (c?.actor ?? '').trim())
        .filter((a) => a.length > 0),
    );
    return {
      total: safeFlags.length,
      booleanCount,
      structuredCount,
      changeCount: safeChanges.length,
      deleteCount,
      actorCount: actors.size,
    };
  }, [flags, changes]);

  if (loading && (flags?.length ?? 0) === 0) {
    return (
      <div aria-hidden="true" className={GRID}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={78} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <QueryError
        error={error}
        onRetry={onRetry}
        resourceName={t('admin.flags.stats.resource', 'Feature flags')}
      />
    );
  }

  return (
    <section
      aria-label={t('admin.flags.stats.aria', 'Feature flag summary metrics')}
      className={GRID}
    >
      <MetricCard
        label={t('admin.flags.stats.total', 'Total Flags')}
        value={stats.total}
        icon={<Flag className="h-5 w-5" />}
      />
      <MetricCard
        label={t('admin.flags.stats.boolean', 'Boolean Toggles')}
        value={stats.booleanCount}
        icon={<ToggleRight className="h-5 w-5" />}
        color="green"
      />
      <MetricCard
        label={t('admin.flags.stats.structured', 'Structured')}
        value={stats.structuredCount}
        icon={<Braces className="h-5 w-5" />}
        color="purple"
      />
      <MetricCard
        label={t('admin.flags.stats.changes', 'Recent Changes')}
        value={stats.changeCount}
        icon={<History className="h-5 w-5" />}
        color="cyan"
      />
      <MetricCard
        label={t('admin.flags.stats.deletes', 'Deletes')}
        value={stats.deleteCount}
        icon={<Trash2 className="h-5 w-5" />}
        color="red"
      />
      <MetricCard
        label={t('admin.flags.stats.actors', 'Contributors')}
        value={stats.actorCount}
        icon={<Users className="h-5 w-5" />}
        color="blue"
      />
    </section>
  );
}
