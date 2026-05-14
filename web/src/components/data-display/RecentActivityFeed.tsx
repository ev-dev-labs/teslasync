/**
 * RecentActivityFeed — chronological list of audit_logs entries scoped to a
 * single user. Used by `MyActivityPage` (Phase-40 / Prompt 49) and reusable
 * for any future widget that needs to surface per-user activity.
 *
 * Each entry maps to:
 *   - icon + accent color via getActivityVisual(action)
 *   - title via i18n (with English fallback)
 *   - subtitle from entity_type/entity_id and detail
 *   - relative timestamp
 *   - optional click-through to the entity (e.g. /vehicles/:id, /drives/:id)
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Timeline } from './Timeline';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Icons } from '@/lib/icons';
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

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Icons.history className="h-8 w-8" />}
        message={emptyMessage ?? t('activity.myActivity.empty', 'No recent activity in this window.')}
        className={className}
      />
    );
  }

  const items = entries.map((entry) => {
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
      icon: <Icon className="h-3.5 w-3.5" aria-hidden="true" />,
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
  });

  // Timeline now accepts ReactNode for title/subtitle (widened in this prompt
  // so we can embed click-through links without losing type safety).
  return <Timeline items={items} className={className} />;
}
