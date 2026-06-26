// Native parity port of web/src/hooks/useTitleBadge.ts.
//
// On the web this hook is a mount-once side effect that mirrors the unread
// notification count into the browser tab's `document.title` as a "(N) " prefix
// (capped at "99+"), gated on the `tab_badge_enabled` Setting. It also opens an
// SSE 'alert' subscription purely to invalidate the unread-count query so the
// badge refreshes within a few hundred milliseconds of an alert firing instead
// of waiting for the 30s poll, then clears the title prefix on unmount.
//
// Two of its three moving parts are structurally browser-only and absent from
// the native parity manifest (contract rules 4, 5 & 7):
//
//   - `titleStore.setBasePrefix` / `document.title` (web L6, L39, L43, L49):
//     React Native has no browser tab and no global `document.title`. The web
//     `titleStore` singleton exists because there is exactly one window title
//     bar to own; native has no such global surface, so the count badge cannot
//     be "pushed" into a title. Instead this port DERIVES the badge and RETURNS
//     it — the established native pattern of turning a global-mutation side
//     effect into consumable state (cf. useChartPalette returning a value rather
//     than writing a global). A native host (a tab-bar badge, a header badge, or
//     the OS app-icon badge) renders `badgePrefix` / `badgeLabel` from this
//     return. Because the value is returned rather than written to a global, the
//     web "clear the prefix on unmount so a remount doesn't leave a stale badge"
//     cleanup is satisfied for free: unmounting simply stops rendering it; no
//     global is left dirty.
//
//   - `sseManager` (web L5, L33-34) plus `useQueryClient` / `notificationKeys`
//     (web L1-3, L22, L31): the browser EventSource singleton's generic 'alert'
//     channel has no ported module (the native `api/sseClient.ts` only carries
//     typed `signal_change` envelopes, not generic alert broadcasts), so the
//     fast-refresh-on-alert optimization cannot be wired. This is NOT a loss of
//     correctness: the count still refreshes on the native `useUnreadCount` 30s
//     `refetchInterval` poll, exactly as the web badge would if SSE were down.
//     Following the useNotificationListener precedent we do not wire a dead SSE
//     subscription; the unavailable fast-path is surfaced explicitly through
//     `titleSyncStatus` / `unavailableReason`.
//
// The portable core — read the unread count + `tab_badge_enabled`, cap at 99+,
// and only show the badge when enabled and the count is non-zero — ports 1:1.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only the native parity TanStack Query hooks.

import { useSettings } from '../api/hooks/useSettings';
import { useUnreadCount } from '../api/hooks/useNotifications';

/** Largest exact count shown before the badge collapses to "99+". */
export const TITLE_BADGE_MAX = 99;

/** Browser-tab title-mirror availability — only ever 'unavailable' on native. */
export type TitleBadgeSyncStatus = 'unavailable';

export const TITLE_BADGE_SYNC_UNAVAILABLE_REASON =
  'React Native has no browser tab / global document.title to mirror the unread badge into, and no ported sseManager "alert" channel for the fast-refresh-on-alert path (api/sseClient.ts carries only typed signal_change envelopes). The badge value is returned for a native host to render, and the unread count still refreshes via the useUnreadCount 30s poll.';

export interface UseTitleBadgeResult {
  /** Current unread-notification count (0 while the query is loading). */
  count: number;
  /** Whether the tab badge is enabled (`tab_badge_enabled !== false`). */
  enabled: boolean;
  /** True when the badge should be shown (`enabled` and `count !== 0`). */
  visible: boolean;
  /**
   * Display label for the count, capped at "99+". Empty string when the badge
   * is hidden. e.g. `'3'`, `'99+'`, or `''`.
   */
  badgeLabel: string;
  /**
   * The exact prefix the web hook pushed into `document.title`: `'(3) '`,
   * `'(99+) '`, or `''` when hidden. Provided so a native title/header host can
   * reproduce the web badge string verbatim.
   */
  badgePrefix: string;
  /**
   * Whether the browser-tab title mirror + SSE fast-refresh can run. Always
   * 'unavailable' on native — see {@link TITLE_BADGE_SYNC_UNAVAILABLE_REASON}.
   */
  titleSyncStatus: TitleBadgeSyncStatus;
  /** Explanation for the unavailable title sync, or null if available. */
  unavailableReason: string | null;
}

/**
 * Native parity of the web unread-count tab badge.
 *
 * Reads the unread count (`useUnreadCount`) and the `tab_badge_enabled` Setting
 * (`useSettings`), then derives the "(N) " / "(99+) " badge — capped at 99+ and
 * shown only when enabled and the count is non-zero. On the web this was written
 * straight into `document.title` via the `titleStore` singleton and kept fresh
 * by an SSE 'alert' subscription; React Native has neither a global tab title
 * nor a ported generic-alert SSE channel, so the badge is RETURNED for a native
 * host (tab bar / header / app-icon badge) to render and the count refreshes on
 * the existing `useUnreadCount` poll. See the file header for the
 * primitive-by-primitive rationale.
 *
 * @example
 *   const {badgePrefix, badgeLabel, visible} = useTitleBadge();
 *   // header title: `${badgePrefix}TeslaSync`  ->  "(3) TeslaSync"
 *   // tab badge:    visible ? <Badge>{badgeLabel}</Badge> : null
 */
export function useTitleBadge(): UseTitleBadgeResult {
  const { data: count = 0 } = useUnreadCount();
  const { data: settings } = useSettings();
  const enabled = settings?.tab_badge_enabled !== false;

  const visible = enabled && count !== 0;
  const cappedLabel =
    count > TITLE_BADGE_MAX ? `${TITLE_BADGE_MAX}+` : String(count);
  const badgeLabel = visible ? cappedLabel : '';
  const badgePrefix = visible ? `(${badgeLabel}) ` : '';

  return {
    count,
    enabled,
    visible,
    badgeLabel,
    badgePrefix,
    titleSyncStatus: 'unavailable',
    unavailableReason: TITLE_BADGE_SYNC_UNAVAILABLE_REASON,
  };
}
