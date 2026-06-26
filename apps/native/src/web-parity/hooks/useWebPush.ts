// Native parity port of web/src/hooks/useWebPush.ts.
//
// The web hook manages three browser surfaces:
//   1. The Notification permission gate (`permission` / `requestPermission`).
//   2. An in-app toast via the `Notification` constructor (`sendNotification`,
//      deprecated, only fires while the tab is open).
//   3. The Web Push (VAPID) subscribe/unsubscribe lifecycle that registers this
//      browser-device pairing with the server (`subscribe` / `unsubscribe`,
//      `isSubscribed`, `currentEndpoint`), driving the per-device list in the
//      Settings "Browser Push" channel card.
//
// CONVERSION STRATEGY — runtime feature detection, not a hard stub.
// This app has a react-native-web target (see vite.config.mts / index.web.tsx /
// the react-native-web dependency). On that target the code runs inside a real
// browser where `window.Notification`, `window.PushManager`, and
// `navigator.serviceWorker` exist, so the full web-push lifecycle is genuinely
// usable and behavior is preserved 1:1. On the bare native targets
// (iOS/Android/Windows/macOS Hermes) none of those globals exist, so every
// feature-detected branch falls through to its "unsupported" return — exactly
// the shape the web hook itself returns in a browser that lacks these APIs
// (isSupported/isPushSupported/isSubscribed false, permission 'denied', no-op
// subscribe/unsubscribe). This mirrors the established native precedent of
// feature-detecting browser globals via `globalThis` casts rather than importing
// DOM types (cf. ImportPreviewModal.tsx feature-detecting `atob`, and the
// clipboard feature-detection in GrafanaPanelPage / JsonFormatter / ResponseViewer),
// and it is strictly more faithful than the all-false `useNativeWebPush()` shim
// inlined in BrowserPushChannelCard.tsx because it restores real functionality on
// the web target while keeping the same return shape.
//
// Per contract rule 7 the hook also surfaces an explicit, consumable
// `pushStatus` ('available' | 'unavailable') + `unavailableReason`, following the
// useNotificationListener / useTitleBadge explicit-unavailable precedent. These
// are additive — the rest of the return is a byte-compatible superset of the web
// hook, so existing destructuring consumers keep working.
//
// The server contract (GET /push/public-key, POST/DELETE /push/subscribe) is
// reached through the already-ported native TanStack Query hooks in
// ../api/hooks/usePush.ts, the native parity of the web's @/api/hooks/usePush.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only react's useCallback/useEffect/useState and the
// native parity push hooks. The DOM `Notification`, `ServiceWorkerRegistration`,
// `PushManager`, and `PushSubscription` types are modelled by minimal local
// interfaces and read off `globalThis` (which is `window` on react-native-web
// and `global` on bare native).

import {useCallback, useEffect, useState} from 'react';

import {
  usePushPublicKey,
  useSubscribePush,
  useUnsubscribePush,
} from '../api/hooks/usePush';

/**
 * Native-safe replacement for the DOM `NotificationPermission` union (web L39).
 * Identical members so the value round-trips through the server/UI unchanged.
 */
export type WebNotificationPermission = 'default' | 'denied' | 'granted';

/**
 * Minimal structural model of the DOM `NotificationOptions` bag passed to
 * `sendNotification` (web L87). Open-ended so any browser-recognised option
 * (`body`, `silent`, `requireInteraction`, …) still flows through on
 * react-native-web.
 */
export interface WebNotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: unknown;
  [key: string]: unknown;
}

/** Minimal model of the DOM `Notification` instance `sendNotification` returns. */
export interface WebNotificationHandle {
  onclick: (() => void) | null;
  close(): void;
}

/** Construct + static surface of the browser `Notification` global we rely on. */
interface WebNotificationCtor {
  new (title: string, options?: WebNotificationOptions): WebNotificationHandle;
  readonly permission: WebNotificationPermission;
  requestPermission(): Promise<WebNotificationPermission>;
}

/** Shape returned by `PushSubscription.toJSON()` (web L142-145). */
interface WebPushSubscriptionJSON {
  endpoint?: string;
  keys?: {p256dh?: string; auth?: string};
}

/** Minimal model of a browser `PushSubscription`. */
interface WebPushSubscription {
  endpoint: string;
  toJSON(): WebPushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

/** Minimal model of `registration.pushManager`. */
interface WebPushManager {
  getSubscription(): Promise<WebPushSubscription | null>;
  subscribe(options: {
    userVisibleOnly?: boolean;
    applicationServerKey?: Uint8Array | string | null;
  }): Promise<WebPushSubscription>;
}

/** Minimal model of a browser `ServiceWorkerRegistration`. */
interface WebServiceWorkerRegistration {
  readonly pushManager: WebPushManager;
}

/** Minimal model of `navigator.serviceWorker`. */
interface WebServiceWorkerContainer {
  getRegistration(): Promise<WebServiceWorkerRegistration | undefined>;
}

// Read the browser globals off `globalThis` once (web read them off `window` /
// `navigator` at module scope, L4-8). On react-native-web these resolve to the
// real browser APIs; on bare native they are all `undefined`.
const NotificationGlobal = (
  globalThis as {Notification?: WebNotificationCtor}
).Notification;
const pushManagerGlobal = (globalThis as {PushManager?: unknown}).PushManager;
const serviceWorkerContainer = (
  globalThis as {navigator?: {serviceWorker?: WebServiceWorkerContainer}}
).navigator?.serviceWorker;

// web L4: `typeof window !== 'undefined' && 'Notification' in window`.
const isSupported = typeof NotificationGlobal !== 'undefined';
// web L5-8: PushManager in window && serviceWorker in navigator.
const isPushAPISupported =
  typeof pushManagerGlobal !== 'undefined' &&
  typeof serviceWorkerContainer !== 'undefined';

/**
 * Convert a base64url string (the encoding used by VAPID public keys over the
 * wire) to the `Uint8Array` shape `PushManager.subscribe()` expects for
 * `applicationServerKey`. The standard MDN helper (web L17-28), kept inline
 * because it is the only place we use it. The browser-only `atob` is
 * feature-detected (present on react-native-web / Hermes / the Node test
 * runner); this helper only runs from `subscribe()` after the PushManager
 * feature gate, so on bare native it is never reached.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decode = (globalThis as {atob?: (input: string) => string}).atob;
  if (typeof decode !== 'function') {
    throw new Error('atob is unavailable in this environment');
  }
  const rawData = decode(base64);
  // Allocate a fresh ArrayBuffer so the result is assignable to the
  // applicationServerKey BufferSource the browser expects.
  const buf = new ArrayBuffer(rawData.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < rawData.length; i++) {
    out[i] = rawData.charCodeAt(i);
  }
  return out;
}

/** Web-push availability — 'available' on react-native-web, 'unavailable' on bare native. */
export type WebPushStatus = 'available' | 'unavailable';

export const WEB_PUSH_UNAVAILABLE_REASON =
  'This React Native target has no window.Notification constructor, PushManager, or navigator.serviceWorker, so the browser Notification-permission gate, in-app sendNotification(), and the PushManager subscribe/unsubscribe lifecycle cannot run. The VAPID public key is still fetched (usePushPublicKey) to preserve the server contract, but isSupported/isPushSupported/isSubscribed are false and out-of-app delivery is owned by the OS push transport (FCM/APNs) via push_subscriptions. On the react-native-web target these globals exist and the full lifecycle runs unchanged.';

/** Return shape of {@link useWebPush}. Superset of the web hook's return. */
export interface UseWebPushResult {
  permission: WebNotificationPermission;
  requestPermission: () => Promise<WebNotificationPermission>;
  sendNotification: (
    title: string,
    options?: WebNotificationOptions,
    onClick?: () => void,
  ) => WebNotificationHandle | null;
  isSupported: boolean;
  isPushSupported: boolean;
  isSubscribed: boolean;
  currentEndpoint: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  /** Whether the browser push lifecycle can run on this target. */
  pushStatus: WebPushStatus;
  /** Explanation when push is unavailable (bare native), else null. */
  unavailableReason: string | null;
}

/**
 * Hook for managing browser Notification permissions, in-app notifications, and
 * Web Push (VAPID) subscriptions for out-of-tab delivery.
 *
 * The hook returns BOTH the original "in-app toast" path (`sendNotification`,
 * useful while the tab is open) AND the Push API path (`subscribe` /
 * `unsubscribe`) so existing callers keep working. On the react-native-web
 * target it behaves exactly like the web hook; on bare native every browser
 * surface is absent, so it degrades to the documented unsupported shape and
 * exposes `pushStatus: 'unavailable'` + {@link WEB_PUSH_UNAVAILABLE_REASON}.
 */
export function useWebPush(): UseWebPushResult {
  const [permission, setPermission] = useState<WebNotificationPermission>(
    isSupported && NotificationGlobal ? NotificationGlobal.permission : 'denied',
  );
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  const {data: publicKey} = usePushPublicKey();
  const subscribeMut = useSubscribePush();
  const unsubscribeMut = useUnsubscribePush();

  /**
   * Reflect the existing browser-side subscription (if any) into local state so
   * the UI knows whether to render "Enable" or "Disable" on mount. We read
   * `pushManager.getSubscription()` — the only authoritative source for "is THIS
   * device registered". On bare native the feature gate short-circuits and the
   * effect is an inert no-op (web L56-69).
   */
  useEffect(() => {
    if (!isPushAPISupported || !serviceWorkerContainer) {
      return;
    }
    let cancelled = false;
    void serviceWorkerContainer.getRegistration().then(async reg => {
      if (!reg || cancelled) {
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) {
        return;
      }
      setIsSubscribed(!!sub);
      setCurrentEndpoint(sub?.endpoint ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPermission =
    useCallback(async (): Promise<WebNotificationPermission> => {
      if (!isSupported || !NotificationGlobal) {
        return 'denied';
      }
      const result = await NotificationGlobal.requestPermission();
      setPermission(result);
      return result;
    }, []);

  /**
   * In-app notification (Notification API only — does NOT survive a closed tab).
   * Kept for the alert-toast path; new code targeting closed-tab delivery should
   * use `subscribe()` instead (web L86-108).
   *
   * @deprecated Prefer `subscribe()` for out-of-tab notifications.
   */
  const sendNotification = useCallback(
    (
      title: string,
      options?: WebNotificationOptions,
      onClick?: () => void,
    ): WebNotificationHandle | null => {
      if (!isSupported || !NotificationGlobal || permission !== 'granted') {
        return null;
      }
      const n = new NotificationGlobal(title, {
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        ...options,
      });
      n.onclick = () => {
        const focus = (globalThis as {focus?: () => void}).focus;
        if (typeof focus === 'function') {
          focus();
        }
        if (onClick) {
          try {
            onClick();
          } catch {
            /* swallow — best-effort navigation */
          }
        }
        n.close();
      };
      return n;
    },
    [permission],
  );

  /**
   * Register this browser-device pairing for Web Push. Returns true on success,
   * false otherwise (web L122-162). Side effects:
   *   1. Asks for Notification permission if not yet granted.
   *   2. Calls pushManager.subscribe() with the server's VAPID public key.
   *   3. POSTs the subscription JSON to /push/subscribe.
   * Surfaces toast feedback via the underlying mutation hooks.
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushAPISupported || !serviceWorkerContainer || !publicKey) {
      return false;
    }

    let perm = permission;
    if (perm !== 'granted') {
      perm = await requestPermission();
      if (perm !== 'granted') {
        return false;
      }
    }

    const reg = await serviceWorkerContainer.getRegistration();
    if (!reg) {
      return false;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return false;
    }

    try {
      await subscribeMut.mutateAsync({
        endpoint: json.endpoint,
        keys: {p256dh: json.keys.p256dh, auth: json.keys.auth},
      });
      setIsSubscribed(true);
      setCurrentEndpoint(json.endpoint);
      return true;
    } catch {
      // Mutation already toasted — leave the browser-side subscription in place
      // so the user can retry without going through the permission prompt again.
      return false;
    }
  }, [permission, publicKey, requestPermission, subscribeMut]);

  /**
   * Reverse of subscribe(): unregisters the server FIRST so it stops sending
   * immediately, then unsubscribes the browser. Order matters — if the browser
   * side went first and the server call failed, the server would keep pushing to
   * a dead endpoint until it returned 410 (web L170-191).
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushAPISupported || !serviceWorkerContainer) {
      return false;
    }
    const reg = await serviceWorkerContainer.getRegistration();
    if (!reg) {
      return false;
    }
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      setIsSubscribed(false);
      setCurrentEndpoint(null);
      return true;
    }
    try {
      await unsubscribeMut.mutateAsync(sub.endpoint);
    } catch {
      // Even on server failure, proceed with browser-side unsubscribe so the
      // user gets the immediate effect they asked for. The mutation toasted.
    }
    await sub.unsubscribe();
    setIsSubscribed(false);
    setCurrentEndpoint(null);
    return true;
  }, [unsubscribeMut]);

  return {
    permission,
    requestPermission,
    sendNotification,
    isSupported,
    isPushSupported: isPushAPISupported && !!publicKey,
    isSubscribed,
    currentEndpoint,
    subscribe,
    unsubscribe,
    pushStatus: isPushAPISupported ? 'available' : 'unavailable',
    unavailableReason: isPushAPISupported ? null : WEB_PUSH_UNAVAILABLE_REASON,
  };
}
