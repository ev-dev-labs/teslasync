import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { Button, Icon, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useActivity } from '@/api/hooks/useActivity';
import { ListExportMenu } from '@/components/forms';
import { downloadJSON, downloadRowsAsCSV } from '@/lib/csvExport';
import type { ActivityKind } from '@/types/activity';
import { ActivityFeed, ActivityOverview, KindFilterBar } from '../components/activity-timeline';

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
  const { fmtInt } = useNumberFormatting();
  usePageTitle(t('activity.timeline.title', 'Activity timeline'));

  const { vehicleId, vehicles, vehiclesState } = useSelectedVehicle();
  const operationalMode = useOperationalMode();
  const { startInstant, endInstantExclusive, timezone: tz } = useRangeState({
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
  }, [vehicleId, activityWindow.start, activityWindow.end, tz, kinds]);

  const query = useActivity({
    vehicle_id: vehicleId ?? undefined,
    start: activityWindow.start,
    end: activityWindow.end,
    kind: kinds.length > 0 ? kinds : undefined,
    limit: PAGE_LIMIT,
    offset,
    enabled: vehiclesState.hasData && vehicles.length > 0,
  });
  const { data, refetch } = query;
  const activityState = useDataState(query, { provenance: 'historical' });
  const state = vehiclesState.hasData ? activityState : vehiclesState;
  const isLoading = state.status === 'initial';
  const error = state.fatalError;
  const isError = !!error;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (vehiclesState.status === 'unavailable' && vehicles.length === 0) {
    return (
      <NoVehicleSelected
        pageTitle={t('activity.timeline.title', 'Activity timeline')}
      />
    );
  }

  const hasOlder = offset + items.length < total;
  const hasNewer = offset > 0;
  const exportName = `activity-${activityWindow.start.replace(/:/g, '-')}-${activityWindow.end.replace(/:/g, '-')}-page-${Math.floor(offset / PAGE_LIMIT) + 1}`;

  return (
    <PageLayout
      title={t('activity.timeline.title', 'Activity timeline')}
      subtitle={t(
        'activity.timeline.subtitle',
        'A unified timeline of drives, charging, alerts, software updates, and your annotations.',
      )}
      query={query}
      overflowActions={
        <ListExportMenu
          testId="activity-export"
          visibleCount={items.length}
          disabled={isLoading || isError || items.length === 0}
          onExportCsv={() => downloadRowsAsCSV(exportName, items, [
            { key: 'occurred_at', header: t('activity.timeline.export.timestamp', 'Timestamp') },
            { key: 'kind', header: t('activity.timeline.export.type', 'Type') },
            { key: 'vehicle_id', header: t('activity.timeline.export.vehicle', 'Vehicle ID') },
            { key: 'title', header: t('activity.timeline.export.title', 'Title') },
            { key: 'summary', header: t('activity.timeline.export.summary', 'Summary') },
            { key: 'severity', header: t('activity.timeline.export.severity', 'Severity') },
            { key: 'status', header: t('activity.timeline.export.status', 'Status') },
            { key: 'source_table', header: t('activity.timeline.export.source', 'Source') },
            { key: 'source_id', header: t('activity.timeline.export.sourceId', 'Source ID') },
            { key: 'duration_s', header: t('activity.timeline.export.duration', 'Duration (s)') },
            { key: 'energy_added_wh', header: t('activity.timeline.export.energy', 'Energy added (Wh)') },
            { key: 'path', header: t('activity.timeline.export.detail', 'Detail path') },
          ])}
          onExportJson={() => downloadJSON(exportName, items)}
        />
      }
    >
      <StaleRefreshWarning
        state={vehiclesState}
        label={t('dataSources.labels.vehicleRegistry', 'Vehicle registry')}
      />
      <StaleRefreshWarning state={activityState} />
      <FadeIn>
        <ActivityOverview
          items={items}
          total={total}
          offset={offset}
          loading={isLoading && !state.hasData}
          error={isError}
          available={state.hasData}
          retained={state.hasData && state.status === 'stale'}
          scope={`${activityWindow.start} – ${activityWindow.end}`}
          timezone={tz}
        />
      </FadeIn>
      <FadeIn>
        <KindFilterBar activeKinds={kinds} onChange={setKinds} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <ActivityFeed
          items={items}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => {
            if (!vehiclesState.hasData) vehiclesState.retry?.();
            else void refetch();
          }}
          timezone={tz}
        />
      </FadeIn>

      <div className="flex flex-wrap items-center justify-center gap-3" aria-live="polite">
        {!isLoading && !isError && (
          <Text as="p" variant="caption">
            {t('activity.timeline.pagePosition', 'Showing {{start}}–{{end}} of {{total}} events in the selected range', {
              start: fmtInt(items.length ? offset + 1 : 0),
              end: fmtInt(items.length ? offset + items.length : 0),
              total: fmtInt(total),
            })}
          </Text>
        )}
        {!isLoading && !isError && (
          <>
          {hasNewer && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              icon={<Icon icon={ChevronLeft} className="rtl:rotate-180" />}
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
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              onClick={() => setOffset((o) => o + PAGE_LIMIT)}
            >
              {t('activity.timeline.loadMore', 'Older')}
              <Icon icon={ChevronRight} className="ms-1 rtl:rotate-180" />
            </Button>
          )}
          </>
        )}
      </div>
      <Text as="p" variant="caption" className="text-center">
        {t('activity.timeline.exportScope', 'Exports include only the loaded page. Use Older or Newer to browse and export other pages.')}
      </Text>

      <Text as="p" variant="caption" className="text-center">
        {t(
          'activity.timeline.serviceHistoryLimitation',
          'Dated service records will join this timeline when a verified service-history source is available.',
        )}
      </Text>
    </PageLayout>
  );
}
