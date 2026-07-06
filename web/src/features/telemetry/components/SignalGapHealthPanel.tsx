/**
 * SignalGapHealthPanel — the hero visual of the Signal Gap Detector.
 *
 * Renders a proportional staleness strip plus a bar chart of the four
 * staleness buckets. Owns its loading / empty / error / no-vehicle states so
 * the surrounding page never gates it behind a single data check.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';

import {
  GAP_BUCKET_COLORS,
  type GapBucketKey,
  type GapBuckets,
} from '../signalGapUtils';
import type { SignalGapAnalysis } from '../hooks/useSignalGapAnalysis';

interface SignalGapHealthPanelProps {
  analysis: SignalGapAnalysis;
  hasVehicle: boolean;
}

interface BucketSegment {
  key: GapBucketKey;
  label: string;
  count: number;
  fill: string;
}

export function SignalGapHealthPanel({ analysis, hasVehicle }: SignalGapHealthPanelProps) {
  const { t } = useTranslation();
  const { query, buckets } = analysis;

  const segments = useMemo<BucketSegment[]>(
    () => [
      { key: 'active', label: t('signalGap.active', 'Active (<30s)'), count: buckets.active ?? 0, fill: GAP_BUCKET_COLORS.active },
      { key: 'aging', label: t('signalGap.aging', 'Aging (<5min)'), count: buckets.aging ?? 0, fill: GAP_BUCKET_COLORS.aging },
      { key: 'stale', label: t('signalGap.stale', 'Stale (>5min)'), count: buckets.stale ?? 0, fill: GAP_BUCKET_COLORS.stale },
      { key: 'never', label: t('signalGap.neverReceived', 'Never Received'), count: buckets.never ?? 0, fill: GAP_BUCKET_COLORS.never },
    ],
    [buckets, t],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('signalGap.distributionTitle', 'Signal Health Distribution')}
      </PanelTitle>

      {!hasVehicle ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          message={t('signalGap.selectVehiclePrompt', 'Select a vehicle to inspect its signal freshness.')}
        />
      ) : query.isLoading ? (
        <Skeleton height={260} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : (buckets.total ?? 0) === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          message={t('signalGap.noData', 'No signal data available')}
        />
      ) : (
        <DistributionBody segments={segments} buckets={buckets} />
      )}
    </GlassPanel>
  );
}

function DistributionBody({ segments, buckets }: { segments: BucketSegment[]; buckets: GapBuckets }) {
  const { t } = useTranslation();
  const total = buckets.total || 1;

  return (
    <div className="space-y-4">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="img"
        aria-label={t('signalGap.stripLabel', 'Staleness distribution across {{total}} signals', {
          total: buckets.total ?? 0,
        })}
      >
        {segments.map((seg) =>
          seg.count > 0 ? (
            <div
              key={seg.key}
              className="h-full transition-all"
              style={{ width: `${(seg.count / total) * 100}%`, backgroundColor: seg.fill }}
              title={`${seg.label}: ${seg.count}`}
            />
          ) : null,
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: seg.fill }}
              aria-hidden="true"
            />
            <Caption>{seg.label}</Caption>
            <Text variant="bodySm" className="tabular-nums font-medium">
              {seg.count}
            </Text>
          </div>
        ))}
      </div>

      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={segments} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
            <XAxis dataKey="label" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} interval={0} />
            <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)', fillOpacity: 0.4 }} />
            <Bar dataKey="count" name={t('signalGap.signals', 'Signals')} radius={[4, 4, 0, 0]}>
              {segments.map((seg) => (
                <Cell key={seg.key} fill={seg.fill} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
