import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { SectionHeader } from '../data/SectionHeader';
import { EmptyState } from '../feedback/EmptyState';
import { SemanticIcon, type SemanticIconName } from '../icons/SemanticIcon';
import { AppText } from '../ui/AppText';
import { PremiumCard } from '../ui/PremiumCard';
import { StatusPill } from '../ui/StatusPill';
import { ChartDataTable } from './ChartDataTable';

export interface ChartSummaryDatum {
  id: string;
  label: string;
  value: number;
  formattedValue?: string;
  icon?: SemanticIconName;
}

interface ChartSummaryProps {
  title: string;
  subtitle?: string;
  metricLabel: string;
  metricValue: string;
  data: ChartSummaryDatum[];
  emptyLabel: string;
  icon?: SemanticIconName;
  sourceLabel?: string;
  dataTableLabel?: string;
  parityStatusLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function ChartSummary({
  title,
  subtitle,
  metricLabel,
  metricValue,
  data,
  emptyLabel,
  icon = 'analytics',
  sourceLabel = 'React Native chart primitive with visible data alternative',
  dataTableLabel,
  parityStatusLabel = 'Universal chart',
  style,
}: ChartSummaryProps) {
  const visibleData = useMemo(
    () => data.filter(item => Number.isFinite(item.value)).slice(0, 8),
    [data],
  );
  const dataTableRows = useMemo(
    () =>
      visibleData.map(item => ({
        id: item.id,
        label: item.label,
        value: item.formattedValue ?? String(item.value),
      })),
    [visibleData],
  );
  const max = Math.max(...visibleData.map(item => Math.max(item.value, 0)), 1);
  const chartStats = useMemo(() => {
    if (visibleData.length === 0) {
      return null;
    }

    const positiveTotal = visibleData.reduce(
      (sum, item) => sum + Math.max(item.value, 0),
      0,
    );
    const maxDatum = visibleData.reduce((current, item) =>
      item.value > current.value ? item : current,
    );
    const minDatum = visibleData.reduce((current, item) =>
      item.value < current.value ? item : current,
    );

    return {
      average: positiveTotal / visibleData.length,
      maxDatum,
      minDatum,
      positiveTotal,
    };
  }, [visibleData]);

  return (
    <PremiumCard style={style} testID="chart-summary">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        eyebrow="Universal chart primitive"
        trailing={
          <StatusPill
            label={parityStatusLabel}
            state={visibleData.length > 0 ? 'online' : 'warning'}
          />
        }
      />
      <View style={styles.metricHero}>
        <AppText variant="caption" tone="muted" weight="semibold" style={styles.uppercase}>
          {metricLabel}
        </AppText>
        <AppText variant="display" weight="bold">
          {metricValue}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {sourceLabel}
        </AppText>
      </View>

      {visibleData.length === 0 ? (
        <EmptyState title="No chart points" message={emptyLabel} />
      ) : (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${title} dense native chart plot with ${
              visibleData.length
            } points, high ${formatDatum(chartStats?.maxDatum)}, low ${formatDatum(
              chartStats?.minDatum,
            )}`}
            style={styles.chartPanel}>
            <View pointerEvents="none" style={styles.chartGlow} />
            <View pointerEvents="none" style={styles.gridLayer}>
              {chartGridLines.map(line => (
                <View
                  key={`h-${line}`}
                  style={[
                    styles.horizontalGridLine,
                    {bottom: `${line}%` as DimensionValue},
                  ]}
                />
              ))}
            </View>
            <View style={styles.plot}>
              {visibleData.map((item, index) => {
                const height = `${Math.max(
                  (Math.max(item.value, 0) / max) * 100,
                  6,
                )}%` as DimensionValue;
                const fillColor = chartFillColor(index);

                return (
                  <View key={item.id} style={styles.column}>
                    <View style={styles.columnTrack}>
                      <View
                        style={[
                          styles.columnFill,
                          {height, backgroundColor: fillColor},
                        ]}
                      />
                      <View
                        style={[
                          styles.columnDot,
                          {borderColor: fillColor, backgroundColor: fillColor},
                        ]}
                      />
                    </View>
                    <AppText
                      variant="caption"
                      tone="muted"
                      numberOfLines={1}
                      style={styles.axisLabel}>
                      {item.label}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </View>
          <View
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`${title} chart range summary`}
            style={styles.statStrip}>
            <ChartStat label="High" value={formatDatum(chartStats?.maxDatum)} />
            <ChartStat label="Low" value={formatDatum(chartStats?.minDatum)} />
            <ChartStat
              label="Average"
              value={formatNumber(chartStats?.average)}
            />
            <ChartStat
              label="Total"
              value={formatNumber(chartStats?.positiveTotal)}
            />
          </View>
          <View
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`${title} chart summary with ${visibleData.length} points`}
            style={styles.series}>
            {visibleData.map(item => {
              const width = `${Math.max((Math.max(item.value, 0) / max) * 100, 4)}%` as DimensionValue;

              return (
                <View key={item.id} style={styles.row}>
                  <View style={styles.labelCell}>
                    {item.icon ? <SemanticIcon name={item.icon} size="sm" decorative /> : null}
                    <AppText variant="caption" tone="secondary" style={styles.label}>
                      {item.label}
                    </AppText>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, {width}]} />
                  </View>
                  <AppText variant="caption" weight="semibold" style={styles.value}>
                    {item.formattedValue ?? String(item.value)}
                  </AppText>
                </View>
              );
            })}
          </View>
          <ChartDataTable label={dataTableLabel} rows={dataTableRows} />
        </>
      )}
    </PremiumCard>
  );
}

interface ChartStatProps {
  label: string;
  value: string;
}

function ChartStat({label, value}: ChartStatProps) {
  return (
    <View style={styles.stat}>
      <AppText variant="caption" tone="muted" weight="semibold" style={styles.uppercase}>
        {label}
      </AppText>
      <AppText variant="caption" weight="semibold" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function formatDatum(item: ChartSummaryDatum | null | undefined): string {
  if (!item) {
    return '-';
  }

  return `${item.label}: ${item.formattedValue ?? formatNumber(item.value)}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function chartFillColor(index: number): string {
  return chartPalette[index % chartPalette.length];
}

const chartGridLines = [25, 50, 75];
const chartPalette = [
  colors.accent,
  colors.violet,
  colors.success,
  colors.warning,
] as const;

const styles = StyleSheet.create({
  metricHero: {
    gap: spacing.xs,
  },
  uppercase: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  chartPanel: {
    minHeight: 196,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  chartGlow: {
    position: 'absolute',
    right: -44,
    bottom: -56,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.accentGlow,
    opacity: 0.42,
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  horizontalGridLine: {
    position: 'absolute',
    right: spacing.md,
    left: spacing.md,
    height: 1,
    backgroundColor: colors.border,
  },
  plot: {
    flex: 1,
    minHeight: 152,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  columnTrack: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    overflow: 'hidden',
  },
  columnFill: {
    width: '100%',
    minHeight: 10,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    opacity: 0.88,
  },
  columnDot: {
    position: 'absolute',
    bottom: spacing.xs,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  axisLabel: {
    textAlign: 'center',
  },
  statStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    minWidth: 128,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  series: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelCell: {
    width: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  value: {
    width: 56,
    textAlign: 'right',
  },
});
