import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, MoreVertical, Tag, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { SectionErrorBoundary } from '@/components/feedback/SectionErrorBoundary';
import { Button } from '@/components/ui/Button';
import { useChartExport } from '@/hooks/useChartExport';
import { downloadCSV, objectsToCSV, defaultExportFilename, type CsvCellValue } from '@/lib/csvExport';
import { AnnotationList } from './AnnotationList';
import type { DataAnnotation } from '@/types/annotations';

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Show the PNG download button (also used as the trigger when only PNG is
   *  available). Combined with `exportData` it expands into a kebab menu. */
  exportable?: boolean;
  exportFilename?: string;
  /** Phase-40 / Prompt 31 — when set, exposes "Download data as CSV" in the
   *  chart's overflow menu. The data is serialized via `objectsToCSV`. */
  exportData?: ReadonlyArray<Record<string, CsvCellValue>>;
  /** When set, shows the annotation toggle button */
  annotations?: DataAnnotation[];
  /** Whether annotation mode is active (controlled) */
  isAnnotating?: boolean;
  /** Callback to toggle annotation mode */
  onAnnotateToggle?: () => void;
  /** Callback to remove an annotation */
  onRemoveAnnotation?: (id: string) => void;
}

export const ChartContainer = forwardRef<HTMLDivElement, ChartContainerProps>(
  function ChartContainer(
    {
      title, subtitle, loading, empty, height = 300, action, children, className,
      exportable, exportFilename, exportData,
      annotations, isAnnotating, onAnnotateToggle, onRemoveAnnotation,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { chartRef, exportPNG, exporting } = useChartExport(exportFilename);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuContainerRef = useRef<HTMLDivElement>(null);

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

    return (
      <div
        ref={mergedRef}
        className={cn(
          'group rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
          isAnnotating && 'ring-1 ring-blue-400/30',
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
            {onAnnotateToggle && (
              <button
                type="button"
                onClick={onAnnotateToggle}
                className={cn(
                  'rounded p-1 transition-all',
                  isAnnotating
                    ? 'text-blue-400 hover:text-blue-300'
                    : 'text-gray-400 opacity-0 hover:text-gray-600 group-hover:opacity-100 dark:text-white/30 dark:hover:text-white/50',
                )}
                aria-label={t('annotation.toggle', 'Toggle annotations')}
                title={
                  isAnnotating
                    ? t('annotation.clickChart', 'Click on chart to annotate')
                    : t('annotation.enable', 'Enable annotations')
                }
              >
                <Tag className="h-3.5 w-3.5" />
              </button>
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

        <div
          style={{ height }}
          className={cn('relative', isAnnotating && 'cursor-crosshair')}
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
              {children}
            </SectionErrorBoundary>
          )}
        </div>

        {annotations && annotations.length > 0 && onRemoveAnnotation && (
          <AnnotationList
            annotations={annotations}
            onRemove={onRemoveAnnotation}
          />
        )}
      </div>
    );
  },
);
