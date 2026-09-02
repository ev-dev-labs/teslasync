import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';
import { useWebPush } from '@/hooks/useWebPush';
import { fmtNumber } from '@/lib/numberFormat';
import type { FsdInsights } from '@/types/fsd';

export const FSD_WEEKLY_DIGEST_NOTICE_PREFIX = 'teslasync.fsd.weeklyDigest.notified.';

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fsdWeeklyDigestNoticeKey(vehicleId: string, weekStart: Date): string {
  return `${FSD_WEEKLY_DIGEST_NOTICE_PREFIX}${vehicleId}.${localDateKey(weekStart)}`;
}

interface FsdWeeklyDigestNotificationArgs {
  vehicleId: string | undefined;
  weekStart: Date;
  isCurrentWeek: boolean;
  insights: FsdInsights | undefined;
  isReady: boolean;
}

/**
 * Browser notification for the current week's FSD digest.
 *
 * Sends at most once per vehicle/week. Never prompts for permission — it only
 * uses the Notification API when the operator already granted it.
 */
export function useFsdWeeklyDigestNotification({
  vehicleId,
  weekStart,
  isCurrentWeek,
  insights,
  isReady,
}: FsdWeeklyDigestNotificationArgs) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { permission, sendNotification } = useWebPush();

  useEffect(() => {
    if (!isReady || !isCurrentWeek || !vehicleId) return;
    const distanceM = insights?.totals?.fsd_distance_m;
    if (distanceM == null) return;
    if (permission !== 'granted') return;

    const key = fsdWeeklyDigestNoticeKey(vehicleId, weekStart);
    try {
      if (window.localStorage.getItem(key) === '1') return;
      window.localStorage.setItem(key, '1');
    } catch {
      return;
    }

    const share = insights?.totals?.fsd_share_pct;
    const shareChange = insights?.drive_analytics?.comparison?.fsd_share_change_pct_points;
    const shareLabel = share == null
      ? ''
      : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {
          value: fmtNumber(share, 1),
        });
    const changeLabel = shareChange == null
      ? ''
      : t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {
          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange, 1)}`,
        });

    sendNotification(
      t('analytics.weeklyDigest.fsdNotificationTitle', 'Weekly FSD digest'),
      {
        body: t(
          'analytics.weeklyDigest.fsdNotice',
          'Reported FSD {{distance}}{{share}}{{change}}.',
          {
            distance: formatDistance(distanceM, { precision: 1 }),
            share: shareLabel,
            change: changeLabel,
          },
        ),
        tag: key,
      },
      () => {
        window.location.assign('/weekly-digest');
      },
    );
  }, [
    formatDistance,
    insights,
    isCurrentWeek,
    isReady,
    permission,
    sendNotification,
    t,
    vehicleId,
    weekStart,
  ]);
}
