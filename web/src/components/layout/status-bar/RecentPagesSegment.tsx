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
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  getRecentPages,
  subscribeRecentPages,
  type RecentEntry,
  type RecentPageKind,
} from '@/lib/recentPages';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { PrefetchLink } from '../PrefetchLink';
import { useStatusBarPopover } from './StatusBarContext';

const DISPLAY_LIMIT = 5;

export interface RecentPagesSegmentProps {
  iconOnly?: boolean;
}

function iconForKind(kind: RecentPageKind): ReactNode {
  switch (kind) {
    case 'vehicle':
      return <Icon icon={Car} size="sm" />;
    case 'drive':
      return <Icon icon={Route} size="sm" />;
    case 'charging':
      return <Icon icon={BatteryCharging} size="sm" />;
    case 'trip':
      return <Icon icon={Compass} size="sm" />;
    case 'geofence':
      return <Icon icon={MapPinned} size="sm" />;
    case 'year-review':
      return <Icon icon={CalendarDays} size="sm" />;
    default:
      return <Icon icon={FileText} size="sm" />;
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
            'h-11 min-h-11 min-w-11 shrink-0 gap-1 px-1.5 py-0 leading-none md:h-5 md:min-h-0 md:min-w-0 md:shrink',
            typography.size.xs,
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          )}
          data-testid="status-bar-recent-trigger"
        >
          <Icon icon={Clock} size="xs" />
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
        className="w-recent-pages p-2"
      >
        <div id={contentId} data-testid="status-bar-recent-popover">
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-2 pb-2 pt-1">
            <div className="min-w-0">
              <PanelTitle className="break-words">{title}</PanelTitle>
              <Text as="p" variant="caption" className="mt-0.5">
                {countLabel}
              </Text>
            </div>
            <Icon icon={Clock} className={cn('mt-0.5', typography.color.secondary)} />
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
              className="max-h-alerts-preview space-y-0.5 overflow-y-auto pt-1"
              data-testid="status-bar-recent-list"
            >
              {visibleEntries.map((entry) => (
                <li key={entry.path}>
                  <PrefetchLink
                    to={entry.path}
                    onClick={close}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-shape-sm px-2 py-2 md:min-h-10',
                      'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)] forced-colors:focus-visible:outline-[Highlight]',
                    )}
                    data-testid={`status-bar-recent-row-${entry.path}`}
                  >
                    <span
                      className={cn('shrink-0', typography.color.secondary)}
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
                      className="min-w-0 flex-1 break-words"
                    >
                      {entry.title}
                    </Text>
                    <Text as="span" variant="caption" className="shrink-0 tabular-nums">
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
