import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  BatteryCharging,
  CalendarDays,
  Car,
  Clock,
  Compass,
  FileText,
  MapPinned,
  Route,
} from 'lucide-react';
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui/runtime';
import {
  getRecentPages,
  subscribeRecentPages,
  type RecentEntry,
  type RecentPageKind,
} from '@/lib/recentPages';
import { cn } from '@/lib/cn';
import { PrefetchLink } from '../PrefetchLink';
import { useStatusBarPopover } from './StatusBarContext';

const DISPLAY_LIMIT = 5;

export interface RecentPagesSegmentProps {
  iconOnly?: boolean;
}

function iconForKind(kind: RecentPageKind): ReactNode {
  const className = 'h-3.5 w-3.5';
  switch (kind) {
    case 'vehicle':
      return <Car className={className} />;
    case 'drive':
      return <Route className={className} />;
    case 'charging':
      return <BatteryCharging className={className} />;
    case 'trip':
      return <Compass className={className} />;
    case 'geofence':
      return <MapPinned className={className} />;
    case 'year-review':
      return <CalendarDays className={className} />;
    default:
      return <FileText className={className} />;
  }
}

function formatRelative(visitedAt: number, now: number, t: TFunction): string {
  const diffMs = Math.max(0, now - visitedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('recentPages.justNow', 'Just now');
  if (minutes < 60) return `${minutes}${t('recentPages.shortMinute', 'm')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('recentPages.shortHour', 'h')}`;
  return `${Math.floor(hours / 24)}${t('recentPages.shortDay', 'd')}`;
}

function useRecentPages(): RecentEntry[] {
  const [entries, setEntries] = useState<RecentEntry[]>(() => getRecentPages());

  useEffect(() => {
    setEntries(getRecentPages());
    return subscribeRecentPages(() => setEntries(getRecentPages()));
  }, []);

  return entries;
}

export function RecentPagesSegment({ iconOnly = false }: RecentPagesSegmentProps) {
  const { t } = useTranslation();
  const entries = useRecentPages();
  const visibleEntries = entries.slice(0, DISPLAY_LIMIT);
  const { open, toggle, close } = useStatusBarPopover('recent');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const now = Date.now();
  const countLabel = t('statusBar.recent.count', {
    count: entries.length,
    defaultValue: '{{count}} pages',
  });
  const title = t('statusBar.recent.title', 'Recently viewed');
  const ariaLabel = t('statusBar.recent.open', {
    count: entries.length,
    defaultValue: 'Open recently viewed pages, {{count}} saved',
  });

  return (
    <>
      <Tooltip
        content={
          <span>
            {t('statusBar.recent.tooltip', 'Recently viewed pages')} - {countLabel}
          </span>
        }
        side="top"
      >
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onClick={toggle}
          className={cn(
            'h-5 min-h-0 gap-1 px-1.5 py-0 text-xs leading-none',
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          )}
          data-testid="status-bar-recent-trigger"
        >
          <Clock className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <Text as="span" size="xs" weight="medium" color="secondary">
              {t('statusBar.recent.short', 'Recent')}
            </Text>
          )}
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side="top"
        align="end"
        ariaLabel={title}
        className="w-[min(92vw,360px)] p-2"
      >
        <div id={contentId} data-testid="status-bar-recent-popover">
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-2 pb-2 pt-1">
            <div className="min-w-0">
              <PanelTitle>{title}</PanelTitle>
              <Text as="p" size="xs" color="muted" className="mt-0.5">
                {countLabel}
              </Text>
            </div>
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-primary)]" aria-hidden />
          </div>

          {visibleEntries.length === 0 ? (
            <Text
              as="p"
              size="sm"
              color="muted"
              className="px-3 py-5 text-center"
              data-testid="status-bar-recent-empty"
            >
              {t(
                'statusBar.recent.empty',
                'Pages you visit will appear here for quick access.',
              )}
            </Text>
          ) : (
            <ul
              className="max-h-[320px] space-y-0.5 overflow-y-auto pt-1"
              data-testid="status-bar-recent-list"
            >
              {visibleEntries.map((entry) => (
                <li key={entry.path}>
                  <PrefetchLink
                    to={entry.path}
                    onClick={close}
                    className={cn(
                      'flex min-h-10 items-center gap-2 rounded-md px-2 py-2',
                      'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                    )}
                    data-testid={`status-bar-recent-row-${entry.path}`}
                  >
                    <span
                      className="shrink-0 text-[var(--theme-primary)]"
                      aria-hidden
                      data-page-kind={entry.kind}
                    >
                      {iconForKind(entry.kind)}
                    </span>
                    <Text
                      as="span"
                      size="sm"
                      weight="medium"
                      color="primary"
                      className="min-w-0 flex-1 truncate"
                    >
                      {entry.title}
                    </Text>
                    <Text as="span" size="2xs" color="muted" className="shrink-0 tabular-nums">
                      {formatRelative(entry.visited_at, now, t)}
                    </Text>
                  </PrefetchLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Popover>
    </>
  );
}
