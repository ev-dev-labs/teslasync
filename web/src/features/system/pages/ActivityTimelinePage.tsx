import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Icons } from '@/lib/icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useTimezone } from '@/lib/timezone';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useActivity } from '@/api/hooks/useActivity';
import type { ActivityKind } from '@/types/activity';
import { ActivityFeed, KindFilterBar } from '../components/activity-timeline';

const PAGE_LIMIT = 50;

export function resolveActivityWindow(
  start: string,
  end: string,
  asOf: string | null,
): { start: string; end: string } {
  if (!asOf) return { start, end };

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const anchorMs = Date.parse(asOf);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    !Number.isFinite(anchorMs)
  ) {
    return { start, end };
  }

  const effectiveEndMs = Math.min(endMs, anchorMs);
  if (startMs < effectiveEndMs) {
    return {
      start,
      end: new Date(effectiveEndMs).toISOString(),
    };
  }

  const durationMs = Math.max(endMs - startMs, 24 * 60 * 60 * 1000);
  return {
    start: new Date(effectiveEndMs - durationMs).toISOString(),
    end: new Date(effectiveEndMs).toISOString(),
  };
}

/**
 * ActivityTimelinePage — unified vehicle operations-intelligence timeline.
 *
 * Unions real domain events (drives, charging sessions, alerts, software
 * updates, and user annotations) into one chronological feed. Distinct
 * from `/me/activity` (the signed-in user's own audit-log actions) and
 * `/timeline` (FSM drive/charge/park state transitions) — this page is
 * about what happened to the VEHICLE, not what the user clicked or how
 * the state machine moved.
 *
 * Inherits the globally selected vehicle (`useSelectedVehicle`) and the
 * shared date-range preference (`useRangeState`) so navigating here from
 * any other page keeps the same scope.
 */
export default function ActivityTimelinePage() {
  const { t } = useTranslation();
  usePageTitle(t('activity.timeline.title', 'Activity Timeline'));

  const { vehicleId, vehicles } = useSelectedVehicle();
  const operationalMode = useOperationalMode();
  const tz = useTimezone('vehicle');
  const { start, end, startInstant, endInstantExclusive, setRange } = useRangeState({
    persistKey: 'activity.timeline.range',
  });
  const [kinds, setKinds] = useState<ActivityKind[]>([]);
  const [offset, setOffset] = useState(0);
  const activityWindow = resolveActivityWindow(
    startInstant,
    endInstantExclusive,
    operationalMode.asOf,
  );

  // Any scope change invalidates the current page position.
  useEffect(() => {
    setOffset(0);
  }, [vehicleId, activityWindow.start, activityWindow.end, kinds]);

  const query = useActivity({
    vehicle_id: vehicleId ?? undefined,
    start: activityWindow.start,
    end: activityWindow.end,
    kind: kinds.length > 0 ? kinds : undefined,
    limit: PAGE_LIMIT,
    offset,
    enabled: vehicles.length > 0,
  });
  const { data, isLoading, isError, error, refetch } = query;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (vehicles.length === 0) {
    return (
      <NoVehicleSelected
        pageTitle={t('activity.timeline.title', 'Activity Timeline')}
      />
    );
  }

  const hasOlder = offset + items.length < total;
  const hasNewer = offset > 0;

  return (
    <PageContainer
      title={t('activity.timeline.title', 'Activity Timeline')}
      subtitle={t(
        'activity.timeline.subtitle',
        'A unified timeline of drives, charging, alerts, software updates, and your annotations.',
      )}
      query={query}
      contextActions={
        <>
          <VehicleSelect />
          <RangePicker value={{ start, end }} onChange={setRange} align="end" triggerTestId="activity-range" />
        </>
      }
    >
      <FadeIn>
        <KindFilterBar activeKinds={kinds} onChange={setKinds} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <ActivityFeed
          items={items}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => void refetch()}
          timezone={tz}
        />
      </FadeIn>

      {(hasOlder || hasNewer) && (
        <div className="flex items-center justify-center gap-2">
          {hasNewer && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Icons.previous className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_LIMIT))}
            >
              {t('activity.timeline.loadNewer', 'Newer')}
            </Button>
          )}
          {hasOlder && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setOffset((o) => o + PAGE_LIMIT)}
            >
              {t('activity.timeline.loadMore', 'Older')}
              <Icons.next className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}

      <Text as="p" variant="caption" className="text-center">
        {t(
          'activity.timeline.serviceHistoryLimitation',
          'Dated service records will join this timeline when a verified service-history source is available.',
        )}
      </Text>
    </PageContainer>
  );
}
