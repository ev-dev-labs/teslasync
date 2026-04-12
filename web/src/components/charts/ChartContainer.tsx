import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const ChartContainer = forwardRef<HTMLDivElement, ChartContainerProps>(
  function ChartContainer(
    { title, subtitle, loading, empty, height = 300, action, children, className },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
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
          {action && <div>{action}</div>}
        </div>

        <div style={{ height }} className="relative">
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
      </div>
    );
  },
);
