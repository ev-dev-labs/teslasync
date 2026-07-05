/**
 * RecentActivityFeed — chronological list of audit_logs entries scoped to a
 * single user. Used by `MyActivityPage` and reusable
 * for any future widget that needs to surface per-user activity.
 *
 * Each entry maps to:
 *   - icon + accent color via getActivityVisual(action)
 *   - title via i18n (with English fallback)
 *   - subtitle from entity_type/entity_id and detail
 *   - relative timestamp
 *   - optional click-through to the entity (e.g. /vehicles/:id, /drives/:id)
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Timeline } from './Timeline';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/dateFormat';
import { getActivityVisual } from '@/lib/activityIcons';
import type { UserActivityEntry } from '@/types/admin';

export interface RecentActivityFeedProps {
  entries: UserActivityEntry[];
  className?: string;
  /** Override the empty-state message (i18n-translated by the caller). */
  emptyMessage?: string;
}

/**
 * Maps an entity_type to a frontend route prefix when click-through makes
 * sense. Returning null means "render the subtitle as plain text".
 */
function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'vehicle':
      return `/vehicles/${encodeURIComponent(entityId)}`;
    case 'drive':
      return `/drives/${encodeURIComponent(entityId)}`;
    case 'charging_session':
    case 'charge':
      return `/charging/${encodeURIComponent(entityId)}`;
    case 'alert_rule':
      return `/notifications/alerts`;
    case 'automation':
      return `/automations`;
    case 'geofence':
      return `/geofences`;
    case 'data_export':
    case 'export':
      return `/data-export`;
    case 'api_key':
      return `/api-keys`;
    default:
      return null;
  }
}

export function RecentActivityFeed({ entries, className, emptyMessage }: RecentActivityFeedProps) {
  const { t } = useTranslation();

  // Callers are typed to pass an array, but a TanStack Query can hand us
  // `undefined` before it resolves. Normalise up-front so neither `.length`
  // nor `.map` below can throw on a not-yet-loaded feed.
  const rows = entries ?? [];

  // The per-entry mapping resolves an icon/title/href and builds JSX for every
  // row; memoise it so a parent re-render (hover, polling) that leaves the same
  // entries + translator untouched doesn't rebuild N timeline items.
  const items = useMemo(
    () =>
      rows.map((entry) => {
        const visual = getActivityVisual(entry.action);
        const Icon = visual.icon;
        const title = t(visual.i18nKey, visual.fallback);

        const href = entityHref(entry.entity_type, entry.entity_id);
        const subtitleParts: string[] = [];
        if (entry.entity_type) {
          subtitleParts.push(
            entry.entity_id
              ? `${entry.entity_type} · ${entry.entity_id}`
              : entry.entity_type,
          );
        }
        if (entry.detail) {
          subtitleParts.push(entry.detail);
        }
        const subtitleText = subtitleParts.join(' — ');

        return {
          // Tint the glyph with the action's accent colour (the registry
          // colours are Tailwind text-* utilities). Timeline's `color` prop is
          // reserved for the dot ring (a raw CSS colour via inline style), so
          // the accent is applied here on the icon instead.
          icon: <Icon className={cn(visual.color, 'h-3.5 w-3.5')} aria-hidden="true" />,
          title: href ? (
            // Render the title as a link so users can jump to the entity.
            // We surface the link in the title (rather than wrapping the
            // whole row) so the relative timestamp on the right stays
            // visually anchored.
            <Link
              to={href}
              className="text-cyan-300 underline-offset-2 hover:underline focus:underline focus:outline-none"
            >
              {title}
            </Link>
          ) : (
            title
          ),
          subtitle: subtitleText || undefined,
          time: formatRelative(entry.ts),
          color: undefined,
        };
      }),
    [rows, t],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Icons.history className="h-8 w-8" />}
        message={emptyMessage ?? t('activity.myActivity.empty', 'No recent activity in this window.')}
        className={className}
      />
    );
  }

  // Timeline accepts ReactNode for title/subtitle so click-through links keep
  // type safety.
  return <Timeline items={items} className={className} />;
}
