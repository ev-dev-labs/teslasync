import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorDisplay, type ErrorDisplayProps } from '@/components/feedback/ErrorDisplay';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Typography';
import { typography } from '@/lib/tokens';

export type SourceState = 'ready' | 'loading' | 'error' | 'empty' | 'retained';

export interface SourceContentProps {
  /** Use `error` only for DataState.fatalError; refresh failures use `retained`. */
  state: SourceState;
  label: string;
  emptyMessage: string;
  errorMessage: string;
  error?: unknown;
  children: ReactNode;
  /** Caller-prepared geometry/body inside the localized loading status; nullish uses the original skeleton. */
  loadingContent?: ReactNode;
  /**
   * Replaces the entire default empty body, including its recovery actions.
   * Callers own specialist prerequisites/unresolved copy, semantics and actions;
   * emptyRecovery applies only to the default body. Nullish uses that default.
   */
  emptyContent?: ReactNode;
  /** Used for fatal recovery and, when retained, an explicit non-blocking retry. */
  errorRecovery?: Pick<ErrorDisplayProps, 'onRetry' | 'resourceName' | 'listHref'>;
  emptyRecovery?: Pick<ComponentProps<typeof EmptyState>,
    'action' | 'actionTo' | 'secondaryAction' | 'secondaryActionTo'>;
  /** Localized source-specific context; the default never describes fixture data. */
  retainedMessage?: string;
}

/** Source failures stay inside their own persistent panel shell. */
export function SourceContent({
  state, label, emptyMessage, errorMessage, error, children,
  errorRecovery, emptyRecovery, retainedMessage, loadingContent, emptyContent,
}: SourceContentProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <div role="status" aria-label={t('developerReference.layout.source.loading', 'Loading {{label}}', { label })} className="min-w-0 space-y-3 break-words">
        {loadingContent ?? (
          <>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </>
        )}
      </div>
    );
  }
  if (state === 'error') return <ErrorDisplay {...errorRecovery} error={error ?? new Error(errorMessage)} compact message={errorMessage} />;
  if (state === 'empty') return <div data-empty-state>{emptyContent ?? <EmptyState {...emptyRecovery} message={emptyMessage} className="py-6" />}</div>;
  return (
    <>
      {state === 'retained' && (
        <div className="min-w-0 space-y-2 break-words">
          <Text as="p" variant="bodySm" className={typography.color.secondary} role="status" aria-live="polite">
            {retainedMessage ?? t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')}
          </Text>
          {errorRecovery?.onRetry && (
            <Button type="button" variant="secondary" size="sm" wrapLabel
              className="max-w-full min-h-11 md:min-h-9" onClick={errorRecovery.onRetry}>
              {t('error.retry', 'Retry')}
            </Button>
          )}
        </div>
      )}
      {children}
    </>
  );
}
