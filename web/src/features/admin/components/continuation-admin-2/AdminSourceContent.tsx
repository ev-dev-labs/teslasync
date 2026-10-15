import type { ReactNode } from 'react';
import type { DataState } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
import { QueryError } from '@/components/feedback';

interface AdminSourceContentProps {
  source: DataState<unknown>;
  label: string;
  emptyMessage: string;
  loadingContent?: ReactNode;
  emptyContent?: ReactNode;
  fatalTestId?: string;
  fatalMessage?: ReactNode;
  retryOnRetained?: boolean;
  children: ReactNode;
}

/** Keep the full permission/authentication guidance on fatal failures. */
export function AdminSourceContent({
  source, label, emptyMessage, loadingContent, emptyContent, fatalTestId, fatalMessage, retryOnRetained = true, children,
}: AdminSourceContentProps) {
  if (source.fatalError) {
    return <div data-testid={fatalTestId} className="space-y-2">{fatalMessage}<QueryError error={source.fatalError} onRetry={source.retry ?? undefined} resourceName={label} /></div>;
  }
  return (
    <SourceContent
      state={source.status === 'initial' ? 'loading' : source.status === 'stale' ? 'retained' : 'ready'}
      label={label}
      emptyMessage={emptyMessage}
      errorMessage={emptyMessage}
      loadingContent={loadingContent}
      emptyContent={emptyContent}
      errorRecovery={{ onRetry: retryOnRetained ? source.retry ?? undefined : undefined }}
    >
      {children}
    </SourceContent>
  );
}
