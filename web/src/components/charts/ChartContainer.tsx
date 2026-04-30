import { forwardRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Tag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/Button';
import { useChartExport } from '@/hooks/useChartExport';
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
  exportable?: boolean;
  exportFilename?: string;
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
      exportable, exportFilename,
      annotations, isAnnotating, onAnnotateToggle, onRemoveAnnotation,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { chartRef, exportPNG, exporting } = useChartExport(exportFilename);

    const mergedRef = useCallback(
      (node: HTMLDivElement | null) => {
        (chartRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref, chartRef],
    );

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
            {exportable && (
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
            children
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
