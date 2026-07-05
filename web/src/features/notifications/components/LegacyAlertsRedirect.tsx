/**
 * LegacyAlertsRedirect — Smart query-aware redirect from the legacy
 * `/alerts` route to the new Notifications routes. Translates the
 * old `?tab=` parameter to the appropriate new route while forwarding
 * any other search params (filter, q, page, severity, vehicle_id,
 * rule_id, etc.) so deep links from external systems / saved
 * dashboards keep working.
 *
 *   /alerts                       → /notifications/alerts
 *   /alerts?tab=alerts&filter=…   → /notifications/alerts?filter=…
 *   /alerts?tab=history           → /notifications/inbox
 *   /alerts?tab=preferences       → /notifications/quiet-hours
 */

import { Navigate, useLocation } from 'react-router-dom';

const TAB_TO_ROUTE: Record<string, string> = {
  alerts: '/notifications/alerts',
  history: '/notifications/inbox',
  preferences: '/notifications/quiet-hours',
};

export default function LegacyAlertsRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab') ?? 'alerts';
  // Strip the tab param from forwarded query — it's now path-encoded.
  params.delete('tab');
  // Guard the lookup with an own-property check. A deep link such as
  // `?tab=toString` / `?tab=constructor` would otherwise resolve to an
  // inherited Object.prototype member (a native function — truthy, so the
  // `??` fallback never fires) and corrupt the redirect target. Unknown tabs
  // must fall through to the canonical alerts route.
  const target = Object.prototype.hasOwnProperty.call(TAB_TO_ROUTE, tab)
    ? TAB_TO_ROUTE[tab]
    : '/notifications/alerts';
  const qs = params.toString();
  const to = qs ? `${target}?${qs}` : target;
  return <Navigate to={to} replace />;
}
