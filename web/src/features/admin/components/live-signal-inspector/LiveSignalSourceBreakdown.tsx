/**
 * Live Signal Inspector — source-layer breakdown.
 *
 * Visualises how the current snapshot splits across the layered live-state
 * contract (L1 fresh / stale / L2 legacy / unknown). A proportion bar gives
 * an at-a-glance ratio; the stat cards below give exact counts with the
 * canonical `<SourceLayerBadge>` so the colour language matches the diff and
 * FSM-debugger surfaces.
 */
import { type ReactNode } from 'react';
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
  const total = stats.total;

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
            aria-label={t(
              'admin.liveSignals.sources.barAria',
              'Signal source-layer distribution',
            )}
          >
            {SOURCE_META.map(({ key, bar }) => {
              const count = stats.bySource[key] ?? 0;
              const pct = total > 0 ? (count / total) * 100 : 0;
              if (pct <= 0) return null;
              return (
                <div
                  key={key}
                  className={cn('h-full', bar)}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SOURCE_META.map(({ key, labelKey, labelFallback }) => {
              const count = stats.bySource[key] ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div
                  key={key}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <SourceLayerBadge source={key} showLabel />
                    <Caption className="tabular-nums">{pct}%</Caption>
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
              );
            })}
          </div>
        </div>
      </LiveSectionState>
    </GlassPanel>
  );
}
