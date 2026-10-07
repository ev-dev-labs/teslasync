import type { ReactNode } from 'react';
import { SourceContent, type SourceState } from '@/components/layout';
import { GlassPanel, Heading } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import type { DataStateSource } from '@/api/dataState';

export interface VehicleSourcePanelProps {
  query: DataStateSource<unknown> & { isLoading?: boolean };
  label: string;
  emptyMessage: string;
  errorMessage: string;
  resourceName?: string;
  children: ReactNode;
  /** Live-state renderers require the actual state field, not its envelope. */
  available?: boolean;
  /** Existing domain panels own their successful empty response UI. */
  renderEmpty?: boolean;
}

export function VehicleSourcePanel({
  query, label, emptyMessage, errorMessage, children, available,
  renderEmpty = true, resourceName,
}: VehicleSourcePanelProps) {
  const trust = useDataState(query);
  const contentAvailable = available ?? trust.hasData;
  const initialLoading = !contentAvailable && Boolean(query.isPending || query.isLoading);
  const sourceFailed = trust.fatalError != null || query.error != null || query.isError === true;
  const canRender = contentAvailable || (renderEmpty && !initialLoading && !sourceFailed);
  const state: SourceState = canRender ? 'ready' : initialLoading
    ? 'loading' : sourceFailed ? 'error' : 'empty';
  // SourceContent's reference-only retained prose is deliberately not used
  // for production. Existing trust feedback qualifies the retained values.
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 [&>[data-print-card]]:flex-1" data-vehicle-source={label}>
      <StaleRefreshWarning state={trust} label={label} />
      {canRender ? (
        <SourceContent state="ready" label={label} emptyMessage={emptyMessage} errorMessage={errorMessage}>
          {children}
        </SourceContent>
      ) : (
        <GlassPanel padding="md" className="h-full min-w-0 space-y-3">
          <Heading level="panel">{label}</Heading>
          {state === 'error' ? (
            <QueryError error={query.error ?? trust.fatalError ?? new Error(errorMessage)} onRetry={trust.retry ?? undefined} resourceName={resourceName ?? label} />
          ) : (
            <SourceContent state={state} label={label} emptyMessage={emptyMessage} errorMessage={errorMessage}>
              {children}
            </SourceContent>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
