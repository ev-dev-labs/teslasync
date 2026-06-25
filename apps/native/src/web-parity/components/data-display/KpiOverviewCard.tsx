// Native parity port of web/src/components/data-display/KpiOverviewCard.tsx.
// Recreates the overview section shell -- comparison header, responsive KPI
// grid, optional muted secondary "fold-down" line, and optional footer slot --
// using React Native primitives.
//
// The web card composes `<ComparisonHeader>` which in turn renders `<Delta>`.
// That subsystem (lucide-react icons + the useUnits/useFormatting/metricSemantics
// hooks + Skeleton) is browser-only and unavailable in native parity, so the
// header is inlined here with a native-safe, page-pre-computed delta chip. See
// the parity sidecar for the line-by-line coverage map.

import React, {Children, useMemo, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';

/**
 * Direction of the headline delta. Mirrors the arrow the web `<Delta>` renders
 * (`ArrowUp` / `ArrowDown` / `ArrowRight`).
 */
export type ComparisonDeltaDirection = 'up' | 'down' | 'flat';

/**
 * Semantic outcome of the delta, used purely for colour. The web component
 * derives this from metric semantics + sign; on native the page pre-computes it
 * (consistent with the "page logic computes the values" contract).
 */
export type ComparisonDeltaTone = 'positive' | 'negative' | 'neutral';

/**
 * Native-safe headline delta. The web `delta` prop is `Omit<DeltaProps,
 * 'comparedTo'>`, which pulls in the metric-semantics + unit-preference
 * subsystem. That subsystem is not available in native parity, so callers pass
 * an already-formatted, already-localised value plus its direction/tone.
 */
export interface ComparisonHeaderDelta {
  /** Already-formatted, already-localised change text (e.g. "12%" or "3.2 mi"). */
  value: string;
  /** Directional arrow. Defaults to `flat` ("→"). */
  direction?: ComparisonDeltaDirection;
  /** Colour intent. Defaults to `neutral`. */
  tone?: ComparisonDeltaTone;
}

/**
 * Header configuration -- the native analogue of web `ComparisonHeaderProps`.
 * `delta` is native-safe (see {@link ComparisonHeaderDelta}); every other field
 * preserves the web shape.
 */
export interface ComparisonHeaderConfig {
  /** Section title, e.g. "Overview" or "Charging summary". */
  title: ReactNode;
  /** Localised current-period descriptor (e.g. "Last 30 days"). */
  currentLabel: string;
  /** Localised comparison-period descriptor (e.g. "vs prior 30 days"). */
  comparisonLabel?: string;
  /** Optional headline delta chip, rendered to the right of the title. */
  delta?: ComparisonHeaderDelta;
  /** Optional right-aligned actions (links, menus). */
  actions?: ReactNode;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Test hook applied to the header row. */
  testId?: string;
}

export interface KpiOverviewCardProps {
  /** Header configuration -- passed through to the inlined comparison header. */
  header: ComparisonHeaderConfig;
  /**
   * KPI tile slot. Pages typically pass one or more tile children (e.g.
   * `<MetricCard>`); each is laid out in a fixed-column grid cell.
   */
  kpis: ReactNode;
  /** Optional secondary stats line -- rendered muted under the grid. */
  secondary?: ReactNode;
  /** Optional footer slot -- typically an inline callout for an insight. */
  footer?: ReactNode;
  /**
   * Number of KPI columns. Defaults to the base `grid-cols-N` parsed from
   * {@link gridClassName} (2 for the web default), clamped to >= 1.
   */
  columns?: number;
  /**
   * Web responsive grid template, retained for source compatibility. The base
   * (unprefixed) `grid-cols-N` token seeds the native column count.
   */
  gridClassName?: string;
  /** Web Tailwind override on the panel; retained for source compatibility. */
  className?: string;
  /** Native style override on the outer panel. */
  style?: StyleProp<ViewStyle>;
  /** Test hook on the outer panel. */
  testId?: string;
  /** Native test hook alias. */
  testID?: string;
  /**
   * Web IntersectionObserver target id (sticky bar). There is no
   * IntersectionObserver in native; retained for source compatibility and
   * otherwise unused.
   */
  id?: string;
}

const DEFAULT_COLUMNS = 2;
const GRID_GUTTER = spacing.md;

/**
 * `KpiOverviewCard` -- presentational overview shell shared across Drives,
 * Charging, Trips, and other summary surfaces so they all read as one product.
 * Page logic computes the values; this card supplies the consistent frame.
 */
export function KpiOverviewCard({
  header,
  kpis,
  secondary,
  footer,
  columns,
  gridClassName,
  className: _className,
  style,
  testId,
  testID,
  id: _id,
}: KpiOverviewCardProps) {
  const columnCount = resolveColumnCount(columns, gridClassName);
  const tiles = Children.toArray(kpis);

  const cellStyle = useMemo<ViewStyle>(() => {
    const width = `${(100 / columnCount).toFixed(4)}%` as DimensionValue;
    return {width};
  }, [columnCount]);

  return (
    <GlassPanel style={[styles.panel, style]} testID={testID ?? testId}>
      <ComparisonHeaderRow {...header} />

      <View
        style={styles.grid}
        testID={testId ? `${testId}-kpis` : undefined}>
        {tiles.map((tile, index) => (
          <View key={`kpi-${index}`} style={[styles.gridCell, cellStyle]}>
            {renderNode(tile, styles.tileText)}
          </View>
        ))}
      </View>

      {secondary ? (
        <View style={styles.secondary}>
          {renderNode(secondary, styles.secondaryText, 'caption', 'muted')}
        </View>
      ) : null}

      {footer ? <View>{renderNode(footer)}</View> : null}
    </GlassPanel>
  );
}

KpiOverviewCard.displayName = 'KpiOverviewCard';

/**
 * Inlined native equivalent of the web `<ComparisonHeader>` -- title + period
 * strip on the left, optional delta chip + actions on the right.
 */
function ComparisonHeaderRow({
  title,
  currentLabel,
  comparisonLabel,
  delta,
  actions,
  className: _className,
  testId,
}: ComparisonHeaderConfig) {
  return (
    <View style={styles.header} testID={testId}>
      <View style={styles.headerMain}>
        {renderNode(title, styles.title, 'caption', 'primary', 'semibold')}

        <View style={styles.periodRow}>
          <AppText tone="muted" variant="caption">
            {currentLabel}
          </AppText>
          {comparisonLabel ? (
            <>
              <AppText
                style={styles.periodSeparator}
                tone="muted"
                variant="caption">
                {'\u00b7'}
              </AppText>
              <AppText tone="muted" variant="caption">
                {comparisonLabel}
              </AppText>
            </>
          ) : null}
        </View>
      </View>

      {delta || actions ? (
        <View style={styles.headerSide}>
          {delta ? <HeaderDeltaChip delta={delta} /> : null}
          {renderNode(actions)}
        </View>
      ) : null}
    </View>
  );
}

/** Native-safe direction-aware change indicator (arrow glyph + coloured value). */
function HeaderDeltaChip({delta}: {delta: ComparisonHeaderDelta}) {
  const direction = delta.direction ?? 'flat';
  const tone = delta.tone ?? 'neutral';
  const arrow =
    direction === 'up'
      ? '\u2191'
      : direction === 'down'
      ? '\u2193'
      : '\u2192';

  return (
    <AppText
      style={[styles.deltaText, deltaToneTextStyles[tone]]}
      variant="caption"
      weight="semibold">
      {`${arrow} ${delta.value}`}
    </AppText>
  );
}

function resolveColumnCount(
  columns: number | undefined,
  gridClassName: string | undefined,
): number {
  if (typeof columns === 'number' && Number.isFinite(columns) && columns >= 1) {
    return Math.floor(columns);
  }
  return parseBaseGridColumns(gridClassName) ?? DEFAULT_COLUMNS;
}

function parseBaseGridColumns(gridClassName: string | undefined): number | null {
  if (!gridClassName) {
    return null;
  }
  const match = /(?:^|\s)grid-cols-(\d+)/u.exec(gridClassName);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

function renderNode(
  node: ReactNode,
  textStyle?: StyleProp<TextStyle>,
  variant: 'body' | 'caption' = 'body',
  tone: 'primary' | 'secondary' | 'muted' = 'primary',
  weight: 'regular' | 'semibold' | 'bold' = 'regular',
): ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null;
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return (
      <AppText style={textStyle} tone={tone} variant={variant} weight={weight}>
        {node}
      </AppText>
    );
  }

  return node;
}

const styles = StyleSheet.create({
  deltaText: {
    fontVariant: ['tabular-nums'],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -(GRID_GUTTER / 2),
    marginVertical: -(GRID_GUTTER / 2),
  },
  gridCell: {
    paddingHorizontal: GRID_GUTTER / 2,
    paddingVertical: GRID_GUTTER / 2,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  headerSide: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.md,
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  periodRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  periodSeparator: {
    marginHorizontal: 6,
    opacity: 0.6,
  },
  secondary: {
    width: '100%',
  },
  secondaryText: {
    lineHeight: 20,
  },
  tileText: {
    color: colors.textPrimary,
  },
  title: {
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});

const deltaToneTextStyles = StyleSheet.create<
  Record<ComparisonDeltaTone, TextStyle>
>({
  negative: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textMuted,
  },
  positive: {
    color: colors.success,
  },
});
