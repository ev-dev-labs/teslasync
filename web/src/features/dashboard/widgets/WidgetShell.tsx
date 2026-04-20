import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton, QueryError } from '@/components/feedback';

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
}

export function WidgetShell({ title, icon, loading, error, children, noPadding, actions }: WidgetShellProps) {
  if (loading) return <Skeleton className="h-full rounded-xl" />;
  if (error) return (
    <div className="h-full flex items-center justify-center p-4">
      <QueryError error={new Error(error)} />
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {title && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-1.5">
            {icon}
            <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{title}</h3>
          </div>
          {actions}
        </div>
      )}
      <div className={cn('flex-1 min-h-0', !noPadding ? 'px-4 pb-3 overflow-auto' : 'overflow-hidden')}>
        {children}
      </div>
    </div>
  );
}
