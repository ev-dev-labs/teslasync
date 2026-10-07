import { useTranslation } from 'react-i18next';
import { Navigation, Gauge } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useSignalObservations } from '@/api/hooks/useTelemetry';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { INTERVALS } from '@/lib/constants';

import { latestNumeric, latestText } from '@/lib/signalObservation';
import { convertSpeedFromSI } from '@/lib/unitConversion';

interface AutopilotSectionProps {
  vehicleId: number | null | undefined;
}

// Tesla emits CruiseFollowDistance as a proto enum, e.g.
// "FollowDistance7" / "FollowDistance3" — meaning 7-bar / 3-bar follow
// gap. The signal_log encoder preserves that string verbatim. The
// number suffix is the only useful bit for display, so peel it off
// rather than rendering "FollowDistance7" raw. Falls back to whatever
// the backend gave us if the enum schema ever changes.
function parseFollowDistance(raw: string | null): string | null {
  if (raw == null) return null;
  const m = /(\d+)\s*$/.exec(raw);
  return m ? m[1] : raw;
}

/**
 * Cruise / autopilot panel. Current vehicle speed comes from the
 * SignalStore via /vehicles/{id}/state. Cruise set-speed and follow
 * distance are read from /signals/observations against the most recent
 * signal_log row for each field (ADR-005 cold-signal pattern).
 *
 * Unit policy:
 *   - Both VehicleSpeed and CruiseSetSpeed are normalized to SI m/s on
 *     ingestion (see internal/tesla/units/units.go and
 *     internal/tesla/units/conversions.go — VehicleSpeed and
 *     CruiseSetSpeed are explicitly listed as the two speed-bearing
 *     fields whose canonical unit is m/s, regardless of whether the
 *     vehicle reports its display unit as miles or kilometres).
 *   - Therefore values fetched here go DIRECTLY through the SI →
 *     display converter; there is NO km/h intermediate. The pre-fix
 *     code divided by 1.609344 first (mistakenly assuming a km/h source
 *     because the upstream `state.speed` field name is `speed_mph` —
 *     which is just a JSON field label, NOT a unit assertion). That
 *     produced a 0.62× under-display under mph (m/s ÷ 1.609 × 2.237 =
 *     ×1.39 instead of the correct ×2.237).
 *   - CruiseFollowDistance is a proto enum (ValueKindEnum), not a
 *     numeric, so it is read via latestText and stripped of its
 *     "FollowDistance" prefix.
 */
export default function AutopilotSection({ vehicleId }: AutopilotSectionProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

  const speedUnit = unitPrefs.speed;

  const { data: stateData } = useVehicleState(vehicleId ?? 0, { refetchInterval: INTERVALS.REALTIME });
  // Cruise set-speed and follow distance are cold signals — the vehicle only
  // re-emits them when the driver changes them, so they are read from the
  // latest signal_log row. They still need a cadence: without one these two
  // queries fetched exactly once per mount and the panel showed a set-speed
  // from whenever the page happened to load.
  const { data: cruiseSetObs } = useSignalObservations(
    vehicleId ?? undefined,
    { signal_name: 'CruiseSetSpeed', limit: 1, refetchInterval: INTERVALS.FAST },
  );
  const { data: followObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'CruiseFollowDistance',
    limit: 1,
    refetchInterval: INTERVALS.FAST,
  });

  const vehicleState = stateData?.state;
  const speedMps = vehicleState?.speed ?? null;
  const cruiseSetMps = latestNumeric(cruiseSetObs);
  // ValueKindEnum lands in value_text; numeric fallback covers a future
  // backend that re-encodes the bar-count as ValueKindInt32.
  const followDistanceRaw =
    latestText(followObs) ?? (latestNumeric(followObs) != null ? String(latestNumeric(followObs)) : null);
  const followDistance = parseFollowDistance(followDistanceRaw);

  const hasAny =
    speedMps != null || cruiseSetMps != null || followDistance != null;

  const currentSpeedDisplay = speedMps != null ? toSpeedDisplay(speedMps) : null;
  const cruiseSetDisplay = cruiseSetMps != null ? toSpeedDisplay(cruiseSetMps) : null;

  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Navigation className="h-4 w-4 text-indigo-300" aria-hidden="true" />
        {t('dynamics.autopilot', 'Autopilot & Cruise')}
      </PanelTitle>
      {hasAny ? (
        <Grid minItemWidth="standard" gap={4}>
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={t('dynamics.currentSpeed', 'Current Speed')}
            value={
              currentSpeedDisplay != null
                ? fmtNumber(currentSpeedDisplay, 0)
                : '—'
            }
            unit={speedUnit}
          />
          <StatCard
            icon={<Navigation className="h-5 w-5" aria-hidden="true" />}
            label={t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')}
            value={
              cruiseSetDisplay != null
                ? fmtNumber(cruiseSetDisplay, 0)
                : '—'
            }
            unit={speedUnit}
          />
          <StatCard
            icon={<Navigation className="h-5 w-5" aria-hidden="true" />}
            label={t('dynamics.followDistance', 'Follow Distance')}
            value={followDistance ?? '—'}
          />
        </Grid>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          message={t(
            'dynamics.autopilotNoData',
            'No cruise / autopilot telemetry received yet',
          )}
        />
      )}
    </GlassPanel>
  );
}
