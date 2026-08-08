import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  axisTick,
} from '@/components/charts';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity } from './labels';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeCentroidMapProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeCentroidMap({
  summary,
  state,
  display,
}: ArchetypeCentroidMapProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      summary.clusters.map((cluster) => ({
        clusterIndex: cluster.index,
        cluster: archetypeIdentity(t, cluster.index, cluster.label),
        distance: display.distanceValue(cluster.centroid.distanceM),
        speed: display.speedValue(cluster.centroid.speedMps),
        efficiency: display.efficiencyValue(cluster.centroid.efficiencyWhPerM),
        temperature: display.temperatureValue(cluster.centroid.tempC),
        drives: cluster.size,
      })),
    [display, summary.clusters, t],
  );
  const distanceName = t(
    'archetypes.units.distanceColumn',
    'Distance ({{unit}})',
    { unit: display.distanceUnit },
  );
  const speedName = t(
    'archetypes.units.speedColumn',
    'Average speed ({{unit}})',
    { unit: display.speedUnit },
  );

  return (
    <section data-testid="drive-archetypes-centroid-map">
      <ChartContainer
        title={t('archetypes.map.title', 'Archetype centroid map')}
        subtitle={t(
          'archetypes.map.subtitle',
          'Cluster centers projected onto distance and average speed; marker area follows membership.',
        )}
        ariaLabel={t(
          'archetypes.map.aria',
          'Drive archetype centroids by displayed distance and average speed, sized by eligible-drive membership',
        )}
        height={380}
        exportable={rows.length > 0}
        exportFilename="drive-archetype-centroids"
        exportData={rows}
        data={rows}
        dataColumns={[
          { key: 'cluster', label: t('archetypes.common.cluster', 'Cluster') },
          { key: 'drives', label: t('archetypes.common.drives', 'Drives'), format: (value) => fmtInt(value) },
          { key: 'distance', label: distanceName, format: (value) => fmtNumber(value, 1) },
          { key: 'speed', label: speedName, format: (value) => fmtNumber(value, 1) },
          {
            key: 'efficiency',
            label: t('archetypes.units.efficiencyColumn', 'Efficiency ({{unit}})', {
              unit: display.efficiencyUnit,
            }),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'temperature',
            label: t('archetypes.units.temperatureColumn', 'Temperature ({{unit}})', {
              unit: display.temperatureUnit,
            }),
            format: (value) => fmtNumber(value, 1),
          },
        ]}
      >
        <ArchetypeSectionBody summary={summary} state={state} className="h-full" skeletonHeight={330}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 16, bottom: 12, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
              <XAxis
                type="number"
                dataKey="distance"
                name={distanceName}
                tick={axisTick}
                tickFormatter={(value) => fmtNumber(value, 0)}
              />
              <YAxis
                type="number"
                dataKey="speed"
                name={speedName}
                tick={axisTick}
                tickFormatter={(value) => fmtNumber(value, 0)}
              />
              <ZAxis type="number" dataKey="drives" range={[90, 900]} />
              <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtNumber(value, 1)} />} />
              <ChartLegend verticalAlign="top" align="right" />
              {summary.clusters.map((cluster, index) => (
                <Scatter
                  key={cluster.index}
                  name={archetypeIdentity(t, cluster.index, cluster.label)}
                  data={rows.filter((row) => row.clusterIndex === cluster.index)}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                  fillOpacity={0.8}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </ArchetypeSectionBody>
      </ChartContainer>
    </section>
  );
}
