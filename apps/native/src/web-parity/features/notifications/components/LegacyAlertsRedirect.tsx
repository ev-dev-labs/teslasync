/**
 * LegacyAlertsRedirect — native parity port of
 * web/src/features/notifications/components/LegacyAlertsRedirect.tsx.
 *
 * Web role (verbatim intent, source L1-13): a smart, query-aware redirect from
 * the legacy `/alerts` route to the new Notifications routes. It translates the
 * old `?tab=` parameter to the appropriate new route while forwarding any other
 * search params (filter, q, page, severity, vehicle_id, rule_id, …) so deep
 * links from external systems / saved dashboards keep working:
 *
 *   /alerts                       → /notifications/alerts
 *   /alerts?tab=alerts&filter=…   → /notifications/alerts?filter=…
 *   /alerts?tab=history           → /notifications/inbox
 *   /alerts?tab=preferences       → /notifications/quiet-hours
 *
 * Native adaptations (route targets + param-forwarding behavior preserved):
 *   - react-router-dom `useLocation` (web L15, L24) -> a native-safe `search`
 *     prop. React Native has no DOM `location`, so the navigation shell passes
 *     the legacy query string (with or without a leading '?') instead.
 *   - react-router-dom `<Navigate to replace />` (web L15, L32) -> there is no
 *     DOM history to replace on native; the resolved target is handed to an
 *     optional `onRedirect` navigation-shell callback (fired once on mount, like
 *     Navigate's mount-time replace) and rendered as an explicit redirect-state
 *     surface so the unavailable-DOM-navigation state stays visible and testable
 *     (conversion rule 7).
 *   - The TAB_TO_ROUTE map (web L17-21), the `tab` default of 'alerts'
 *     (web L26), the tab-strip (web L28), the '/notifications/alerts' default
 *     target (web L29), and the `qs ? target?qs : target` assembly (web L30-31)
 *     are ported into the pure, testable `resolveLegacyAlertsRedirect`. The web
 *     `new URLSearchParams(location.search)` (L25) used `.get`/`.delete`/
 *     `.toString`; the React Native URLSearchParams type only exposes
 *     `append`/`toString`, so a small self-contained parser reproduces the same
 *     x-www-form-urlencoded semantics (first-value get, drop-all delete,
 *     order-preserving serialize) verbatim.
 *
 * The new route targets exist in the native route manifest as
 * `notifications-alerts`, `notifications-inbox`, and `notifications-quiet-hours`
 * (see ../../../../navigation/routes.ts), all resolving to the AlertsScreen.
 */

import React, {useEffect} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {spacing} from '../../../../theme/tokens';

/**
 * Browser-only capabilities this redirect cannot reproduce on native, surfaced
 * for parity tooling (mirrors the RouteAnnouncer capability convention).
 */
export const nativeLegacyAlertsRedirectCapabilities = {
  reactRouterLocationAvailable: false,
  reactRouterNavigateAvailable: false,
  domHistoryReplaceAvailable: false,
  nativeRedirectCallbackSupported: true,
} as const;

/** web L17-21 — legacy `?tab=` value to new Notifications route. */
const TAB_TO_ROUTE: Record<string, string> = {
  alerts: '/notifications/alerts',
  history: '/notifications/inbox',
  preferences: '/notifications/quiet-hours',
};

/** x-www-form-urlencoded decode: '+' becomes space, then percent-decode. */
function decodeFormComponent(value: string): string {
  const withSpaces = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
}

/** Mirrors URLSearchParams.toString() encoding: encodeURIComponent, space -> '+'. */
function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

/**
 * Parse a `location.search` string into ordered key/value pairs, matching
 * `new URLSearchParams(search)`: a single leading '?' is ignored and a
 * key with no '=' yields an empty-string value.
 */
function parseSearchPairs(search: string): Array<[string, string]> {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (!query) {
    return [];
  }
  return query
    .split('&')
    .filter(pair => pair.length > 0)
    .map(pair => {
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
      return [decodeFormComponent(rawKey), decodeFormComponent(rawValue)];
    });
}

/**
 * Pure port of the web redirect resolution (source L25-31): given the legacy
 * `location.search` string, translate the `?tab=` param to the new route and
 * forward every other query param. Behavior matches the web component 1:1,
 * including the 'alerts' tab default (L26), the tab-strip (L28), the
 * '/notifications/alerts' fallback target (L29), and the `target?qs` assembly
 * (L30-31). `get` returns the first 'tab' value; `delete` drops every 'tab'.
 */
export function resolveLegacyAlertsRedirect(search: string): string {
  const params = parseSearchPairs(search);
  const tab = params.find(([key]) => key === 'tab')?.[1] ?? 'alerts';
  // Strip the tab param from forwarded query — it's now path-encoded.
  const forwarded = params.filter(([key]) => key !== 'tab');
  const target = TAB_TO_ROUTE[tab] ?? '/notifications/alerts';
  const qs = forwarded
    .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
    .join('&');
  return qs ? `${target}?${qs}` : target;
}

export interface LegacyAlertsRedirectProps {
  /**
   * Native-safe replacement for react-router's `location.search`. The legacy
   * query string, with or without a leading '?'. Defaults to '' (bare /alerts).
   */
  search?: string;
  /**
   * Native navigation-shell callback invoked once on mount with the resolved
   * target route, mirroring `<Navigate to replace />`'s mount-time replace.
   */
  onRedirect?: (target: string) => void;
}

export default function LegacyAlertsRedirect({
  search = '',
  onRedirect,
}: LegacyAlertsRedirectProps = {}) {
  const to = resolveLegacyAlertsRedirect(search);

  useEffect(() => {
    onRedirect?.(to);
  }, [onRedirect, to]);

  return (
    <GlassPanel
      accessible
      accessibilityLabel={`Redirecting legacy /alerts to ${to}`}
      style={styles.panel}
      testID="legacy-alerts-redirect">
      <AppText variant="caption" tone="muted">
        Legacy /alerts redirect
      </AppText>
      <AppText tone="accent" weight="semibold">
        {to}
      </AppText>
      <View>
        <AppText variant="caption" tone="secondary">
          DOM history replace is unavailable on native; the navigation shell
          handles the redirect via onRedirect.
        </AppText>
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.xs,
    padding: spacing.md,
  },
});
