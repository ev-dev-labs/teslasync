// Native parity port of
// web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx.
//
// The web component is routing-only: it reads `useLocation().search` and renders
// react-router's `<Navigate to={`/notifications/rules${search}`} replace />` to
// send the legacy `/alert-rules` route to `/notifications/rules`, preserving any
// query string. It has no visible UI.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-router-dom (`Navigate`, `useLocation`) is unavailable in native. The
//     redirect target is computed by `resolveLegacyAlertRulesRedirect(search)`
//     and delivered through an `onRedirect(target, { replace: true })` callback
//     fired once on mount (and again if `search` changes, mirroring how the web
//     `<Navigate>` re-navigates when its `to` prop changes). This follows the
//     same `onNavigate(path)` precedent the native shell App.tsx and the ported
//     Breadcrumbs/HealthRow/ActionItem components use for all react-router
//     navigation; the `replace: true` option preserves the web `replace` flag so
//     the legacy entry is replaced (not pushed) in history.
//   - `useLocation().search` becomes a native-safe `search` prop supplied by the
//     navigation shell (the same `pathname`-prop precedent as RouteTransition /
//     RouteAnnouncer), defaulting to '' (no query string).
//   - `<Navigate>` renders null in the DOM, so the native component likewise
//     renders null (no visible UI) once it has dispatched the redirect.

import {useEffect} from 'react';

/** The canonical destination the legacy `/alert-rules` path redirects to. */
export const LEGACY_ALERT_RULES_TARGET = '/notifications/rules';

/**
 * Documents which behaviours of the original web component survive the React
 * Native port and which degrade to explicit native-safe replacements.
 */
export const nativeLegacyAlertRulesRedirectCapabilities = {
  reactRouterNavigateAvailable: false,
  reactRouterLocationAvailable: false,
  searchParamsPreserved: true,
  replaceSemanticsPreserved: true,
} as const;

export interface LegacyAlertRulesRedirectProps {
  /**
   * Native-safe replacement for `useLocation().search` — the query string
   * (including the leading '?') from the legacy route, preserved on the target.
   * Defaults to '' (no query string).
   */
  search?: string;
  /**
   * Native-safe replacement for react-router's `<Navigate replace />`. Invoked
   * with the resolved target and `{ replace: true }` so the legacy `/alert-rules`
   * entry is replaced (not pushed) in history, matching the web `replace` flag.
   * Optional so the redirect can mount before the navigator is wired.
   */
  onRedirect?: (target: string, options: {replace: boolean}) => void;
}

/**
 * Computes the redirect target for the legacy `/alert-rules` route, preserving
 * any search params — mirrors the web ``/notifications/rules${search}``.
 */
export function resolveLegacyAlertRulesRedirect(search = ''): string {
  return `${LEGACY_ALERT_RULES_TARGET}${search}`;
}

/**
 * LegacyAlertRulesRedirect — redirects `/alert-rules` → `/notifications/rules`
 * preserving any search params. Renders no visible UI (parity with the web
 * `<Navigate replace />`); dispatches `onRedirect` on mount and whenever the
 * `search` value changes.
 */
export default function LegacyAlertRulesRedirect({
  search = '',
  onRedirect,
}: LegacyAlertRulesRedirectProps = {}): null {
  useEffect(() => {
    onRedirect?.(resolveLegacyAlertRulesRedirect(search), {replace: true});
  }, [search, onRedirect]);

  return null;
}

LegacyAlertRulesRedirect.displayName = 'LegacyAlertRulesRedirect';
