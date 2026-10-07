import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { Badge, Text } from '@/components/ui';
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeSectionProps } from './types';

export function ArchetypeConfidenceDistribution({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const bins = [
      { label: t('archetypes.confidence.binBoundary', '< 0.10'), min: 0, max: 0.1 },
      { label: t('archetypes.confidence.binLow', '0.10–0.24'), min: 0.1, max: 0.25 },
      { label: t('archetypes.confidence.binMiddle', '0.25–0.49'), min: 0.25, max: 0.5 },
      { label: t('archetypes.confidence.binHigh', '0.50–0.74'), min: 0.5, max: 0.75 },
      { label: t('archetypes.confidence.binVeryHigh', '0.75–1.00'), min: 0.75, max: 1.000001 },
    ];
    return bins.map((bin) => {
      const count = summary.assignments.filter(
        (assignment) =>
          assignment.assignmentMargin >= bin.min
          && assignment.assignmentMargin < bin.max,
      ).length;
      return {
        margin: bin.label,
        count,
        share:
          summary.assignments.length > 0
            ? (count / summary.assignments.length) * 100
            : 0,
      };
    });
  }, [summary.assignments, t]);
  const ambiguous = summary.clusters.reduce(
    (total, cluster) => total + cluster.ambiguousAssignments,
    0,
  );

  return (
    <section data-testid="drive-archetypes-confidence">
      <ChartContainer
        title={t('archetypes.confidence.title', 'Assignment confidence and margin distribution')}
        subtitle={t(
          'archetypes.confidence.subtitle',
          'Relative separation from the assigned centroid versus the nearest alternative in standardized space.',
        )}
        ariaLabel={t(
          'archetypes.confidence.aria',
          'Eligible drive assignments grouped by relative standardized-space assignment margin',
        )}
        ariaDescription={t(
          'archetypes.confidence.description',
          'Low margin indicates boundary ambiguity; margin is not a probability or correctness score.',
        )}
        height={360}
        exportable={summary.assignments.length > 0}
        exportFilename="drive-archetype-assignment-margins"
        exportData={rows}
        data={rows}
        dataColumns={[
          { key: 'margin', label: t('archetypes.confidence.marginBand', 'Margin band') },
          { key: 'count', label: t('archetypes.common.drives', 'Drives'), format: (value) => fmtInt(value) },
          { key: 'share', label: t('archetypes.confidence.share', 'Assignment share (%)'), format: (value) => fmtNumber(value, 1) },
        ]}
      >
        <ArchetypeSectionBody
          summary={summary}
          state={state}
          className="flex h-full flex-col gap-3"
          skeletonHeight={310}
        >
          <div className="min-h-56 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
                <XAxis dataKey="margin" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={axisTick} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtInt(value)} />} />
                <Bar
                  dataKey="count"
                  name={t('archetypes.confidence.assignmentCount', 'Assignment count')}
                  fill={CHART_COLORS[3]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <Text variant="bodySm">
              {t(
                'archetypes.confidence.ambiguousSummary',
                '{{count}} drives fall below the 0.10 ambiguity boundary.',
                { count: ambiguous },
              )}
            </Text>
            <Badge variant={ambiguous > 0 ? 'warning' : 'success'}>
              {fmtPercent(
                summary.analyzedDrives > 0
                  ? (ambiguous / summary.analyzedDrives) * 100
                  : 0,
                1,
              )}
            </Badge>
          </div>
        </ArchetypeSectionBody>
      </ChartContainer>
    </section>
  );
}
