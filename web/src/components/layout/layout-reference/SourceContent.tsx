import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorDisplay, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';

export type SourceState = 'ready' | 'loading' | 'error' | 'empty' | 'retained';

export interface SourceContentProps {
  state: SourceState;
  label: string;
  emptyMessage: string;
  errorMessage: string;
  error?: unknown;
  children: ReactNode;
}

/** Source failures stay inside their own persistent panel shell. */
export function SourceContent({ state, label, emptyMessage, errorMessage, error, children }: SourceContentProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <div role="status" aria-label={t('developerReference.layout.source.loading', 'Loading {{label}}', { label })} className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state === 'error') return <ErrorDisplay error={error ?? new Error(errorMessage)} compact message={errorMessage} />;
  if (state === 'empty') return <div data-empty-state><EmptyState message={emptyMessage} className="py-6" /></div>;
  return (
    <>
      {state === 'retained' && (
        <Text as="p" variant="bodySm" role="status">
          {t('developerReference.layout.source.retained', 'The synthetic refresh failed. Retained content remains available.')}
        </Text>
      )}
      {children}
    </>
  );
}
