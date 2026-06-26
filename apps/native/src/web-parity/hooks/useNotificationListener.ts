// Native parity port of web/src/hooks/useNotificationListener.ts.
//
// On the web this hook does two things:
//   1. Manages a tiny `{ alerts, exportStatus }` web-push preference object,
//      persisted to localStorage under 'teslasync-web-push-prefs'.
//   2. Subscribes to the singleton SSE pipe and, FOR DELIVERY, fires browser OS
//      `Notification`s for `alert` / `export_status` events while the tab is
//      hidden, plus a per-channel WebAudio sound cue on every `alert`.
//
// Part (1) — the preference store + `setPrefs` updater — is pure logic and ports
// 1:1; it is the behavior consumers actually read/toggle (the Settings push
// card), so it is preserved verbatim with its state names (`prefs`,
// `setPrefsState`, `setPrefs`) and the same merge-over-defaults / JSON round-trip
// load & save code paths.
//
// Part (2) — the actual notification delivery — is STRUCTURALLY UNAVAILABLE in
// this native parity slice because every primitive it stands on is browser-only
// and is NOT in the apps/native manifest (contract rules 4, 5 & 7):
//   - `useWebPush()` (web L4, L77): the native parity of useWebPush is the
//     server-contract-only api/hooks/usePush.ts, which documents that the
//     browser `Notification` permission gate + `sendNotification()` lifecycle
//     "has no native implementation in this parity slice". React Native has no
//     `window.Notification` constructor, so an alert/export OS notification
//     cannot be raised from JS here. On native, out-of-app notifications are
//     delivered by the OS push transport (FCM / APNs) via the server's
//     push_subscriptions, NOT by an in-JS SSE→Notification bridge.
//   - `sseManager` (web L3, L152-158, L180-183): the browser EventSource
//     singleton has no ported module. The native SSE precedent
//     (api/hooks/useAchievementUnlocks.ts, api/sseClient.ts) guards on a global
//     `EventSource` polyfill and reports an explicit 'unavailable' status when
//     absent — which is the default on React Native. Subscribing here would be
//     inert anyway because both terminal actions below cannot run.
//   - `document.hidden` (web L95, L134): the "only notify when the tab is not
//     visible, to avoid doubling the in-app toast" gate. React Native has no
//     `document`; the foreground analogue is `AppState`
//     (api/queryClient.ts uses `AppState.currentState === 'active'`). But when a
//     RN app is backgrounded — the actual `document.hidden === true` analogue —
//     JS execution is suspended, so an in-JS background-notification bridge would
//     not run; that is precisely why native defers to OS push.
//   - `useNavigate` + `getAlertDrillthroughHref` (web L2, L5, L79, L106-124):
//     web-parity has no react-router, so the OS-notification click → deep-link
//     into the alert's context page is dropped, exactly as
//     AchievementUnlockListener.tsx drops its /lifetime deep-link.
//   - `notificationSound` (web L6-10, L167-178): `mapNotificationToCategory` /
//     `getNotificationSoundPrefs` / `playNotificationSound` are an unconverted
//     WebAudio + localStorage module. React Native exposes no global
//     `AudioContext`, so the sound cue cannot play — the same guarded-no-op
//     fallback AchievementUnlockListener.tsx already documents for its chime.
//
// Because delivery cannot fire on native, this port does NOT wire a dead SSE
// subscription (mirroring usePush.ts, which kept the server contract and dropped
// the browser lifecycle). Instead it exposes an explicit, consumable
// `notificationDeliveryStatus: 'unavailable'` + `unavailableReason` (the
// established native explicit-unavailable shape from useAchievementUnlocks'
// `realtimeStatus` / `unavailableReason`). The `{ prefs, setPrefs }` return is a
// superset, so existing destructuring consumers are byte-compatible.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only react's `useCallback` / `useState`.

import {useCallback, useState} from 'react';

const PREFS_KEY = 'teslasync-web-push-prefs';

export interface WebPushPreferences {
  alerts: boolean;
  exportStatus: boolean;
}

const DEFAULT_PREFS: WebPushPreferences = {
  alerts: true,
  exportStatus: true,
};

/** Functional-or-direct updater signature for {@link WebPushPreferences}. */
export type SetWebPushPreferences = (
  next: WebPushPreferences | ((prev: WebPushPreferences) => WebPushPreferences),
) => void;

// Native analogue of the single browser localStorage slot keyed by PREFS_KEY.
// React Native has no localStorage, so the push prefs persist for the current
// app process only; cold-restart persistence is unavailable. This mirrors the
// established in-memory-Map shim used by useKioskMode.ts / useVehiclePaint.ts.
const prefsStore = new Map<string, string>();

function loadPrefs(): WebPushPreferences {
  try {
    const raw = prefsStore.get(PREFS_KEY);
    if (!raw) {
      return DEFAULT_PREFS;
    }
    return {...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<WebPushPreferences>)};
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: WebPushPreferences): void {
  prefsStore.set(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * Shape of the SSE `alert` payload (web/src/api/types Alert plus the rule
 * drill-through metadata). Preserved verbatim from the web hook so the payload
 * contract is documented even though native cannot raise the OS notification it
 * would feed. Keys are snake_case because the raw SSE stream is not passed
 * through camelCaseKeys.
 */
export interface AlertEventData {
  id?: number;
  title?: string;
  message?: string;
  severity?: string;
  vehicle_name?: string;
  vehicle_id?: number;
  rule_id?: number | null;
  rule_signal?: string | null;
  rule_severity?: string | null;
  type?: string;
  created_at?: string;
  quiet_suppressed?: boolean;
  is_test?: boolean;
}

/** Shape of the SSE `export_status` payload. Preserved from the web hook. */
export interface ExportStatusData {
  status?: string;
  filename?: string;
  format?: string;
  error?: string;
}

/** Delivery channel availability — only ever 'unavailable' on native. */
export type NotificationDeliveryStatus = 'unavailable';

export const NOTIFICATION_LISTENER_UNAVAILABLE_REASON =
  'React Native cannot raise web Notification / export-status OS notifications or WebAudio cues from JS; out-of-app alerts are delivered by the OS push transport (FCM/APNs) via push_subscriptions. The browser Notification permission gate, sseManager, document.hidden visibility gate, react-router drill-through, and notificationSound module are all browser-only and absent from the native parity manifest.';

export interface UseNotificationListenerResult {
  /** Current web-push preferences. State name preserved from the web hook. */
  prefs: WebPushPreferences;
  /**
   * Persist + update the preferences. Accepts a direct value or a functional
   * updater, exactly like the web hook. Persistence is in-memory on native.
   */
  setPrefs: SetWebPushPreferences;
  /**
   * Whether the SSE→OS-notification / sound delivery effects can run. Always
   * 'unavailable' on native — see {@link NOTIFICATION_LISTENER_UNAVAILABLE_REASON}.
   */
  notificationDeliveryStatus: NotificationDeliveryStatus;
  /** Explanation for the unavailable delivery state, or null if available. */
  unavailableReason: string | null;
}

/**
 * Listens to SSE events and (on the web) fires browser Notifications for alerts
 * and export-status updates while the tab is hidden, plus per-channel sound
 * cues. On React Native the delivery side is structurally unavailable (no
 * `window.Notification`, no `document.hidden`, no global `AudioContext`, no
 * ported sseManager / useWebPush / notificationSound / router) so this hook
 * degrades to the portable preference store + an explicit unavailable delivery
 * status; out-of-app alert delivery is owned by the OS push transport.
 *
 * @example
 *   const {prefs, setPrefs, notificationDeliveryStatus} = useNotificationListener();
 *   // Toggle the Settings push card:
 *   setPrefs(prev => ({...prev, alerts: !prev.alerts}));
 */
export function useNotificationListener(): UseNotificationListenerResult {
  const [prefs, setPrefsState] = useState<WebPushPreferences>(loadPrefs);

  const setPrefs = useCallback<SetWebPushPreferences>(next => {
    setPrefsState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      savePrefs(resolved);
      return resolved;
    });
  }, []);

  // The web hook installed two `useEffect`s here:
  //   1. permission-gated SSE 'alert' / 'export_status' → browser Notification
  //      (gated on prefs + `document.hidden`, skipping quiet_suppressed / is_test
  //      alerts; alert copy = `data.title ?? 'TeslaSync Alert'` with body
  //      `[vehicle_name, message].filter(Boolean).join(' — ')`; export copy =
  //      'Export Ready' / `${filename} is ready for download` or 'Export Failed'
  //      / `data.error ?? 'Data export failed…'`; an optional OS-notification
  //      click deep-linked via getAlertDrillthroughHref).
  //   2. an always-on SSE 'alert' → playNotificationSound(mapNotificationToCategory).
  // Neither can run on React Native (see the file header for the full
  // primitive-by-primitive rationale), so both are intentionally not wired and
  // surfaced through `notificationDeliveryStatus` below instead.

  return {
    prefs,
    setPrefs,
    notificationDeliveryStatus: 'unavailable',
    unavailableReason: NOTIFICATION_LISTENER_UNAVAILABLE_REASON,
  };
}
