/**
 * Live Signal Inspector — source-layer breakdown.
 *
 * Visualises how the current snapshot splits across the layered live-state
 * contract (L1 fresh / stale / L2 legacy / unknown). A proportion bar gives
 * an at-a-glance ratio; the stat cards below give exact counts with the
 * canonical `<SourceLayerBadge>` so the colour language matches the diff and
 * FSM-debugger surfaces.
 */
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { SourceLayerBadge } from '@/components/data-display';
import { cn } from '@/lib/cn';

import { LiveSectionState } from './LiveSectionState';
import type {
  LiveSignalStats,
  LiveSourceKey,
  SectionStatus,
} from './liveSignalStats';

interface LiveSignalSourceBreakdownProps {
  stats: LiveSignalStats;
  status: SectionStatus;
  error: unknown;
  onRetry: () => void;
  noVehicleIcon?: ReactNode;
}

interface SourceMeta {
  key: LiveSourceKey;
  bar: string;
  labelKey: string;
  labelFallback: string;
}

const SOURCE_META: readonly SourceMeta[] = [
  { key: 'l1', bar: 'bg-emerald-500', labelKey: 'admin.liveSignals.source.l1', labelFallback: 'Live · L1' },
  { key: 'stale', bar: 'bg-amber-500', labelKey: 'admin.liveSignals.source.stale', labelFallback: 'Stale' },
  { key: 'l2', bar: 'bg-blue-500', labelKey: 'admin.liveSignals.source.l2', labelFallback: 'Legacy · L2' },
  { key: 'unknown', bar: 'bg-slate-500', labelKey: 'admin.liveSignals.source.unknown', labelFallback: 'Unknown' },
];

export function LiveSignalSourceBreakdown({
  stats,
  status,
  error,
  onRetry,
  noVehicleIcon,
}: LiveSignalSourceBreakdownProps) {
  const { t } = useTranslation();

  // Single null-safe pass: derive count + clamped percentage per source layer
  // once so the proportion bar and the stat cards read from the same model.
  // `stats` is prop-driven — guarding `total` / `bySource` keeps a malformed or
  // partial snapshot from throwing on `.total` or `bySource[key]`, and clamping
  // stops a degenerate `total` (smaller than a facet count) from overflowing the
  // track or printing ">100%".
  const segments = useMemo(() => {
    const total = Math.max(0, stats.total ?? 0);
    const bySource = stats.bySource;
    return SOURCE_META.map((meta) => {
      const count = Math.max(0, bySource?.[meta.key] ?? 0);
      const rawPct = total > 0 ? (count / total) * 100 : 0;
      const pct = Math.min(100, Math.max(0, rawPct));
      return { ...meta, count, pct, roundedPct: Math.round(pct) };
    });
  }, [stats.total, stats.bySource]);

  const sourceCounts = stats.bySource;
  const barAria = t(
    'admin.liveSignals.sources.barAria',
    'Signal source-layer distribution: {{l1}} live, {{stale}} stale, {{l2}} legacy, {{unknown}} unknown',
    {
      l1: sourceCounts?.l1 ?? 0,
      stale: sourceCounts?.stale ?? 0,
      l2: sourceCounts?.l2 ?? 0,
      unknown: sourceCounts?.unknown ?? 0,
    },
  );

  return (
    <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.liveSignals.panels.sources', 'Source Layers')}
      </PanelTitle>

      <LiveSectionState
        status={status}
        error={error}
        onRetry={onRetry}
        skeletonHeight={180}
        noVehicleIcon={noVehicleIcon}
        noVehicleMessage={t(
          'admin.liveSignals.sources.noVehicle',
          'Select a vehicle to see how its signals are distributed across the L1 / L2 / stale layers.',
        )}
        emptyMessage={t(
          'admin.liveSignals.sources.empty',
          'No live signals to classify yet.',
        )}
      >
        <div className="space-y-4">
          <div
            className="flex h-3 overflow-hidden rounded-full bg-white/[0.05]"
            role="img"
            aria-label={barAria}
          >
            {segments.map(({ key, bar, pct, count, roundedPct, labelKey, labelFallback }) => {
              if (pct <= 0) return null;
              return (
                <div
                  key={key}
                  className={cn('h-full', bar)}
                  style={{ width: `${pct}%` }}
                  title={`${t(labelKey, labelFallback)}: ${count} (${roundedPct}%)`}
                />
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {segments.map(({ key, labelKey, labelFallback, count, roundedPct }) => (
              <div
                key={key}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <SourceLayerBadge source={key} showLabel />
                  <Caption className="tabular-nums">{roundedPct}%</Caption>
                </div>
                <Text
                  as="div"
                  size="xl"
                  weight="bold"
                  color="primary"
                  className="mt-2 tabular-nums"
                >
                  {count}
                </Text>
                <Caption>{t(labelKey, labelFallback)}</Caption>
              </div>
            ))}
          </div>
        </div>
      </LiveSectionState>
    </GlassPanel>
  );
}
