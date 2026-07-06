import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';

export interface TwinDetailItem {
  label: string;
  value: ReactNode;
}

export interface TwinDetailPanelProps {
  /** Panel heading (h3 via PanelTitle). */
  title: string;
  /** Decorative leading icon rendered next to the title. */
  icon?: ReactNode;
  /** Key/value rows rendered once the section is ready. */
  items: TwinDetailItem[];
  /** True while the backing query is loading with no data yet. */
  isLoading?: boolean;
  /** TanStack error (unknown) — renders a recovery-aware QueryError. */
  error?: unknown;
  /** True when the query resolved but returned no usable data. */
  isEmpty?: boolean;
  /** Icon shown inside the empty state. */
  emptyIcon?: ReactNode;
  /** i18n empty-state message. */
  emptyMessage: string;
  /** Retry callback wired to QueryError. */
  onRetry?: () => void;
  /** Optional footer slot (e.g. a StatusBadge) shown only in the ready state. */
  footer?: ReactNode;
  /** KVList column count. */
  columns?: 1 | 2;
  className?: string;
}

/**
 * TwinDetailPanel — the shared surface for every Digital Twin component-state
 * section (doors, windows, security, lights). Owns its own loading / empty /
 * error / ready branches so each section is self-sufficient and no content is
 * gated behind a single page-level guard.
 */
export function TwinDetailPanel({
  title,
  icon,
  items,
  isLoading,
  error,
  isEmpty,
  emptyIcon,
  emptyMessage,
  onRetry,
  footer,
  columns = 2,
  className,
}: TwinDetailPanelProps) {
  const { t } = useTranslation();
  const ready = !isLoading && !error && !isEmpty;
  // Defensive: KVList maps over this, so a caller passing `undefined`
  // (e.g. a query that resolved with a missing collection) must not crash
  // the whole section.
  const rows = items ?? [];

  return (
    <GlassPanel className={cn('flex flex-col p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        {icon}
        <span className="truncate">{title}</span>
      </PanelTitle>
      <div className="flex-1" aria-busy={isLoading ? true : undefined}>
        {isLoading ? (
          <div
            role="status"
            aria-label={t('digitalTwin.loadingSection', 'Loading {{section}}', { section: title })}
          >
            <Skeleton height={132} />
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : isEmpty ? (
          /* no-action: transient empty state — surfaces when live telemetry has
             not yet arrived for this vehicle; no explicit recovery action. */
          <EmptyState icon={emptyIcon} message={emptyMessage} />
        ) : (
          <KVList items={rows} columns={columns} />
        )}
      </div>
      {ready && footer ? (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">{footer}</div>
      ) : null}
    </GlassPanel>
  );
}
