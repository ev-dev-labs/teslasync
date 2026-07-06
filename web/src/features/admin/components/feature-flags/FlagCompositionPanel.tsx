/**
 * Feature Flags — value-type composition breakdown.
 *
 * Supporting panel that sits beside the registry table on wide screens.
 * Buckets every stored flag value by its JSON type (boolean / number /
 * string / object / array / null) and renders a proportional MetricBar
 * per non-empty bucket so operators can read the shape of the registry
 * at a glance. Owns its own loading / empty / error states so it stays
 * self-sufficient inside the bento grid.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MetricBar } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import type { FeatureFlagEntry } from '@/types/admin-diagnostics';

import {
  FLAG_VALUE_KINDS,
  classifyFlagValue,
  type FlagValueKind,
} from './flagValueKind';

interface FlagCompositionPanelProps {
  flags: FeatureFlagEntry[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Per-kind accent colours. Dynamic hex passed to the shared MetricBar's
 * `color` prop (mirrors the reference Timeline page's STATE_COLORS
 * pattern) — not a static `var(--*)` inline style.
 */
const KIND_COLOR: Record<FlagValueKind, string> = {
  boolean: '#10b981',
  number: '#22d3ee',
  string: '#8b5cf6',
  object: '#f59e0b',
  array: '#38bdf8',
  null: '#64748b',
};

export function FlagCompositionPanel({
  flags,
  loading,
  error,
  onRetry,
}: FlagCompositionPanelProps) {
  const { t } = useTranslation();

  const { rows, total } = useMemo(() => {
    const safe = flags ?? [];
    const counts = new Map<FlagValueKind, number>();
    for (const flag of safe) {
      const kind = classifyFlagValue(flag?.value);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const ordered = FLAG_VALUE_KINDS.map((kind) => ({
      kind,
      count: counts.get(kind) ?? 0,
    }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
    return { rows: ordered, total: safe.length };
  }, [flags]);

  const kindLabels: Record<FlagValueKind, string> = {
    boolean: t('admin.flags.composition.boolean', 'Boolean'),
    number: t('admin.flags.composition.number', 'Number'),
    string: t('admin.flags.composition.string', 'String'),
    object: t('admin.flags.composition.object', 'Object'),
    array: t('admin.flags.composition.array', 'Array'),
    null: t('admin.flags.composition.null', 'Null'),
  };

  if (error) {
    return (
      <QueryError
        error={error}
        onRetry={onRetry}
        resourceName={t('admin.flags.stats.resource', 'Feature flags')}
      />
    );
  }

  if (loading && (flags?.length ?? 0) === 0) {
    return <Skeleton height={16} lines={5} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        message={t(
          'admin.flags.composition.empty',
          'No flags to summarize yet. Add a flag to see its value-type breakdown here.',
        )}
        // no-action: the create surface is the "Add flag" CTA in the page header.
      />
    );
  }

  return (
    <div
      className="space-y-3"
      role="list"
      aria-label={t('admin.flags.composition.ariaLabel', 'Flag value-type composition')}
    >
      {rows.map((row) => {
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
        return (
          <div key={row.kind} role="listitem">
            <MetricBar
              label={kindLabels[row.kind]}
              value={row.count}
              max={total || row.count}
              color={KIND_COLOR[row.kind]}
              sublabel={t('admin.flags.composition.sublabel', '{{count}} · {{pct}}%', {
                count: row.count,
                pct,
              })}
            />
          </div>
        );
      })}
    </div>
  );
}
