import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useAlertContext — read drill-through query params from the URL.
 *
 * Phase 40 / Prompt 14. When a user clicks an alert (toast, alerts page,
 * dashboard widget, browser notification) we navigate to a context page like
 * `/battery?vehicle_id=12&t=2026-04-30T13:00:00Z&signal=BatteryLevel`. Pages
 * call this hook to read those params and:
 *   - preselect the relevant vehicle in their picker, and
 *   - center their chart time-window on the alert timestamp (±30 min).
 *
 * All fields are optional — when no alert context is present in the URL the
 * hook returns nulls and pages should render their default view.
 */

export interface AlertContext {
  /** Vehicle ID from `?vehicle_id=N`, or `null` when absent. */
  vehicleId: number | null;
  /** Raw ISO timestamp from `?t=...`, or `null`. */
  timestamp: string | null;
  /** Signal name from `?signal=...`, or `null`. */
  signal: string | null;
  /** [t-30min, t+30min] chart window. `null` when no timestamp present. */
  timeWindow: { from: string; to: string } | null;
  /** True when at least one drill-through param is present. Convenient for
   *  conditionally rendering "viewing alert context" affordances. */
  hasContext: boolean;
}

const ALERT_WINDOW_MS = 30 * 60_000;

export function useAlertContext(): AlertContext {
  const [params] = useSearchParams();

  return useMemo<AlertContext>(() => {
    const vehicleIdRaw = params.get('vehicle_id');
    const t = params.get('t');
    const signal = params.get('signal');

    const vehicleId = vehicleIdRaw != null && vehicleIdRaw !== ''
      ? Number(vehicleIdRaw)
      : null;
    const safeVehicleId = vehicleId != null && Number.isFinite(vehicleId)
      ? vehicleId
      : null;

    let timeWindow: AlertContext['timeWindow'] = null;
    if (t) {
      const parsed = new Date(t);
      if (!Number.isNaN(parsed.getTime())) {
        timeWindow = {
          from: new Date(parsed.getTime() - ALERT_WINDOW_MS).toISOString(),
          to: new Date(parsed.getTime() + ALERT_WINDOW_MS).toISOString(),
        };
      }
    }

    return {
      vehicleId: safeVehicleId,
      timestamp: t,
      signal: signal,
      timeWindow,
      hasContext: safeVehicleId != null || t != null || signal != null,
    };
  }, [params]);
}
