import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { cn } from '@/lib/cn';

import type { MilestoneSectionState } from './types';

interface MilestoneSectionBodyProps {
  state: MilestoneSectionState;
  children: ReactNode;
  className?: string;
}

/** Shared status gate that stays mounted inside each independent panel shell. */
export function MilestoneSectionBody({
  state,
  children,
  className,
}: MilestoneSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-48', className);

  return <div className={classes}>
    <SourceContent
      state={state.error ? 'error' : state.isLoading ? 'loading' : 'ready'}
      label={t('milestones.title', 'Odometer milestones')}
      emptyMessage="" errorMessage={t('error.loadFailed', 'Failed to load data')}
      error={state.error} errorRecovery={{ onRetry: state.onRetry }}
      loadingContent={<div className="py-4"><Skeleton height="100%" className="min-h-40" /></div>}
    >{children}</SourceContent>
  </div>;
}
