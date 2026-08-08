import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { ExplorerSectionState } from './types';

interface ExplorerSectionBodyProps {
  state: ExplorerSectionState;
  children: ReactNode;
  className?: string;
}

export function ExplorerSectionBody({
  state,
  children,
  className,
}: ExplorerSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-48', className);

  if (state.error) {
    return (
      <div className={cn('flex items-center justify-center', classes)}>
        <QueryError error={state.error} onRetry={state.onRetry} />
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div
        role="status"
        aria-label={t(
          'explorer.state.loading',
          'Loading exploration behavior analysis',
        )}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-40" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
