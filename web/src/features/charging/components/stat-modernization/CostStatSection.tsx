import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, type GlassPanelProps } from '@/components/ui';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { StatPeriod } from '@/lib/metric-reference';

interface CostStatSectionProps {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  glow?: GlassPanelProps['glow'];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyIcon?: ReactNode;
  emptyMessage?: string;
  emptyDescription?: string;
  skeletonHeight?: number;
  className?: string;
  bodyClassName?: string;
  /** Existing rows/slice are usable, even after a failed refresh. */
  retained?: boolean;
  period: StatPeriod;
  children: ReactNode | ((periodHeaderId: string) => ReactNode);
}

/** Extraction of the existing feature shell: same primitives/actions, explicit period and retained data. */
export function CostStatSection({
  title, icon, action, glow = 'none', isLoading, error, onRetry,
  isEmpty, emptyIcon, emptyMessage, emptyDescription, skeletonHeight = 220,
  className, bodyClassName, retained = false, period, children,
}: CostStatSectionProps) {
  const { t } = useTranslation();
  const periodHeaderId = useId();
  return (
    <GlassPanel glow={glow} className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <PanelTitle className="flex items-center gap-2">
          {icon ? <span className="inline-flex" aria-hidden="true">{icon}</span> : null}
          {title}
        </PanelTitle>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div id={periodHeaderId} className="mb-3 text-xs text-[var(--text-secondary)]">
        <span>{period.label}</span>
        {period.kind === 'unknown' && period.reason && <p>{period.reason}</p>}
        {period.kind !== 'unknown' && <p>{period.provenance}</p>}
      </div>
      {retained && (error || isLoading) ? (
        <p role="status" className="mb-3 text-xs text-[var(--text-secondary)]">
          {t('developerReference.stats.state.retained', 'Showing retained measurements')}
        </p>
      ) : null}
      {error && retained ? <QueryError error={error} onRetry={onRetry} /> : null}
      {error && !retained ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading && !retained ? (
        <Skeleton height={skeletonHeight} />
      ) : isEmpty ? (
        <EmptyState
          icon={emptyIcon}
          message={emptyMessage ?? t('common.noChargingRecords', 'No charging records match the current selection.')}
          description={emptyDescription ?? t('common.noChargingRecordsDescription',
            'Adjust the vehicle or date filters, or return after more charging history is recorded.')}
          action={onRetry ? { label: t('common.retry', 'Retry'), onClick: onRetry } : undefined}
        />
      ) : (
        <div className={bodyClassName}>{typeof children === 'function' ? children(periodHeaderId) : children}</div>
      )}
    </GlassPanel>
  );
}
