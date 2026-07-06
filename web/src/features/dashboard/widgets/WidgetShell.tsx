import { type ReactNode, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Skeleton, QueryError } from '@/components/feedback';
import { HelpTooltip, PinButton } from '@/components/ui';
import {
  DataFreshness,
  DataFreshnessAuto,
  type FreshnessQuery,
} from '@/components/data-display';
import type { WidgetHelp } from './types';

interface WidgetShellProps {
  title?: string;
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
  title, icon, loading, error, children, noPadding, actions,
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

  if (loading) return <Skeleton className="h-full rounded-xl" />;
  if (error) return (
    <div className="h-full flex items-center justify-center p-4">
      <QueryError error={new Error(error)} />
    </div>
  );

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
        'relative h-full flex flex-col transition-shadow duration-slow',
        justUpdated && 'shadow-[0_0_12px_rgba(34,197,94,0.15)]',
      )}
    >
      {title ? (
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-1.5">
            {icon}
            <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{title}</h3>
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
          <div className="flex items-center gap-2">
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
            <div className="absolute top-1.5 right-1.5 z-[5]">
              {freshnessEl}
            </div>
          )}
          {actions && (
            <div className="flex-shrink-0 flex justify-end px-4 pt-3 pb-1">
              {actions}
            </div>
          )}
        </>
      )}
      <div className={cn('@container flex-1 min-h-0', !noPadding ? 'px-4 pb-3 overflow-auto' : 'overflow-hidden')}>
        {children}
      </div>
    </div>
  );
}
