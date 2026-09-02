import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { fsdInsights } from '@/features/driving/components/fsd-insights/__tests__/fixtures';

import {
  fsdWeeklyDigestNoticeKey,
  useFsdWeeklyDigestNotification,
} from './useFsdWeeklyDigestNotification';

const mocks = vi.hoisted(() => ({
  permission: 'granted' as NotificationPermission,
  sendNotification: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (meters: number | null, options?: { precision?: number }) =>
      meters == null ? '—' : `${(meters / 1000).toFixed(options?.precision ?? 1)} km`,
  }),
}));

vi.mock('@/hooks/useWebPush', () => ({
  useWebPush: () => ({
    permission: mocks.permission,
    sendNotification: mocks.sendNotification,
  }),
}));

const weekStart = new Date(2026, 2, 2);
const insights = fsdInsights({
  totals: {
    ...fsdInsights().totals,
    fsd_distance_m: 16_000,
    fsd_share_pct: 40,
  },
});
insights.drive_analytics.comparison.fsd_share_change_pct_points = 3;

function renderNotice(
  over: Partial<Parameters<typeof useFsdWeeklyDigestNotification>[0]> = {},
) {
  return renderHook(() =>
    useFsdWeeklyDigestNotification({
      vehicleId: '7',
      weekStart,
      isCurrentWeek: true,
      insights,
      isReady: true,
      ...over,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.permission = 'granted';
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockReturnValue({ close: vi.fn() });
});

describe('useFsdWeeklyDigestNotification', () => {
  it('notifies once for the current week when permission is already granted', () => {
    renderNotice();

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification.mock.calls[0][0]).toBe('Weekly FSD digest');
    expect(String(mocks.sendNotification.mock.calls[0][1]?.body)).toContain('16.0 km');
    expect(window.localStorage.getItem(fsdWeeklyDigestNoticeKey('7', weekStart))).toBe('1');

    renderNotice();
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('does not prompt or notify when permission is not granted', () => {
    mocks.permission = 'default';
    renderNotice();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('does not notify for a past week or unmeasured FSD distance', () => {
    renderNotice({ isCurrentWeek: false });
    renderNotice({
      isCurrentWeek: true,
      insights: fsdInsights({
        totals: { ...fsdInsights().totals, fsd_distance_m: null },
      }),
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

describe('fsdWeeklyDigestNoticeKey', () => {
  it('keys the notice by vehicle and local week date', () => {
    expect(fsdWeeklyDigestNoticeKey('7', weekStart)).toBe(
      'teslasync.fsd.weeklyDigest.notified.7.2026-03-02',
    );
  });
});
