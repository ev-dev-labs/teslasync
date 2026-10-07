import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { Badge, MetricLabel, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeSectionProps } from './types';

export function ArchetypeCandidateModels({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      summary.candidates.map((candidate) => ({
        model: t('archetypes.candidates.kLabel', 'k = {{count}}', {
          count: candidate.k,
        }),
        k: candidate.k,
        realized: candidate.realizedK,
        silhouette: candidate.silhouette,
        inertia: candidate.inertia,
        agreement: candidate.restartAgreement,
        smallest: candidate.smallestCluster,
        largest: candidate.largestCluster,
        selected: candidate.selected
          ? t('archetypes.common.selected', 'Selected')
          : candidate.realizedK === candidate.k
            ? t('archetypes.common.notSelected', 'Not selected')
            : t('archetypes.candidates.unrealized', 'Unrealized'),
      })),
    [summary.candidates, t],
  );
  const silhouetteName = t(
    'archetypes.candidates.silhouette',
    'Silhouette',
  );
  const agreementName = t(
    'archetypes.candidates.agreement',
    'Restart agreement',
  );

  return (
    <section data-testid="drive-archetypes-candidates">
      <ChartContainer
        title={t('archetypes.candidates.title', 'Candidate-k model selection')}
        subtitle={t(
          'archetypes.candidates.subtitle',
          'Every feasible k is evaluated; candidates must realize all requested clusters before raw maximum silhouette and the smaller-k tie-break are applied.',
        )}
        ariaLabel={t(
          'archetypes.candidates.aria',
          'Candidate cluster counts compared by silhouette separation and restart agreement',
        )}
        ariaDescription={t(
          'archetypes.candidates.description',
          'Silhouette describes separation and restart agreement describes optimization stability; neither establishes correctness.',
        )}
        height={470}
        exportable={rows.length > 0}
        exportFilename="drive-archetype-candidates"
        exportData={rows}
        chartKey="drive-archetype-candidates"
        data={rows}
        dataColumns={[
          { key: 'model', label: t('archetypes.candidates.model', 'Candidate') },
          { key: 'realized', label: t('archetypes.candidates.realized', 'Realized clusters') },
          { key: 'silhouette', label: silhouetteName, format: (value) => fmtNumber(value, 3) },
          { key: 'inertia', label: t('archetypes.candidates.inertia', 'Inertia'), format: (value) => fmtNumber(value, 2) },
          { key: 'agreement', label: agreementName, format: (value) => fmtNumber(value, 3) },
          { key: 'smallest', label: t('archetypes.candidates.smallest', 'Smallest cluster') },
          { key: 'largest', label: t('archetypes.candidates.largest', 'Largest cluster') },
          { key: 'selected', label: t('archetypes.candidates.decision', 'Decision') },
        ]}
      >
        {({ hiddenSeries }) => (
          <ArchetypeSectionBody
            summary={summary}
            state={state}
            className="flex h-full flex-col gap-3"
            skeletonHeight={420}
          >
          <div className="min-h-56 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
                <XAxis dataKey="model" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis domain={[-1, 1]} tick={axisTick} tickFormatter={(value) => fmtNumber(value, 1)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtNumber(value, 3)} />} />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  dataKey="silhouette"
                  name={silhouetteName}
                  fill={CHART_COLORS[0]}
                  radius={[4, 4, 0, 0]}
                  hide={hiddenSeries?.isHidden('silhouette') ?? false}
                />
                <Bar
                  dataKey="agreement"
                  name={agreementName}
                  fill={CHART_COLORS[2]}
                  radius={[4, 4, 0, 0]}
                  hide={hiddenSeries?.isHidden('agreement') ?? false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <div className="grid min-w-[760px] grid-cols-7 gap-2 bg-[var(--surface-2)] px-3 py-2">
              {[
                t('archetypes.candidates.model', 'Candidate'),
                silhouetteName,
                agreementName,
                t('archetypes.candidates.inertia', 'Inertia'),
                t('archetypes.candidates.realized', 'Realized clusters'),
                t('archetypes.candidates.clusterRange', 'Smallest / largest'),
                t('archetypes.candidates.decision', 'Decision'),
              ].map((label) => <MetricLabel key={label}>{label}</MetricLabel>)}
            </div>
            {rows.map((row) => (
              <div
                key={row.k}
                className={cn(
                  'grid min-w-[760px] grid-cols-7 gap-2 border-t border-[var(--border-subtle)] px-3 py-2',
                  row.selected === t('archetypes.common.selected', 'Selected') && 'bg-cyan-500/5',
                )}
              >
                <Text variant="bodySm">{row.model}</Text>
                <Text variant="bodySm">{fmtNumber(row.silhouette, 3)}</Text>
                <Text variant="bodySm">{fmtNumber(row.agreement, 3)}</Text>
                <Text variant="bodySm">{fmtNumber(row.inertia, 2)}</Text>
                <Text variant="bodySm">{fmtInt(row.realized)}</Text>
                <Text variant="bodySm">{fmtInt(row.smallest)} / {fmtInt(row.largest)}</Text>
                <Badge variant={row.selected === t('archetypes.common.selected', 'Selected') ? 'success' : 'neutral'}>
                  {row.selected}
                </Badge>
              </div>
            ))}
          </div>
          </ArchetypeSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
