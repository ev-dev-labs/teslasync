import { useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { HelpTooltip, PinButton } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import {
  FreshnessDot,
  FreshnessDotAuto,
  type FreshnessQuery,
} from '@/components/data-display';
import type { WidgetHelp } from './types';
import { WidgetTitleContext } from './WidgetTitleContext';
import { WidgetHeaderContext } from './WidgetHeaderContext';

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
   * render `<FreshnessDotAuto query={query} />` in the header. Mutually
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
  /** Automatic polling cadence for the widget query. Omit for manual 15-minute freshness. */
  refreshIntervalMs?: number;
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
  updatedAt, isFetching, isStale, isError, onRefresh, refreshIntervalMs, help,
  widgetId, dashboardId,
}: WidgetShellProps) {
  const { t } = useTranslation();
  const header = useContext(WidgetHeaderContext);
  const visibleTitle = title ?? t('widget.overview', 'Widget overview');
  const initialLoading = dataState ? dataState.status === 'initial' : loading;
  const fatalError = dataState ? dataState.fatalError : error ? new Error(error) : null;
  const retry = onRefresh ?? dataState?.retry ?? (query ? () => { void query.refetch(); } : undefined);

  const showFreshness = updatedAt !== undefined || query !== undefined;
  const degradedContent = Boolean(
    isStale || isError || query?.isStale || query?.isError || dataState?.status === 'stale',
  );
  let freshnessEl: ReactNode = null;
  if (showFreshness) {
    if (updatedAt !== undefined) {
      freshnessEl = (
        <FreshnessDot
          updatedAt={updatedAt > 0 ? updatedAt : null}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          isError={isError ?? false}
          onRefresh={retry}
          refreshIntervalMs={refreshIntervalMs}
          manual={refreshIntervalMs == null}
          compact={false}
          edgeAligned
        />
      );
    } else if (query) {
        freshnessEl = (
        <FreshnessDotAuto query={query} refreshIntervalMs={refreshIntervalMs} manual={refreshIntervalMs == null} compact={false} edgeAligned />
      );
    }
  }
  if (!freshnessEl) {
    freshnessEl = <FreshnessDot updatedAt={null} isFetching={false} isStale={false} isError={false} untracked edgeAligned />;
  }

  return (
    <div
      className={cn(
        dashboardTokens.shell,
        'min-h-0 flex-1',
        className,
      )}
      aria-busy={Boolean(initialLoading || dataState?.isRefreshing)}
      data-data-state={dataState?.status}
    >
        <div className={dashboardTokens.header} data-role="widget-shell-header">
          <div className="flex min-w-0 w-full items-center gap-2" data-role="widget-header-line">
          <div className="min-w-0 flex-1">
            <div className={cn('flex min-w-0 items-center gap-2', header.editMode && 'widget-drag-handle cursor-grab active:cursor-grabbing')}>
              {icon && <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-secondary)] [&>svg]:size-4">{icon}</span>}
              <h3 data-role="widget-header-title" className={cn(dashboardTokens.title, 'min-w-0 truncate')} title={visibleTitle}>{visibleTitle}</h3>
            </div>
          </div>
          {/* The 44px hit targets fit inside header padding around this 28px title line. */}
          <div className="ms-auto flex h-7 shrink-0 items-center gap-2" data-role="widget-header-actions">
            {status}
            {help && (
                <HelpTooltip
                  size="xs"
                  placement="top"
                  text={help.text}
                  i18nKey={help.i18nKey}
                  defaultValue={help.defaultValue}
                  learnMore={help.learnMore}
                  ariaLabel={t('widget.moreInfoAbout', 'More info about {{title}}', { title: visibleTitle })}
                />
              )}
            {widgetId && dashboardId && (
              <PinButton
                itemType="widget"
                itemId={widgetId}
                context={dashboardId}
                size="sm"
              />
            )}
            {actions}
            {header.actions}
            {freshnessEl}
          </div>
          </div>
          {description && <p className={dashboardTokens.description}>{description}</p>}
        </div>
      <div
        data-testid="widget-body"
        className={cn(
          dashboardTokens.body,
          !noPadding ? 'px-4 pb-3' : 'flex flex-col',
          degradedContent && 'opacity-[0.45] transition-opacity duration-fast motion-reduce:transition-none',
        )}
        data-content-degraded={degradedContent || undefined}
      >
        {initialLoading ? (
          loadingContent ?? <Skeleton className="h-full min-h-24 rounded-xl" />
        ) : fatalError ? (
          <div className="flex h-full items-center justify-center p-4">
            <QueryError error={fatalError} onRetry={retry ?? undefined} />
          </div>
        ) : (
          <>
            {dataState && <StaleRefreshWarning state={dataState} className="mb-2"
              hideRetry={showFreshness && Boolean(retry || query?.refetch)} />}
            <WidgetTitleContext.Provider value={title}>{children}</WidgetTitleContext.Provider>
          </>
        )}
      </div>
      {footer && <div className={dashboardTokens.footer}>{footer}</div>}
    </div>
  );
}
