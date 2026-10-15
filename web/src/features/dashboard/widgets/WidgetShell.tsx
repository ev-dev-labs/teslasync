import { type ReactNode, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { HelpTooltip, PinButton } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import {
  DataFreshness,
  DataFreshnessAuto,
  type FreshnessQuery,
} from '@/components/data-display';
import type { WidgetHelp } from './types';

export interface WidgetShellProps {
  title?: string;
  description?: string;
  /** Localized status text/badge; source trust is represented separately by dataState. */
  status?: ReactNode;
  footer?: ReactNode;
  className?: string;
  loadingContent?: ReactNode;
  /** Reuse useDataState(query); retained data is never replaced on refresh failure. */
  dataState?: DataState<unknown>;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
  /**
   * Convenience: pass an entire TanStack Query result and the shell will
   * render `<DataFreshnessAuto query={query} />` in the header. Mutually
   * exclusive with the granular `updatedAt`/`isFetching`/`isStale`/`isError`/
   * `onRefresh` props (those win when supplied for backward compatibility).
   */
  query?: FreshnessQuery;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never) */
  updatedAt?: number;
  /** Is TanStack Query currently fetching in the background? */
  isFetching?: boolean;
  /** Has the query data gone stale? */
  isStale?: boolean;
  /** Is the query in an error state? */
  isError?: boolean;
  /** Callback to manually refetch the widget data */
  onRefresh?: () => void;
  /**
   * Optional help metadata. When provided AND the widget has a visible
   * `title`, a small "?" tooltip is rendered next to the title with the
   * provided text/i18nKey.
   */
  help?: WidgetHelp;
  /**
   * Stable widget identifier. When supplied alongside `dashboardId`, a
   * <PinButton> is rendered in the header so the user can pin this widget
   * to the top of the dashboard.
   */
  widgetId?: string;
  /** Dashboard ID — used as the pin context so pins are per-dashboard. */
  dashboardId?: string;
}

export function WidgetShell({
  title, description, status, footer, className, loadingContent,
  dataState, icon, loading, error, children, noPadding, actions,
  query,
  updatedAt, isFetching, isStale, isError, onRefresh, help,
  widgetId, dashboardId,
}: WidgetShellProps) {
  const { t } = useTranslation();
  // Pulse animation on data change
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  // Resolve the effective updatedAt for the pulse-on-change effect: the
  // explicit prop wins, otherwise we fall back to the query's value.
  const effectiveUpdatedAt = updatedAt ?? query?.dataUpdatedAt;

  useEffect(() => {
    if (
      effectiveUpdatedAt &&
      effectiveUpdatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== effectiveUpdatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = effectiveUpdatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = effectiveUpdatedAt;
    // Clear any lingering pulse when the effective timestamp is reset or left
    // unchanged (e.g. a refetch regresses dataUpdatedAt back to 0). The pending
    // timer from a prior pulse is cancelled by this effect's cleanup, so
    // without this reset the green glow would stay stuck on.
    setJustUpdated(false);
  }, [effectiveUpdatedAt]);

  const initialLoading = dataState ? dataState.status === 'initial' : loading;
  const fatalError = dataState ? dataState.fatalError : error ? new Error(error) : null;
  const retry = onRefresh ?? dataState?.retry ?? (query ? () => { void query.refetch(); } : undefined);

  const showFreshness = updatedAt !== undefined || query !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets)
  const freshnessCompact = !title;

  let freshnessEl: ReactNode = null;
  if (showFreshness) {
    if (updatedAt !== undefined) {
      freshnessEl = (
        <DataFreshness
          updatedAt={updatedAt > 0 ? updatedAt : null}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          isError={isError ?? false}
          onRefresh={onRefresh}
          compact={freshnessCompact}
        />
      );
    } else if (query) {
      freshnessEl = (
        <DataFreshnessAuto query={query} compact={freshnessCompact} />
      );
    }
  }

  return (
    <div
      className={cn(
        dashboardTokens.shell,
        'min-h-0 flex-1 transition-shadow duration-slow',
        justUpdated && 'shadow-[0_0_12px_rgba(34,197,94,0.15)] motion-reduce:shadow-none',
        className,
      )}
      aria-busy={Boolean(initialLoading || dataState?.isRefreshing)}
      data-data-state={dataState?.status}
    >
      {title ? (
        <div className={dashboardTokens.header}>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              {icon && <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-secondary)] [&>svg]:size-4">{icon}</span>}
              <h3 className={cn(dashboardTokens.title, 'min-w-0 break-words')}>{title}</h3>
              {help && (
                <HelpTooltip
                  size="xs"
                  placement="top"
                  text={help.text}
                  i18nKey={help.i18nKey}
                  defaultValue={help.defaultValue}
                  learnMore={help.learnMore}
                  ariaLabel={t('widget.moreInfoAbout', 'More info about {{title}}', { title })}
                />
              )}
            </div>
            {description && <p className={dashboardTokens.description}>{description}</p>}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {status}
            {freshnessEl}
            {widgetId && dashboardId && (
              <PinButton
                itemType="widget"
                itemId={widgetId}
                context={dashboardId}
                size="sm"
              />
            )}
            {actions}
          </div>
        </div>
      ) : (
        <>
          {/* Overlay freshness indicator for title-less widgets */}
          {freshnessEl && (
            <div className="absolute top-1.5 right-[var(--dashboard-widget-chrome-inset,0.375rem)] z-[5]">
              {freshnessEl}
            </div>
          )}
          {(actions || status || description) && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pl-4 pr-[var(--dashboard-widget-chrome-inset,1rem)] pb-2 pt-3">
              {description && <p className={cn(dashboardTokens.description, 'mr-auto')}>{description}</p>}
              {status}
              {actions}
            </div>
          )}
        </>
      )}
      <div className={cn(dashboardTokens.body, !noPadding ? 'px-4 pb-3 overflow-auto' : 'flex flex-col overflow-hidden')}>
        {initialLoading ? (
          loadingContent ?? <Skeleton className="h-full min-h-24 rounded-xl" />
        ) : fatalError ? (
          <div className="flex h-full items-center justify-center p-4">
            <QueryError error={fatalError} onRetry={retry ?? undefined} />
          </div>
        ) : (
          <>
            {dataState && <StaleRefreshWarning state={dataState} className="mb-2" />}
            {children}
          </>
        )}
      </div>
      {footer && <div className={dashboardTokens.footer}>{footer}</div>}
    </div>
  );
}
