import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';

export interface CompareSectionState {
  isLoading: boolean;
  /** A required source has no data and its first request is paused (cause-neutral). */
  isPaused?: boolean;
  error: unknown;
  emptyMessage: string | null;
  onRetry: () => void;
}

interface CompareSectionBodyProps {
  state: CompareSectionState;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  emptyActionTo?: { label: string; to: string };
  resourceName?: string;
}

/** Shared loading/error/selection gate used inside every mounted panel shell. */
export function CompareSectionBody({
  state,
  children,
  icon,
  className,
  emptyActionTo,
  resourceName,
}: CompareSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-52', className);

  if (state.error) {
    return (
      <div className={cn('flex items-center justify-center', classes)}>
        <QueryError
          error={state.error}
          onRetry={state.onRetry}
          resourceName={resourceName}
          listHref="/drives"
        />
      </div>
    );
  }

  if (state.isPaused) {
    return (
      <div className={classes} data-compare-paused="">
        <AlertBanner variant="info" role="status" title={resourceName ?? t('driveCompare.title', 'Drive Compare')}>
          <Text as="p" variant="bodySm" color="secondary">
            {t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')}
          </Text>
          <Button type="button" variant="ghost" size="sm" className="mt-2 min-h-11 md:min-h-9" onClick={state.onRetry}>
            {t('common.retry', 'Retry')}
          </Button>
        </AlertBanner>
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div
        role="status"
        aria-label={t('driveCompare.loading', 'Loading drive comparison')}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-44" />
      </div>
    );
  }

  if (state.emptyMessage) {
    return (
      <div className={classes}>
        <EmptyState
          icon={icon}
          message={state.emptyMessage}
          actionTo={emptyActionTo}
          className="h-full"
        />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
