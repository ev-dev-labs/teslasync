import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs';
import { CopyLinkButton } from './CopyLinkButton';
import { Spinner } from '@/components/feedback/Spinner';
import { PageErrorBoundary } from '@/components/feedback/PageErrorBoundary';

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  breadcrumbs?: BreadcrumbItem[];
  children: ReactNode;
  className?: string;
  /**
   * Show a "Copy link" button next to actions that copies the current URL
   * (with all query params) to the clipboard. Use on pages where users would
   * reasonably share a filtered view. Phase 40 / Prompt 33.
   */
  copyLink?: boolean;
}

export function PageContainer({
  title, subtitle, actions, loading, error, empty, emptyMessage, breadcrumbs, children, className, copyLink,
}: PageContainerProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {breadcrumbs && breadcrumbs.length > 1 && (
        <Breadcrumbs items={breadcrumbs} className="mb-2" />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {(actions || copyLink) && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {copyLink && <CopyLinkButton />}
            {actions}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-gray-500">{emptyMessage ?? `No ${title.toLowerCase()} found.`}</p>
        </div>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </div>
  );
}
