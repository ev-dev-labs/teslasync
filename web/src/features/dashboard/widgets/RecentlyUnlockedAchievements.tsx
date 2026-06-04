import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAchievementCelebrationPrefs } from '@/hooks/useAchievementCelebrationPrefs';
import { AchievementBadge } from '@/features/analytics/components/AchievementBadge';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/**
 * RecentlyUnlockedAchievementsWidget — surfaces the user's most recently
 * unlocked achievements directly on the dashboard.
 *
 * Backed by the same `/analytics/lifetime` payload as the Lifetime Stats page,
 * so a fresh unlock from the SSE celebration will show up on the next
 * lifetime-stats refetch (TanStack Query invalidates on focus + interval).
 *
 * Sort order: `unlocked_at desc`. Achievements with no `unlocked_at` (still
 * locked) are excluded entirely. Click a badge → deep-link into the lifetime
 * page with `?achievement={id}` so the deep-link logic scrolls
 * to + pulses the badge.
 *
 * Honours `useAchievementCelebrationPrefs.showOnDashboard`: when off, the
 * widget renders an opt-out empty state instead of the badge strip so the
 * widget slot doesn't disappear from the layout (avoids surprising the user
 * with a hole in their dashboard grid).
 */
export default function RecentlyUnlockedAchievementsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const prefs = useAchievementCelebrationPrefs();

  const {
    data, isLoading, error,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useLifetimeStats(id > 0 ? String(id) : undefined);

  const isWide = size.cols >= 3;
  const limit = isWide ? 5 : 3;

  const recent = useMemo(() => {
    const all = data?.achievements ?? [];
    return all
      .filter(a => a.unlocked && a.unlocked_at)
      .sort((a, b) => {
        const ta = a.unlocked_at ? Date.parse(a.unlocked_at) : 0;
        const tb = b.unlocked_at ? Date.parse(b.unlocked_at) : 0;
        return tb - ta;
      })
      .slice(0, limit);
  }, [data?.achievements, limit]);

  const title = t('widget.recentlyUnlocked.title', 'Recently Unlocked');
  const icon = <Trophy className="h-3.5 w-3.5 text-amber-400" />;

  if (!prefs.showOnDashboard) {
    return (
      <WidgetShell title={title} icon={icon} updatedAt={dataUpdatedAt}>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Trophy className="h-5 w-5" />}
          message={t(
            'widget.recentlyUnlocked.disabled',
            'Recently unlocked achievements are hidden in your settings.',
          )}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={title}
      icon={icon}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {recent.length > 0 ? (
        <ul className="flex flex-wrap gap-3 items-start" data-testid="recently-unlocked-list">
          {recent.map(a => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => navigate(`/lifetime?achievement=${encodeURIComponent(a.id)}`)}
                className="rounded-lg p-1 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500/50"
                aria-label={t('achievements.viewNamed', 'View achievement: {{name}}', { name: a.name })}
              >
                <AchievementBadge achievement={a} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Trophy className="h-5 w-5" />}
          message={t(
            'achievements.noneYet',
            'Drive, charge, and explore — achievements will appear here as you unlock them',
          )}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
