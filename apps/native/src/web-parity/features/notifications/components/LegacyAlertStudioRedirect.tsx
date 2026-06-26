// Native parity port of
// web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx.
//
// The web component (web L1-12) is a route-level redirect: it reads the
// current location's query string via react-router-dom `useLocation` and
// renders `<Navigate to={`/notifications/studio${search}`} replace />` so a
// hit on the legacy `/alert-studio` path is transparently rewritten to
// `/notifications/studio` while preserving any `?...` search params. That
// keeps existing draft-restore links (`/alert-studio?id=42`) and email CTAs
// (`/alert-studio?rule=7`, `?test=1`, `?signals=...&from=signal-diff`)
// working after the page moved under `/notifications`.
//
// Two of its building blocks are browser-only and have no React Native analog;
// each is handled as an explicit, documented native-safe adaptation:
//
//   - react-router-dom `useLocation` (web L7, L10): React Native has no DOM
//     router/history, so the current query string is accepted as a native-safe
//     `search` prop (the exact value `useLocation().search` would supply,
//     including its leading `?`). It defaults to `''`, matching a location with
//     no query string.
//
//   - react-router-dom `Navigate ... replace` (web L7, L11): the web component
//     renders nothing visible — `Navigate` is a render-time navigation
//     side-effect. React Native has no `<Navigate>` element and navigation is
//     driven by the in-process navigation shell, so the redirect is delegated
//     to a native-safe `onRedirect(to, { replace })` callback (the analog of
//     `Navigate`'s imperative `navigate(to, { replace })`). The component fires
//     it as a mount/location-change side-effect and, like `Navigate`, renders
//     `null` — exactly the pattern the native App parity shell already uses for
//     redirect handling (App.tsx `setActivePath(redirectTo)` effect) and for
//     non-visual side-effect components (App.tsx `RecentPagesRecorder` -> null).
//
// No DOM elements, react-router-dom, Recharts, Leaflet, or old web UI
// components are imported — only React's `useEffect`.

import {useEffect} from 'react';

/**
 * Destination the legacy `/alert-studio` path redirects to, preserved verbatim
 * from web L11 (`/notifications/studio`). Exported so the native navigation
 * shell and tests share a single source of truth.
 */
export const LEGACY_ALERT_STUDIO_REDIRECT_TARGET = '/notifications/studio';

/**
 * Documents which browser capabilities the web redirect relied on and how the
 * native port stands in for them. Mirrors the `native*Capabilities` convention
 * used by sibling parity ports (e.g. RouteAnnouncer).
 */
export const nativeLegacyAlertStudioRedirectCapabilities = {
  reactRouterLocationAvailable: false,
  domNavigateAvailable: false,
  nativeRedirectPropsSupported: true,
} as const;

/**
 * Native-safe replacement for `Navigate`'s imperative navigation. Receives the
 * fully-resolved destination (target path + preserved search) and the
 * `replace` intent from the web `<Navigate replace />`.
 */
export type AlertStudioRedirectHandler = (
  to: string,
  options: {replace: boolean},
) => void;

export interface LegacyAlertStudioRedirectProps {
  /**
   * Native-safe replacement for `useLocation().search` (web L10) — the query
   * string to carry over, including its leading `?` (e.g. `?id=42`). Defaults
   * to `''`, matching a location with no query string.
   */
  search?: string;
  /**
   * Native-safe replacement for `<Navigate replace />` (web L11). Called with
   * the resolved destination so the navigation shell performs the redirect.
   * Optional so the component can be mounted before a shell wires navigation;
   * when absent the redirect is a no-op and the component simply renders null,
   * just as `Navigate` renders nothing.
   */
  onRedirect?: AlertStudioRedirectHandler;
  /**
   * Whether the redirect replaces the current history entry. Mirrors the web
   * `replace` prop; defaults to `true` to match `<Navigate ... replace />`.
   */
  replace?: boolean;
}

/**
 * Resolves the redirect destination exactly like web L11's
 * `` `/notifications/studio${search}` `` template literal: the target path with
 * the preserved search string appended (empty when none).
 */
export function buildAlertStudioRedirectTarget(search?: string): string {
  return `${LEGACY_ALERT_STUDIO_REDIRECT_TARGET}${search ?? ''}`;
}

export default function LegacyAlertStudioRedirect({
  search = '',
  onRedirect,
  replace = true,
}: LegacyAlertStudioRedirectProps = {}) {
  const to = buildAlertStudioRedirectTarget(search);

  useEffect(() => {
    onRedirect?.(to, {replace});
  }, [to, replace, onRedirect]);

  return null;
}

LegacyAlertStudioRedirect.displayName = 'LegacyAlertStudioRedirect';
