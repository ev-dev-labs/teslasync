import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { ChartCard } from '@/components/layout';
import { Badge, MetricLabel, Table, Text } from '@/components/ui';
import { cn } from '@/lib/cn';

import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeSectionProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ArchetypeCandidateModels({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { fmtScientificNumber, fmtNumber, fmtInt } = useNumberFormatting();
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
  const modelName = t('archetypes.candidates.model', 'Candidate');
  const inertiaName = t('archetypes.candidates.inertia', 'Inertia');
  const realizedName = t('archetypes.candidates.realized', 'Realized clusters');
  const clusterRangeName = t('archetypes.candidates.clusterRange', 'Smallest / largest');
  const decisionName = t('archetypes.candidates.decision', 'Decision');

  return (
    <section data-testid="drive-archetypes-candidates">
      <ChartCard
        size="standard"
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
          { key: 'model', label: modelName },
          { key: 'realized', label: realizedName },
          { key: 'silhouette', label: silhouetteName, format: (value) => fmtScientificNumber(value, 3) },
          { key: 'inertia', label: inertiaName, format: (value) => fmtNumber(value) },
          { key: 'agreement', label: agreementName, format: (value) => fmtScientificNumber(value, 3) },
          { key: 'smallest', label: t('archetypes.candidates.smallest', 'Smallest cluster') },
          { key: 'largest', label: t('archetypes.candidates.largest', 'Largest cluster') },
          { key: 'selected', label: decisionName },
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
                <YAxis domain={[-1, 1]} tick={axisTick} tickFormatter={(value) => fmtNumber(value)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtScientificNumber(value, 3)} />} />
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
          <Table className="min-w-[760px]" data-mobile-stack-table aria-label={t('archetypes.candidates.title', 'Candidate-k model selection')}>

            <thead data-app-part="table-head"><tr data-app-part="table-row">
              {[
                modelName,
                silhouetteName,
                agreementName,
                inertiaName,
                realizedName,
                clusterRangeName,
                decisionName,
              ].map((label, index) => (
                <th data-app-part="table-cell" key={label} scope="col" className={index > 0 && index < 6 ? 'text-right' : undefined}>
                  <MetricLabel>{label}</MetricLabel>
                </th>
              ))}
            </tr></thead>
            <tbody>
            {rows.map((row) => (
              <tr data-app-part="table-row"
                key={row.k}
                className={cn(
                  row.selected === t('archetypes.common.selected', 'Selected') && 'bg-theme-accent/5',
                )}
              >
                <th data-app-part="table-cell" scope="row"><Text variant="bodySm">{row.model}</Text></th>
                <td data-app-part="table-cell" data-mobile-label={silhouetteName} className="text-right"><Text variant="bodySm">{fmtScientificNumber(row.silhouette, 3)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={agreementName} className="text-right"><Text variant="bodySm">{fmtScientificNumber(row.agreement, 3)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={inertiaName} className="text-right"><Text variant="bodySm">{fmtNumber(row.inertia)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={realizedName} className="text-right"><Text variant="bodySm">{fmtInt(row.realized)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={clusterRangeName} className="text-right"><Text variant="bodySm">{fmtInt(row.smallest)} / {fmtInt(row.largest)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={decisionName}>
                <Badge variant={row.selected === t('archetypes.common.selected', 'Selected') ? 'success' : 'neutral'}>
                  {row.selected}
                </Badge>
                </td>
              </tr>
            ))}
            </tbody>
          </Table>
          </ArchetypeSectionBody>
        )}
      </ChartCard>
    </section>
  );
}
