// Native parity port of web/src/components/charts/ChartContainer.tsx.
// Uses React Native primitives and native tokens while preserving the web
// container API, annotation flow, fallback data table, and label-anchor helper.

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import type {AnnotationCategory} from '../../api/hooks/useAnnotations';
import {
  useChartAnnotationsAsData,
  useCreateAnnotation,
  useDeleteAnnotation,
  type AnnotationScope,
  type DataAnnotation,
} from '../../api/hooks/useAnnotations';
import {AddAnnotationPopover} from './AddAnnotationPopover';
import {AnnotationList} from './AnnotationList';

export interface ChartAnnotationsConfig {
  vehicleId?: number | null;
  scope: AnnotationScope;
  chartId?: string;
}

export interface HiddenSeriesState {
  hidden: Set<string>;
  toggle: (seriesKey: string) => void;
  isHidden: (seriesKey: string) => boolean;
  reset: () => void;
}

export interface ChartContainerRenderProps {
  annotations: DataAnnotation[];
  hidden: boolean;
  hiddenSeries: HiddenSeriesState | null;
}

type ChartContainerChildren =
  | React.ReactNode
  | ((ctx: ChartContainerRenderProps) => React.ReactNode);

type CsvCellValue = string | number | boolean | null | undefined | object;

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  action?: React.ReactNode;
  children: ChartContainerChildren;
  className?: string;
  exportable?: boolean;
  exportFilename?: string;
  exportData?: ReadonlyArray<Record<string, CsvCellValue>>;
  annotations?: ChartAnnotationsConfig;
  ariaLabel: string;
  ariaDescription?: string;
  data?: ReadonlyArray<ChartDataRow>;
  dataColumns?: ReadonlyArray<ChartDataColumn>;
  fullscreen?: boolean;
  chartKey?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export type ChartDataRow = Record<string, string | number | null | undefined>;

export interface ChartDataColumn {
  key: string;
  label: string;
  format?: (value: unknown) => string;
}

type NativeTFunction = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => string;

type Direction = 'ltr' | 'rtl';

const HIDDEN_STORAGE_PREFIX = 'teslasync-annotations-hidden:';
const HIDDEN_SERIES_PREFIX = 'teslasync-hidden-series:';
const RTL_LANGS: ReadonlySet<string> = Object.freeze(
  new Set(['ar', 'he', 'fa', 'ur']),
);
const annotationHiddenPrefs = new Map<string, boolean>();
const hiddenSeriesPrefs = new Map<string, readonly string[]>();
const ChartHiddenSeriesContext = createContext<HiddenSeriesState | null>(null);

function readHiddenPref(key: string): boolean {
  return annotationHiddenPrefs.get(HIDDEN_STORAGE_PREFIX + key) === true;
}

function writeHiddenPref(key: string, hidden: boolean): void {
  const storageKey = HIDDEN_STORAGE_PREFIX + key;
  if (hidden) {
    annotationHiddenPrefs.set(storageKey, true);
  } else {
    annotationHiddenPrefs.delete(storageKey);
  }
}

function readHiddenSeriesPref(chartKey: string): readonly string[] {
  return hiddenSeriesPrefs.get(HIDDEN_SERIES_PREFIX + chartKey) ?? [];
}

function writeHiddenSeriesPref(chartKey: string, hidden: readonly string[]): void {
  const storageKey = HIDDEN_SERIES_PREFIX + chartKey;
  if (hidden.length === 0) {
    hiddenSeriesPrefs.delete(storageKey);
  } else {
    hiddenSeriesPrefs.set(storageKey, hidden);
  }
}

function isFunctionChildren(
  children: ChartContainerChildren,
): children is (ctx: ChartContainerRenderProps) => React.ReactNode {
  return typeof children === 'function';
}

function interpolate(
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return fallback;
  }

  return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, params?: Record<string, string | number>) =>
      interpolate(fallback, params),
    [],
  );
}

function useNativeHiddenSeries(chartKey: string | undefined): HiddenSeriesState | null {
  const [hiddenValues, setHiddenValues] = useState<readonly string[]>(() =>
    chartKey ? readHiddenSeriesPref(chartKey) : [],
  );

  useEffect(() => {
    setHiddenValues(chartKey ? readHiddenSeriesPref(chartKey) : []);
  }, [chartKey]);

  const hidden = useMemo(() => new Set(hiddenValues), [hiddenValues]);

  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );

  const toggle = useCallback(
    (seriesKey: string) => {
      if (!chartKey) {
        return;
      }

      setHiddenValues(prev => {
        const next = new Set(prev);
        if (next.has(seriesKey)) {
          next.delete(seriesKey);
        } else {
          next.add(seriesKey);
        }

        const sorted = Array.from(next).sort();
        writeHiddenSeriesPref(chartKey, sorted);
        return sorted;
      });
    },
    [chartKey],
  );

  const reset = useCallback(() => {
    if (!chartKey) {
      return;
    }
    writeHiddenSeriesPref(chartKey, []);
    setHiddenValues([]);
  }, [chartKey]);

  return useMemo(
    () => (chartKey ? {hidden, toggle, isHidden, reset} : null),
    [chartKey, hidden, isHidden, reset, toggle],
  );
}

export function useChartHiddenSeries(): HiddenSeriesState | null {
  return useContext(ChartHiddenSeriesContext);
}

function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  const raw =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);

  if (/[",\r\n]/.test(raw) || raw !== raw.trim()) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

function objectsToCSV(rows: readonly Record<string, CsvCellValue>[]): string {
  const seen = new Set<string>();
  const headers: string[] = [];

  rows.forEach(row => {
    Object.keys(row).forEach(key => {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    });
  });

  const header = headers.map(escapeCell).join(',');
  const body = rows
    .map(row => headers.map(key => escapeCell(row[key])).join(','))
    .join('\r\n');

  return body.length > 0 ? `${header}\r\n${body}` : header;
}

function defaultExportFilename(prefix: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}`;
}

function getLangDir(lang: string | null | undefined): Direction {
  if (!lang) {
    return 'ltr';
  }
  const primary = String(lang).toLowerCase().split('-')[0];
  return RTL_LANGS.has(primary) ? 'rtl' : 'ltr';
}

export function textAnchorForDir(
  axis: 'x' | 'y',
  dir: Direction,
): 'start' | 'middle' | 'end' {
  if (axis === 'x') {
    return 'middle';
  }
  return dir === 'rtl' ? 'start' : 'end';
}

function currentNativeLanguage(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

function formatFallbackCell(row: ChartDataRow, column: ChartDataColumn): string {
  const raw = row[column.key];
  if (column.format != null) {
    return column.format(raw);
  }
  return raw == null ? '-' : String(raw);
}

function assignForwardedRef<T>(
  ref: React.ForwardedRef<T>,
  value: T | null,
): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}

export const ChartContainer = forwardRef<View, ChartContainerProps>(
  function ChartContainer(
    {
      title,
      subtitle,
      loading,
      empty,
      height = 300,
      action,
      children,
      className: _className,
      exportable,
      exportFilename,
      exportData,
      annotations: annotationsConfig,
      ariaLabel,
      ariaDescription,
      data,
      dataColumns,
      fullscreen,
      chartKey,
      style,
      testID,
      'data-testid': dataTestID,
    },
    ref,
  ) {
    const t = useNativeTranslationFallback();
    const reactId = useId();
    const titleId = `chart-title-${reactId}`;
    const fallbackId = `chart-fallback-${reactId}`;

    const annotationsEnabled = annotationsConfig != null;
    const annotationKey = annotationsConfig?.chartId ?? title;
    const [hidden, setHidden] = useState(() => readHiddenPref(annotationKey));
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [nativeNotice, setNativeNotice] = useState<string | null>(null);
    const hiddenSeries = useNativeHiddenSeries(chartKey);

    useEffect(() => {
      if (annotationsEnabled) {
        setHidden(readHiddenPref(annotationKey));
      }
    }, [annotationsEnabled, annotationKey]);

    const {annotations: fetchedAnnotations} = useChartAnnotationsAsData(
      annotationsEnabled
        ? {
            vehicleId: annotationsConfig?.vehicleId,
            scope: annotationsConfig?.scope,
          }
        : {},
    );
    const createMutation = useCreateAnnotation();
    const deleteMutation = useDeleteAnnotation();

    const visibleAnnotations = useMemo<DataAnnotation[]>(
      () => (annotationsEnabled && !hidden ? fetchedAnnotations : []),
      [annotationsEnabled, fetchedAnnotations, hidden],
    );

    const toggleHidden = useCallback(() => {
      setHidden(prev => {
        const next = !prev;
        writeHiddenPref(annotationKey, next);
        return next;
      });
    }, [annotationKey]);

    const handleAddAnnotation = useCallback(
      (
        label: string,
        category: AnnotationCategory,
        description?: string,
        occurredAt?: string,
      ) => {
        if (!annotationsEnabled || !annotationsConfig || !occurredAt) {
          return;
        }

        createMutation.mutate({
          vehicle_id: annotationsConfig.vehicleId ?? null,
          occurred_at: occurredAt,
          category,
          title: label,
          description,
          scope: [annotationsConfig.scope],
        });
        setPopoverOpen(false);
      },
      [annotationsConfig, annotationsEnabled, createMutation],
    );

    const handleRemoveAnnotation = useCallback(
      (id: string) => {
        const numeric = Number(id);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          return;
        }
        deleteMutation.mutate(numeric);
      },
      [deleteMutation],
    );

    const mergedRef = useCallback(
      (node: View | null) => {
        assignForwardedRef(ref, node);
      },
      [ref],
    );

    const hasCsv = !!exportData && exportData.length > 0;
    const exportableResolved = exportable !== false;
    const showExportMenu = exportableResolved && !loading && !empty;
    const rows = data ?? [];
    const columns = dataColumns ?? [];
    const hasFallbackTable = rows.length > 0 && columns.length > 0;
    const showMarkerRow =
      annotationsEnabled && !hidden && visibleAnnotations.length > 0;

    const renderChildren = useCallback(
      () =>
        isFunctionChildren(children)
          ? children({annotations: visibleAnnotations, hidden, hiddenSeries})
          : children,
      [children, hidden, hiddenSeries, visibleAnnotations],
    );

    const handleCsv = useCallback(() => {
      if (!exportData || exportData.length === 0) {
        return;
      }

      const filename =
        exportFilename ??
        defaultExportFilename(
          title.toLowerCase().replace(/\s+/g, '-') || 'chart',
        );
      const csv = objectsToCSV(exportData);
      setNativeNotice(
        t(
          'chart.export.nativeCsvUnavailable',
          'CSV export prepared for {{filename}} ({{rows}} rows, {{bytes}} bytes). Native file download is unavailable in this parity component.',
          {
            bytes: csv.length,
            filename,
            rows: exportData.length,
          },
        ),
      );
    }, [exportData, exportFilename, t, title]);

    const handleImageExportUnavailable = useCallback(() => {
      setNativeNotice(
        t(
          'chart.export.nativeImageUnavailable',
          'PNG, SVG, and clipboard image export require browser DOM capture and are unavailable in this native parity component.',
        ),
      );
    }, [t]);

    const handleFullscreenUnavailable = useCallback(() => {
      setNativeNotice(
        t(
          'chart.fullscreen.nativeUnavailable',
          'Browser fullscreen is unavailable in this native parity component.',
        ),
      );
    }, [t]);

    return (
      <View
        ref={mergedRef}
        accessible
        accessibilityLabel={`${title}. ${ariaLabel}`}
        accessibilityRole="summary"
        nativeID={titleId}
        style={[styles.root, style]}
        testID={testID ?? dataTestID ?? 'chart-container'}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <AppText
              nativeID={titleId}
              numberOfLines={2}
              style={styles.title}
              variant="caption"
              weight="semibold">
              {title}
            </AppText>
            {subtitle ? (
              <AppText numberOfLines={2} style={styles.subtitle} variant="caption">
                {subtitle}
              </AppText>
            ) : null}
          </View>

          <View
            accessibilityLabel={t('chart.toolbar', 'Chart actions')}
            accessibilityRole="toolbar"
            style={styles.toolbar}>
            {action}

            {annotationsEnabled ? (
              <>
                <ToolbarButton
                  glyph="+"
                  label={t('annotations.add', 'Add annotation')}
                  onPress={() => setPopoverOpen(true)}
                />
                <ToolbarButton
                  glyph={hidden ? 'OFF' : 'ON'}
                  label={
                    hidden
                      ? t('annotations.show', 'Show annotations')
                      : t('annotations.hide', 'Hide annotations')
                  }
                  onPress={toggleHidden}
                  selected={!hidden}
                />
              </>
            ) : null}

            {showExportMenu ? (
              <>
                {hasCsv ? (
                  <ToolbarButton
                    glyph="CSV"
                    label={t('chart.export.csv', 'Download data as CSV')}
                    onPress={handleCsv}
                  />
                ) : null}
                <ToolbarButton
                  glyph="EXP"
                  label={t('chart.export.menuLabel', 'Export chart')}
                  onPress={handleImageExportUnavailable}
                />
              </>
            ) : null}

            {fullscreen ? (
              <ToolbarButton
                glyph="FS"
                label={t('chart.fullscreen', 'Fullscreen chart')}
                onPress={handleFullscreenUnavailable}
              />
            ) : null}
          </View>
        </View>

        {showMarkerRow ? (
          <ScrollView
            accessibilityLabel={t(
              'annotations.markerRow',
              'Annotations on this chart',
            )}
            contentContainerStyle={styles.markerRow}
            horizontal
            showsHorizontalScrollIndicator={false}>
            {visibleAnnotations.map(ann => (
              <MarkerChip key={ann.id} annotation={ann} />
            ))}
          </ScrollView>
        ) : null}

        <View
          accessible
          accessibilityLabel={ariaLabel}
          accessibilityRole="image"
          style={[styles.chartBody, {height}]}>
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          ) : empty ? (
            <EmptyState
              title={t('chart.noDataTitle', 'No chart data')}
              message={t('chart.noData', 'No data available')}
            />
          ) : (
            <ChartHiddenSeriesContext.Provider value={hiddenSeries}>
              <NativeSectionErrorBoundary
                fallbackTitle={t(
                  'errors.section.chartTitle',
                  'This chart failed to load',
                )}
                name={`chart:${title}`}>
                {renderChildren()}
              </NativeSectionErrorBoundary>
            </ChartHiddenSeriesContext.Provider>
          )}
        </View>

        {nativeNotice ? (
          <View
            accessibilityRole="alert"
            style={styles.nativeNotice}
            testID="chart-native-unavailable-notice">
            <AppText style={styles.nativeNoticeText} variant="caption">
              {nativeNotice}
            </AppText>
          </View>
        ) : null}

        <View
          nativeID={fallbackId}
          style={styles.fallback}
          testID="chart-accessible-fallback">
          {ariaDescription ? (
            <AppText style={styles.description} variant="caption">
              {ariaDescription}
            </AppText>
          ) : null}

          {hasFallbackTable ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View
                accessibilityLabel={t(
                  'chart.a11y.fallbackTableLabel',
                  '{{title}} - data table',
                  {title},
                )}
                accessibilityRole="summary"
                style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeaderRow]}>
                  {columns.map(column => (
                    <AppText
                      key={column.key}
                      numberOfLines={1}
                      style={[styles.tableCell, styles.tableHeaderCell]}
                      variant="caption"
                      weight="semibold">
                      {column.label}
                    </AppText>
                  ))}
                </View>
                {rows.map((row, rowIndex) => (
                  <View key={`row-${rowIndex}`} style={styles.tableRow}>
                    {columns.map(column => (
                      <AppText
                        key={column.key}
                        numberOfLines={1}
                        style={styles.tableCell}
                        variant="caption">
                        {formatFallbackCell(row, column)}
                      </AppText>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : !ariaDescription ? (
            <AppText style={styles.description} variant="caption">
              {t('chart.a11y.summary', 'Chart: {{title}}', {title})}
            </AppText>
          ) : null}
        </View>

        {annotationsEnabled && fetchedAnnotations.length > 0 ? (
          <AnnotationList
            annotations={fetchedAnnotations}
            onRemove={handleRemoveAnnotation}
          />
        ) : null}

        {annotationsEnabled ? (
          <AddAnnotationPopover
            editableDate
            onAdd={handleAddAnnotation}
            onCancel={() => setPopoverOpen(false)}
            open={popoverOpen}
            timestamp={new Date().toISOString()}
          />
        ) : null}
      </View>
    );
  },
);

ChartContainer.displayName = 'ChartContainer';

export function useChartLabelAnchor(
  axis: 'x' | 'y',
): 'start' | 'middle' | 'end' {
  const dir = getLangDir(currentNativeLanguage());
  return textAnchorForDir(axis, dir);
}

interface ToolbarButtonProps {
  disabled?: boolean;
  glyph: string;
  label: string;
  onPress: () => void;
  selected?: boolean;
}

function ToolbarButton({
  disabled = false,
  glyph,
  label,
  onPress,
  selected = false,
}: ToolbarButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled, selected}}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({pressed}) => [
        styles.toolbarButton,
        selected && styles.toolbarButtonSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText
        numberOfLines={1}
        style={[styles.toolbarGlyph, selected && styles.toolbarGlyphSelected]}
        variant="caption"
        weight="bold">
        {glyph}
      </AppText>
    </Pressable>
  );
}

function MarkerChip({annotation}: {annotation: DataAnnotation}) {
  return (
    <View
      accessibilityLabel={`${annotation.label} annotation`}
      accessibilityRole="text"
      style={styles.markerChip}>
      <AppText style={styles.markerIcon} variant="caption" weight="bold">
        TG
      </AppText>
      <AppText numberOfLines={1} style={styles.markerLabel} variant="caption">
        {annotation.label}
      </AppText>
    </View>
  );
}

interface NativeSectionErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle: string;
  name: string;
}

interface NativeSectionErrorBoundaryState {
  errorMessage: string | null;
}

class NativeSectionErrorBoundary extends React.Component<
  NativeSectionErrorBoundaryProps,
  NativeSectionErrorBoundaryState
> {
  state: NativeSectionErrorBoundaryState = {errorMessage: null};

  static getDerivedStateFromError(error: unknown): NativeSectionErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  render(): ReactNode {
    if (this.state.errorMessage) {
      return (
        <View
          accessibilityRole="alert"
          style={styles.errorPanel}
          testID={`${this.props.name}-error`}>
          <AppText style={styles.errorTitle} weight="semibold">
            {this.props.fallbackTitle}
          </AppText>
          <AppText style={styles.errorMessage} variant="caption">
            {this.state.errorMessage}
          </AppText>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  chartBody: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  description: {
    color: colors.textMuted,
  },
  disabled: {
    opacity: 0.48,
  },
  errorMessage: {
    color: colors.textMuted,
  },
  errorPanel: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  errorTitle: {
    color: colors.danger,
  },
  fallback: {
    gap: spacing.sm,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  markerChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 180,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  markerIcon: {
    color: colors.accent,
    fontSize: 10,
    lineHeight: 14,
  },
  markerLabel: {
    color: colors.textSecondary,
    flex: 1,
    minWidth: 0,
  },
  markerRow: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  nativeNotice: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nativeNoticeText: {
    color: colors.warning,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.panel,
  },
  subtitle: {
    color: colors.textMuted,
  },
  table: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 320,
    overflow: 'hidden',
  },
  tableCell: {
    borderColor: colors.border,
    borderLeftWidth: 1,
    color: colors.textSecondary,
    minWidth: 112,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tableHeaderCell: {
    color: colors.textPrimary,
  },
  tableHeaderRow: {
    backgroundColor: colors.surfaceSelected,
  },
  tableRow: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  title: {
    color: colors.textPrimary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    maxWidth: '54%',
  },
  toolbarButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    minWidth: 32,
    paddingHorizontal: spacing.xs,
  },
  toolbarButtonSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  toolbarGlyph: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 14,
  },
  toolbarGlyphSelected: {
    color: colors.accent,
  },
});
