import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Plus, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ChartSkeleton } from '@/components/feedback/ChartSkeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryError } from '@/components/feedback/QueryError';
import { SectionErrorBoundary } from '@/components/feedback/SectionErrorBoundary';
import { Button, FullscreenButton, Heading, Text } from '@/components/ui';
import { VisuallyHidden } from '@/components/a11y';
import { useChartExport } from '@/hooks/useChartExport';
import { downloadCSV, objectsToCSV, defaultExportFilename, type CsvCellValue } from '@/lib/csvExport';
import { getLangDir, textAnchorForDir, type Direction } from '@/lib/i18nDir';
import { AnnotationList } from './AnnotationList';
import { AddAnnotationPopover } from './AddAnnotationPopover';
import { ChartExportMenu } from './ChartExportMenu';
import { ChartHiddenSeriesProvider } from './ChartHiddenSeriesContext';
import {
  chartViewportStyle,
  resolveChartHeights,
  type ChartSize,
} from './chartSizing';
import type { ChartSamplingDisclosure } from './chartSampling';
import {
  useChartAnnotationsAsData,
  useCreateAnnotation,
  useDeleteAnnotation,
} from '@/api/hooks/useAnnotations';
import type { AnnotationCategory, AnnotationScope, DataAnnotation } from '@/types/annotations';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';

/**
 * Annotation integration helper. When `annotations` is
 * supplied, `<ChartContainer>` fetches the matching rows from the backend,
 * adds an "Add annotation" + "Hide annotations" toggle to the header, manages
 * the AddAnnotationPopover modal, and renders the AnnotationList footer. The
 * chart consumer renders the actual `<ReferenceLine>` overlays via the
 * function-children render-prop pattern.
 */
export interface ChartAnnotationsConfig {
  vehicleId?: number | null;
  scope: AnnotationScope;
  /** Stable id for persisting the "Hide annotations" toggle. Defaults to title. */
  chartId?: string;
}

export interface ChartContainerRenderProps {
  annotations: DataAnnotation[];
  /** True when the user has toggled annotations off. Children should skip
   *  rendering `<ReferenceLine>`s in this case. */
  hidden: boolean;
  /**
   * URL-persisted hidden-series toggle state. Only
   * non-null when the surrounding `<ChartContainer>` was given a
   * `chartKey` prop (which both opts the chart into URL state AND sets up
   * a `<ChartHiddenSeriesContext>` for the legend). Pages typically wire
   * the returned state into `<Line hide={hiddenSeries?.isHidden('foo')}/>`.
   */
  hiddenSeries: HiddenSeriesState | null;
}

type ChartContainerChildren =
  | React.ReactNode
  | ((ctx: ChartContainerRenderProps) => React.ReactNode);

export interface ChartContainerProps {
  title: string;
  /**
   * `embedded` removes panel chrome and the visible title bar while retaining
   * loading/error/empty states, chart semantics, and the fallback data table.
   * Use through `<EmbeddedChart>` inside an existing widget or panel shell.
   */
  variant?: 'panel' | 'embedded';
  /** Optional decorative title icon. */
  icon?: React.ReactNode;
  subtitle?: string;
  /**
   * Presentation metadata shared by every chart frame. Values are already
   * localized at the call site because this component cannot infer a
   * vehicle timezone, display unit, or API freshness policy.
   */
  metadata?: ChartMetadata;
  loading?: boolean;
  empty?: boolean;
  /** Initial query failure. Cached-refresh failures should keep rendering data instead. */
  error?: unknown;
  onRetry?: () => void;
  /** Semantic responsive height preset. Defaults to `standard`. */
  size?: ChartSize;
  /** Desktop height override. Prefer `size` for new charts. */
  height?: number;
  /** Mobile height override; otherwise the selected size preset is used. */
  mobileHeight?: number;
  /** Fill the available host height instead of applying a fixed size preset. */
  fluid?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyDescription?: string;
  /** Optional empty-state illustration rendered inside the chart viewport. */
  emptyIcon?: React.ReactNode;
  /** Imperative empty-state recovery action. */
  emptyAction?: { label: string; onClick: () => void };
  /** Navigation empty-state recovery action; takes priority over `emptyAction`. */
  emptyActionTo?: { label: string; to: string };
  action?: React.ReactNode;
  children: ChartContainerChildren;
  className?: string;
  /**
   * Render the `<ChartExportMenu>` (PNG / SVG /
   * Copy-image, plus CSV when `exportData` is supplied) in the title-bar
   * action area.
   * Defaults to `true` because every `<ChartContainer>` ships with a
   * mandatory `ariaLabel`, which is the same
   * "is this chart shareable?" precondition the export menu checks.
   * Pass `exportable={false}` to explicitly opt out (e.g. for tour
   * step-throughs or print-only contexts).
   * The menu is also auto-hidden while the chart is in `loading` or
   * `empty` states because there's no captured image worth sharing yet.
   */
  exportable?: boolean;
  exportFilename?: string;
  /** When set, exposes "Download data as CSV" in the
   *  chart's overflow menu. The data is serialized via `objectsToCSV`. */
  exportData?: ReadonlyArray<Record<string, CsvCellValue>>;
  /** When set, the container takes ownership of the
   *  full annotation flow (fetch, add, delete, hide). Children should be a
   *  function so they can read the visible annotations from context. */
  annotations?: ChartAnnotationsConfig;
  /**
   * Required accessible name for the chart figure.
   * Recharts SVGs are otherwise an opaque "graphics-document" to assistive
   * tech. Pass a one-sentence description such as
   * `"Daily energy use over the last 30 days"` so a screen-reader user
   * hears one short summary instead of dozens of axis labels in series
   * order.
   * `audit:chart-a11y` (chained from `npm run lint`) fails the build if
   * any `<ChartContainer>` JSX site is missing this prop.
   */
  ariaLabel: string;
  /**
   * Optional long description, e.g.
   * `"Battery voltage ranged 380–410 V over the last 7 days, dipping
   *  every night around 03:00."`. Wired to `aria-describedby` on the
   * figure so SR users hear the prose summary right after the title.
   */
  ariaDescription?: string;
  /**
   * Series rows for the screen-reader/forced-colors
   * fallback `<table>`. When supplied the container renders a
   * visually-hidden table (exposed in `forced-colors:` mode and to
   * every assistive technology) carrying the same data the chart
   * displays. Combine with `dataColumns` to pick the visible columns
   * and their formatters.
   * When `data` is omitted the audit requires a
   * `// chart-a11y:no-table` comment justifying the absence (used for
   * heatmaps, scatter clouds with thousands of points, etc.).
   */
  data?: ReadonlyArray<ChartDataRow>;
  /**
   * Column definitions for the fallback table. Required when `data`
   * is set. `format` is unit-aware and runs once per cell; default
   * stringifies the raw value.
   */
  dataColumns?: ReadonlyArray<ChartDataColumn>;
  /**
   * When `true`, a `<FullscreenButton>` is
   * rendered in the chart toolbar (data-html2canvas-ignore'd along
   * with the rest of the action buttons so it never bleeds into
   * exported PNGs). Click expands the entire `<figure>` to the
   * browser viewport via the standard Fullscreen API. Esc, the
   * browser's own exit button, and a second click on the toolbar
   * button all return the chart to its original size.
   * The accompanying `:fullscreen` rule in `web/src/index.css`
   * grows the inner chart canvas so axis labels stay readable on
   * a 27" monitor; Recharts auto re-measures via its built-in
   * ResizeObserver so consumers don't need to wire anything else.
   */
  fullscreen?: boolean;
  /**
   * Stable identifier used for URL-persisted
   * legend-toggle state. When set, `<ChartContainer>` calls
   * `useHiddenSeries(chartKey)` and exposes the resulting state both
   * via the function-children render-prop (`{ hiddenSeries }`) and
   * via `<ChartHiddenSeriesContext>` so a context-aware `<ChartLegend>`
   * inside the chart can toggle series without explicit prop passing.
   * Pages typically use the render-prop form to wire `hide={…}` on
   * each `<Line>`/`<Bar>`/`<Area>` because Recharts traverses its
   * direct children synchronously and won't see hooks in arbitrary
   * wrapper components.
   * The audit script `audit:chart-legend` warns when a chart with
   * ≥ 2 line/bar/area series is missing this prop.
   */
  chartKey?: string;
}

export interface ChartMetadata {
  /** Human-readable time window, for example "Apr 1–30 · vehicle time". */
  rangeLabel?: string;
  /** Human-readable source, for example "Fleet telemetry". */
  sourceLabel?: string;
  /** Human-readable freshness, for example "Updated 2 min ago". */
  freshnessLabel?: string;
  /** Semantic freshness state for styling/audits without parsing prose. */
  freshness?: 'fresh' | 'stale' | 'unknown';
  /** Display-unit label used by the visible axes/tooltips. */
  unitLabel?: string;
  /** Honest disclosure for a rendering-only downsampled series. */
  sampling?: ChartSamplingDisclosure;
}

/**
 * Row shape accepted by the fallback
 * `<table>`. Keys must match the `key`s declared in `dataColumns`.
 * Values may be `null` (rendered as the i18n empty marker) so a
 * sparse time-series doesn't hide gaps from SR users.
 */
export type ChartDataRow = Record<string, string | number | null | undefined>;

export interface ChartDataColumn {
  /** Row key to read. */
  key: string;
  /** Visible column header. Pre-localized at the call site. */
  label: string;
  /**
   * Optional formatter — typically `(v) => formatKWh(v as number)` so
   * the table reads in the same units the visible chart axes use.
   * When omitted, values are coerced to string and `null`/`undefined`
   * is rendered as `—`.
   */
  format?: (value: unknown) => string;
}

const HIDDEN_STORAGE_PREFIX = 'teslasync-annotations-hidden:';

function readHiddenPref(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HIDDEN_STORAGE_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function writeHiddenPref(key: string, hidden: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (hidden) {
      window.localStorage.setItem(HIDDEN_STORAGE_PREFIX + key, '1');
    } else {
      window.localStorage.removeItem(HIDDEN_STORAGE_PREFIX + key);
    }
  } catch {
    // localStorage unavailable / quota — silently degrade.
  }
}

function isFunctionChildren(
  c: ChartContainerChildren,
): c is (ctx: ChartContainerRenderProps) => React.ReactNode {
  return typeof c === 'function';
}

export const ChartContainer = forwardRef<HTMLDivElement, ChartContainerProps>(
  function ChartContainer(
    {
      title,
      variant = 'panel',
      icon,
      subtitle,
      metadata,
      loading,
      empty,
      error,
      onRetry,
      size = 'standard',
      height,
      mobileHeight,
      fluid = false,
      emptyTitle,
      emptyMessage,
      emptyDescription,
      emptyIcon,
      emptyAction,
      emptyActionTo,
      action,
      children,
      className,
      exportable, exportFilename, exportData,
      annotations: annotationsConfig,
      ariaLabel,
      ariaDescription,
      data,
      dataColumns,
      fullscreen,
      chartKey,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { chartRef, exportPNG, exportSVG, copyToClipboard, exporting } =
      useChartExport(exportFilename ?? title);
    // Separate ref for the figure node used
    // by the optional `<FullscreenButton>`. We can't reuse
    // `chartRef` directly because `useChartExport` owns the lifecycle
    // of that ref (it's typed as private to that hook), and we'd
    // rather not couple the fullscreen primitive to an internal
    // implementation detail of the export hook.
    const figureRef = useRef<HTMLElement | null>(null);
    const resolvedHeights = resolveChartHeights(size, height, mobileHeight);
    const chartHeightStyle = chartViewportStyle(resolvedHeights) as CSSProperties;

    // Stable ids for figure ↔ figcaption wiring.
    const reactId = useId();
    const titleId = `chart-title-${reactId}`;
    const fallbackId = `chart-fallback-${reactId}`;

    // ── Annotation state (only active when annotationsConfig is supplied) ──
    const annotationsEnabled = annotationsConfig != null;
    const annotationKey = annotationsConfig?.chartId ?? title;
    const [hidden, setHidden] = useState(() => readHiddenPref(annotationKey));
    const [popoverOpen, setPopoverOpen] = useState(false);

    useEffect(() => {
      if (annotationsEnabled) setHidden(readHiddenPref(annotationKey));
    }, [annotationsEnabled, annotationKey]);

    const { annotations: fetchedAnnotations } = useChartAnnotationsAsData(
      {
        vehicleId: annotationsConfig?.vehicleId,
        scope: annotationsConfig?.scope,
        enabled: annotationsEnabled,
      },
    );
    const createMutation = useCreateAnnotation();
    const deleteMutation = useDeleteAnnotation();

    // The visible list collapses to empty whenever the user has toggled the
    // overlay off, so children that render `<ReferenceLine>`s naturally show
    // nothing without needing to special-case the flag themselves.
    const visibleAnnotations = useMemo<DataAnnotation[]>(
      () => (annotationsEnabled && !hidden ? fetchedAnnotations : []),
      [annotationsEnabled, hidden, fetchedAnnotations],
    );

    const toggleHidden = useCallback(() => {
      setHidden((prev) => {
        const next = !prev;
        writeHiddenPref(annotationKey, next);
        return next;
      });
    }, [annotationKey]);

    const handleAddAnnotation = useCallback(
      (label: string, category: AnnotationCategory, description?: string, occurredAt?: string) => {
        if (!annotationsEnabled || !annotationsConfig) return;
        if (!occurredAt) return;
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
      [annotationsEnabled, annotationsConfig, createMutation],
    );

    const handleRemoveAnnotation = useCallback(
      (id: string) => {
        const numeric = Number(id);
        if (!Number.isFinite(numeric) || numeric <= 0) return;
        deleteMutation.mutate(numeric);
      },
      [deleteMutation],
    );

    const mergedRef = useCallback(
      (node: HTMLDivElement | null) => {
        figureRef.current = node;
        (chartRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref, chartRef],
    );

    const handleCsv = useCallback(() => {
      if (!exportData || exportData.length === 0) return;
      const filename = exportFilename ?? defaultExportFilename(title.toLowerCase().replace(/\s+/g, '-') || 'chart');
      downloadCSV(filename, objectsToCSV(exportData));
    }, [exportData, exportFilename, title]);

    const hasCsv = !!exportData && exportData.length > 0;
    const exportableResolved = exportable !== false;
    // Hide the export menu entirely while there is nothing to capture.
    // CSV-only exports stay available because they don't need the chart
    // DOM, but the image actions only make sense once the chart is
    // actually rendered with data.
    const showExportMenu = exportableResolved && !loading && !error && !empty;

    // `childrenContent` is a function of the
    // resolved `hiddenSeries` state because the function-children
    // render-prop receives it. Non-function children ignore the parameter.
    const renderChildren = (hiddenSeries: HiddenSeriesState | null) =>
      isFunctionChildren(children)
        ? children({ annotations: visibleAnnotations, hidden, hiddenSeries })
        : children;

    // Does the caller supply enough info to
    // render the SR/forced-colors fallback table? When `data` is set
    // we always render `<table>`; otherwise we fall back to the
    // `ariaDescription` prose alone (or just the title).
    const hasFallbackTable = !!(
      data &&
      data.length > 0 &&
      dataColumns &&
      dataColumns.length > 0
    );

    // Mobile-collapsed annotation marker row. Renders above the chart on
    // viewports ≤ 640px (Tailwind `sm` breakpoint) so the vertical reference
    // lines never hide the chart line on small screens. The chart consumer's
    // function-children still receive the full `visibleAnnotations` so the
    // ReferenceLines also render — Tailwind's `hidden sm:block` on the chart
    // wrapper is intentionally NOT used because the data must remain visible.
    const showMarkerRow =
      annotationsEnabled && !hidden && visibleAnnotations.length > 0;

    return (
      <figure
        ref={mergedRef}
        data-print-card
        aria-labelledby={titleId}
        aria-describedby={fallbackId}
        aria-busy={loading || undefined}
        data-chart-size={size}
        data-chart-key={chartKey}
        data-chart-variant={variant}
        data-chart-fluid={fluid || undefined}
        data-chart-state={loading ? 'loading' : error ? 'error' : empty ? 'empty' : 'ready'}
        data-chart-freshness={metadata?.freshness}
        className={cn(
          // Chart frames are panels too: resolve them from the same panel
          // surface contract as GlassPanel and Card (index.css → PANEL
          // SURFACE). Previously pinned to `bg-white dark:bg-gray-900`, which
          // ignored the active theme entirely — on all 140 presets a chart
          // frame rendered generic white/near-black instead of the palette's
          // own surface, so charts never matched the panels beside them.
          variant === 'embedded'
            ? cn(
                'group m-0 border-0 bg-transparent p-0 shadow-none',
                fluid && 'h-full min-h-0 max-h-full',
              )
            : 'group rounded-panel border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-panel',
          // Tailwind preflight already removes default <figure> margins;
          // re-state `m-0` defensively so any consumer override of preflight
          // doesn't shift the chart vertical rhythm.
          variant === 'panel' && 'm-0',
          'print:break-inside-avoid print:border-gray-300 print:bg-white',
          // Windows High Contrast / forced-colors mode.
          // Pin the chart-container boundary to a system colour so the
          // chart frame remains perceivable when the alpha border collapses
          // to transparent. Recharts SVG strokes get their own
          // forced-colors overrides via the global rules in `index.css`
          // (axis ticks / grid lines / legend text → `CanvasText`).
          'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
          // Grid and flex items default to min-width:auto, allowing an SVG's
          // intrinsic width to enlarge the entire page. Keep every chart frame
          // inside its assigned track instead.
          'min-w-0 max-w-full',
          className,
        )}
      >
        {variant === 'embedded' ? (
          <>
            <VisuallyHidden as="h3" id={titleId}>
              {title}
            </VisuallyHidden>
            {subtitle && (
              <VisuallyHidden as="p">
                {subtitle}
              </VisuallyHidden>
            )}
          </>
        ) : (
          <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && (
              <span
                className="mt-0.5 inline-flex shrink-0 text-[var(--theme-primary)]"
                aria-hidden="true"
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <Heading level="panel" id={titleId}>
                {title}
              </Heading>
              {subtitle && (
                <Text as="p" variant="caption" className="mt-1 leading-relaxed">{subtitle}</Text>
              )}
              {(metadata?.rangeLabel || metadata?.sourceLabel || metadata?.freshnessLabel || metadata?.unitLabel) && (
                <Text
                  as="p"
                  variant="caption"
                  className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5"
                  data-chart-metadata
                >
                  {metadata.rangeLabel && <span data-chart-range>{metadata.rangeLabel}</span>}
                  {metadata.sourceLabel && <span data-chart-source>{metadata.sourceLabel}</span>}
                  {metadata.freshnessLabel && (
                    <span data-chart-freshness-label>{metadata.freshnessLabel}</span>
                  )}
                  {metadata.unitLabel && <span data-chart-unit>{metadata.unitLabel}</span>}
                </Text>
              )}
            </div>
          </div>
          <div
            className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto"
            // Exclude the title-bar action toolbar
            // (annotation buttons, export menu, page-supplied actions)
            // from the chart capture so the exported PNG/clipboard image
            // shows only the chart visualisation, not the buttons used
            // to invoke the export.
            data-html2canvas-ignore="true"
          >
            {action}

            {annotationsEnabled && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !p-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setPopoverOpen(true)}
                  aria-label={t('annotations.add', 'Add annotation')}
                  title={t('annotations.add', 'Add annotation')}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    '!h-7 !w-7 !p-0',
                    hidden
                      ? 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                      : 'text-blue-400 hover:text-blue-300',
                  )}
                  icon={hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  onClick={toggleHidden}
                  aria-pressed={hidden}
                  aria-label={
                    hidden
                      ? t('annotations.show', 'Show annotations')
                      : t('annotations.hide', 'Hide annotations')
                  }
                  title={
                    hidden
                      ? t('annotations.show', 'Show annotations')
                      : t('annotations.hide', 'Hide annotations')
                  }
                />
              </>
            )}

            {showExportMenu && (
              <ChartExportMenu
                onExportPNG={exportPNG}
                onExportSVG={exportSVG}
                onCopyImage={copyToClipboard}
                onExportCsv={hasCsv ? handleCsv : undefined}
                busy={exporting}
              />
            )}

            {fullscreen && <FullscreenButton targetRef={figureRef} />}
          </div>
          </div>
        )}

        {showMarkerRow && (
          <div
            className="mb-2 flex flex-wrap gap-1.5 sm:hidden"
            aria-label={t('annotations.markerRow', 'Annotations on this chart')}
          >
            {visibleAnnotations.map((ann) => (
              <span
                key={ann.id}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-0.5 text-2xs text-[var(--text-secondary)]"
                title={ann.description ?? ann.label}
              >
                <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                {ann.label}
              </span>
            ))}
          </div>
        )}

        <div
          style={chartHeightStyle}
          data-chart-viewport="bounded"
          className={cn(
            // Recharts' ResponsiveContainer measures this viewport. Width,
            // overflow, and size containment ensure the measured child can
            // never feed a larger intrinsic size back into its own ancestor.
            'relative w-full min-w-0 max-w-full overflow-hidden [contain:layout_size]',
            fluid
              ? cn(
                  'h-full min-h-[var(--chart-height-mobile)] max-h-full',
                  'sm:min-h-[var(--chart-height-desktop)]',
                )
              : cn(
                  'h-[var(--chart-height-mobile)] min-h-[var(--chart-height-mobile)] max-h-[var(--chart-height-mobile)]',
                  'sm:h-[var(--chart-height-desktop)] sm:min-h-[var(--chart-height-desktop)] sm:max-h-[var(--chart-height-desktop)]',
                ),
            // In Windows High Contrast / forced-colors
            // mode the SVG strokes collapse to a small palette of system
            // colours and the multi-series chart becomes illegible. Hide
            // the SVG entirely there and rely on the `<figcaption>` table
            // fallback below for both forced-colors users and screen
            // readers.
            'forced-colors:hidden',
          )}
          // Charts with toggleable legends contain focusable controls, which
          // cannot live inside role="img". Expose those viewports as named
          // groups while static charts retain image semantics.
          role={loading || error || empty ? undefined : chartKey ? 'group' : 'img'}
          aria-label={loading || error || empty ? undefined : ariaLabel}
        >
          {loading ? (
            <ChartSkeleton
              className="h-full"
              label={t('chart.loading', 'Loading chart…')}
            />
          ) : error ? (
            <QueryError
              error={error}
              onRetry={onRetry}
              compact
              className="h-full"
            />
          ) : empty ? (
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle}
              message={emptyMessage ?? t('chart.noData', 'No data available')}
              description={
                emptyDescription
                ?? t(
                  'chart.noDataDescription',
                  'No chartable observations are available for the current selection yet.',
                )
              }
              action={emptyAction}
              actionTo={emptyActionTo}
              className="h-full py-8"
            />
          ) : (
            <ChartHiddenSeriesProvider chartKey={chartKey}>
              {(hiddenSeries) => (
                <SectionErrorBoundary
                  name={`chart:${title}`}
                  fallbackTitle={t('errors.section.chartTitle', 'This chart failed to load')}
                >
                  {renderChildren(hiddenSeries)}
                </SectionErrorBoundary>
              )}
            </ChartHiddenSeriesProvider>
          )}
        </div>

        {metadata?.sampling?.sampled && (
          <Text as="p" variant="caption" className="mt-2" data-chart-sampling>
            {t(
              'chart.sampling.disclosure',
              'Showing {{rendered}} of {{source}} observations for display.',
              {
                rendered: metadata.sampling.renderedCount,
                source: metadata.sampling.sourceCount,
              },
            )}
          </Text>
        )}

        {/*
          Accessible chart fallback.

          Visually hidden by default so sighted users see no change, but:
            - exposed to every assistive technology (screen readers,
              voice control, refreshable Braille) via the `<figcaption>`
              role under the figure;
            - revealed in `forced-colors:` mode so Windows High
              Contrast users get a legible table where the SVG would
              otherwise have collapsed to monochrome line noise.

          Always rendered (never conditional) so `aria-describedby` on
          the figure resolves to a stable target. When the caller has
          opted out via `// chart-a11y:no-table`, only the
          `ariaDescription` prose appears here.
        */}
        <VisuallyHidden
          as="figcaption"
          id={fallbackId}
          className={cn(
            'forced-colors:not-sr-only forced-colors:block',
            'forced-colors:mt-3 forced-colors:p-2',
            'forced-colors:border forced-colors:border-[CanvasText]',
          )}
        >
          {ariaDescription && (
            <p className="forced-colors:mb-2 forced-colors:text-[CanvasText]">
              {ariaDescription}
            </p>
          )}
          {metadata?.sampling?.sampled && (
            <p>
              {t(
                'chart.sampling.a11yDisclosure',
                'Visual series is sampled: {{rendered}} of {{source}} observations are rendered.',
                {
                  rendered: metadata.sampling.renderedCount,
                  source: metadata.sampling.sourceCount,
                },
              )}
            </p>
          )}
          {hasFallbackTable ? (
            <table
              className={cn(
                'w-full border-collapse text-xs',
                'forced-colors:text-[CanvasText]',
              )}
            >
              <caption className="text-left">
                {t('chart.a11y.fallbackTableLabel', '{{title}} — data table', {
                  title,
                })}
              </caption>
              <thead>
                <tr>
                  {dataColumns!.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        'border border-[var(--panel-border)] px-2 py-1 text-left font-medium',
                        'forced-colors:border-[CanvasText]',
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.map((row, i) => (
                  <tr key={i}>
                    {dataColumns!.map((col) => {
                      const raw = row[col.key];
                      const cell =
                        col.format != null
                          ? col.format(raw)
                          : raw == null
                            ? '—'
                            : String(raw);
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'border border-[var(--panel-border)] px-2 py-1',
                            'forced-colors:border-[CanvasText]',
                          )}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !ariaDescription ? (
            // Neither a structured table nor a long description — fall
            // back to the bare summary so SR users still hear something
            // when they navigate to the figcaption.
            <p>{t('chart.a11y.summary', 'Chart: {{title}}', { title })}</p>
          ) : null}
        </VisuallyHidden>

        {annotationsEnabled && fetchedAnnotations.length > 0 && (
          <AnnotationList
            annotations={fetchedAnnotations}
            onRemove={handleRemoveAnnotation}
          />
        )}

        {annotationsEnabled && (
          <AddAnnotationPopover
            open={popoverOpen}
            timestamp={new Date().toISOString()}
            editableDate
            onAdd={handleAddAnnotation}
            onCancel={() => setPopoverOpen(false)}
          />
        )}
      </figure>
    );
  },
);

/**
 * Chart label-anchor hook.
 * Resolves the writing direction from the active i18n language and
 * returns the SVG `text-anchor` value for a Recharts axis label so
 * that consumers don't have to thread direction state through every
 * chart prop.
 * Usage:
 *   const anchor = useChartLabelAnchor('y');
 *   <YAxis tick={{ textAnchor: anchor }} />
 * Mirrors `textAnchorForDir` from `@/lib/i18nDir`; the bare helper
 * is also re-exported here so chart authors get both the hook (for
 * components) and the pure helper (for tests / non-React call sites)
 * from a single import path.
 */
export function useChartLabelAnchor(axis: 'x' | 'y'): 'start' | 'middle' | 'end' {
  const { i18n } = useTranslation();
  const dir: Direction = getLangDir(i18n.language);
  return textAnchorForDir(axis, dir);
}

export { textAnchorForDir } from '@/lib/i18nDir';