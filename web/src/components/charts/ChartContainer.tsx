import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download, MoreVertical, Tag, FileSpreadsheet, Image as ImageIcon, Plus, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { SectionErrorBoundary } from '@/components/feedback/SectionErrorBoundary';
import { Button } from '@/components/ui/Button';
import { useChartExport } from '@/hooks/useChartExport';
import { downloadCSV, objectsToCSV, defaultExportFilename, type CsvCellValue } from '@/lib/csvExport';
import { AnnotationList } from './AnnotationList';
import { AddAnnotationPopover } from './AddAnnotationPopover';
import {
  useChartAnnotationsAsData,
  useCreateAnnotation,
  useDeleteAnnotation,
} from '@/api/hooks/useAnnotations';
import type { AnnotationCategory, AnnotationScope, DataAnnotation } from '@/types/annotations';

/**
 * Phase 40 / Prompt 43 — annotation integration helper. When `annotations` is
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
}

type ChartContainerChildren =
  | React.ReactNode
  | ((ctx: ChartContainerRenderProps) => React.ReactNode);

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  action?: React.ReactNode;
  children: ChartContainerChildren;
  className?: string;
  /** Show the PNG download button (also used as the trigger when only PNG is
   *  available). Combined with `exportData` it expands into a kebab menu. */
  exportable?: boolean;
  exportFilename?: string;
  /** Phase-40 / Prompt 31 — when set, exposes "Download data as CSV" in the
   *  chart's overflow menu. The data is serialized via `objectsToCSV`. */
  exportData?: ReadonlyArray<Record<string, CsvCellValue>>;
  /** Phase-40 / Prompt 43 — when set, the container takes ownership of the
   *  full annotation flow (fetch, add, delete, hide). Children should be a
   *  function so they can read the visible annotations from context. */
  annotations?: ChartAnnotationsConfig;
  /**
   * Phase-45 / Prompt 13 — accessible description of the chart content.
   *
   * Recharts SVGs are otherwise an opaque "graphics-document" to assistive
   * tech. This wraps the chart body in `role="img"` + `aria-label` so a
   * screen-reader user hears one short summary instead of dozens of axis
   * labels in series order.
   *
   * Pass a one-sentence description such as
   * `"Line chart showing daily energy use over the last 30 days"`. When
   * omitted, falls back to the existing `title` prop so the chart is at
   * least announced as `Chart: {title}`.
   */
  ariaLabel?: string;
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
      title, subtitle, loading, empty, height = 300, action, children, className,
      exportable, exportFilename, exportData,
      annotations: annotationsConfig,
      ariaLabel,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { chartRef, exportPNG, exporting } = useChartExport(exportFilename);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuContainerRef = useRef<HTMLDivElement>(null);

    // ── Annotation state (only active when annotationsConfig is supplied) ──
    const annotationsEnabled = annotationsConfig != null;
    const annotationKey = annotationsConfig?.chartId ?? title;
    const [hidden, setHidden] = useState(() => readHiddenPref(annotationKey));
    const [popoverOpen, setPopoverOpen] = useState(false);

    useEffect(() => {
      if (annotationsEnabled) setHidden(readHiddenPref(annotationKey));
    }, [annotationsEnabled, annotationKey]);

    const { annotations: fetchedAnnotations } = useChartAnnotationsAsData(
      annotationsEnabled
        ? { vehicleId: annotationsConfig?.vehicleId, scope: annotationsConfig?.scope }
        : {},
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
        (chartRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref, chartRef],
    );

    // Close the dropdown on outside click / Escape.
    useEffect(() => {
      if (!menuOpen) return;
      const onClickOutside = (e: MouseEvent) => {
        if (!menuContainerRef.current?.contains(e.target as Node)) setMenuOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setMenuOpen(false);
      };
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onClickOutside);
        document.removeEventListener('keydown', onKey);
      };
    }, [menuOpen]);

    const handleCsv = useCallback(() => {
      if (!exportData || exportData.length === 0) return;
      const filename = exportFilename ?? defaultExportFilename(title.toLowerCase().replace(/\s+/g, '-') || 'chart');
      downloadCSV(filename, objectsToCSV(exportData));
      setMenuOpen(false);
    }, [exportData, exportFilename, title]);

    const handlePng = useCallback(() => {
      void exportPNG();
      setMenuOpen(false);
    }, [exportPNG]);

    const hasCsv = !!exportData && exportData.length > 0;
    const hasPng = !!exportable;
    const showMenu = hasCsv && hasPng;
    const showCsvOnly = hasCsv && !hasPng;
    const showPngOnly = hasPng && !hasCsv;

    const childrenContent = isFunctionChildren(children)
      ? children({ annotations: visibleAnnotations, hidden })
      : children;

    // Mobile-collapsed annotation marker row. Renders above the chart on
    // viewports ≤ 640px (Tailwind `sm` breakpoint) so the vertical reference
    // lines never hide the chart line on small screens. The chart consumer's
    // function-children still receive the full `visibleAnnotations` so the
    // ReferenceLines also render — Tailwind's `hidden sm:block` on the chart
    // wrapper is intentionally NOT used because the data must remain visible.
    const showMarkerRow =
      annotationsEnabled && !hidden && visibleAnnotations.length > 0;

    return (
      <div
        ref={mergedRef}
        data-print-card
        className={cn(
          'group rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
          'print:break-inside-avoid print:border-gray-300 print:bg-white',
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {action}

            {annotationsEnabled && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !p-0 text-gray-400 hover:text-gray-600 dark:text-white/30 dark:hover:text-white/60"
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
                      ? 'text-gray-300 hover:text-gray-500 dark:text-white/20 dark:hover:text-white/40'
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

            {showPngOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="!h-7 !w-7 !p-0 text-gray-400 hover:text-gray-600 dark:text-white/30 dark:hover:text-white/60"
                icon={<Download className="h-3.5 w-3.5" />}
                loading={exporting}
                onClick={exportPNG}
                aria-label={t('chart.export', 'Export as PNG')}
              />
            )}

            {showCsvOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="!h-7 !w-7 !p-0 text-gray-400 hover:text-gray-600 dark:text-white/30 dark:hover:text-white/60"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={handleCsv}
                aria-label={t('chart.exportCsv', 'Download chart data as CSV')}
              />
            )}

            {showMenu && (
              <div ref={menuContainerRef} className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !p-0 text-gray-400 hover:text-gray-600 dark:text-white/30 dark:hover:text-white/60"
                  icon={<MoreVertical className="h-3.5 w-3.5" />}
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t('chart.menu.open', 'Chart options')}
                />
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label={t('chart.menu.label', 'Chart options')}
                    className={cn(
                      'absolute right-0 z-30 mt-1 w-52 rounded-lg p-1',
                      'border border-white/[0.08] bg-[var(--surface-elevated)] shadow-xl',
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleCsv}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                        'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
                        'focus-visible:outline-none focus-visible:bg-white/[0.06]',
                      )}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('chart.menu.downloadCsv', 'Download data as CSV')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handlePng}
                      disabled={exporting}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                        'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
                        'focus-visible:outline-none focus-visible:bg-white/[0.06]',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                    >
                      <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('chart.menu.downloadPng', 'Download as PNG')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {showMarkerRow && (
          <div
            className="mb-2 flex flex-wrap gap-1.5 sm:hidden"
            aria-label={t('annotations.markerRow', 'Annotations on this chart')}
          >
            {visibleAnnotations.map((ann) => (
              <span
                key={ann.id}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60"
                title={ann.description ?? ann.label}
              >
                <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                {ann.label}
              </span>
            ))}
          </div>
        )}

        <div
          style={{ height }}
          className="relative"
          // Phase-45 / Prompt 13 — give Recharts SVGs a single accessible
          // name so screen-reader users hear one summary instead of dozens
          // of axis labels read in series order.
          role="img"
          aria-label={ariaLabel ?? t('a11y.chartFigure', 'Chart: {{title}}', { title })}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="md" />
            </div>
          ) : empty ? (
            <EmptyState message="No data available" />
          ) : (
            <SectionErrorBoundary
              name={`chart:${title}`}
              fallbackTitle={t('errors.section.chartTitle', 'This chart failed to load')}
            >
              {childrenContent}
            </SectionErrorBoundary>
          )}
        </div>

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
      </div>
    );
  },
);
