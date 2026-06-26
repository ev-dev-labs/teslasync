// Native parity port of web/src/lib/broadcast.ts.
//
// Cross-surface synchronization.
//
// A small, typed message bus that lets multiple surfaces of the same app react
// to each other's writes without a reload. On the web this was backed by
// `BroadcastChannel` (modern browsers) with a `localStorage` storage-event
// fallback for older Safari + private mode.
//
// ## Why
//
// The TeslaSync SPA is routinely opened in 2+ browser tabs (a pinned live
// dashboard and a foreground "I'm editing" tab). Mutating something in one
// surface (theme, alert rule, dismiss "what's new", etc.) would leave the other
// looking at stale data until it refetched or reloaded. This bus closes that
// gap.
//
// ## Native conversion (contract rule 7)
//
// React Native ships no `BroadcastChannel`, no `window`, and no `localStorage`,
// so the two browser-only transports are not universally available. Following
// the sibling `useEditLease` / `useSettings` parity ports, the transports are
// replaced by native-safe seams that:
//   - keep the full typed `BroadcastMessage` union, the `_from`/`_ts` envelope,
//     and the `TAB_ID` self-filter (all platform-agnostic),
//   - AUTO-DETECT a global `BroadcastChannel` AND a global `localStorage` +
//     `storage` event when the platform provides them (the react-native-web
//     browser build / a host polyfill), preserving real cross-tab parity there
//     with the same envelope semantics as the web bus,
//   - otherwise are a documented no-op whose `BROADCAST_BUS_UNAVAILABLE_REASON`
//     explains the platform limitation, and
//   - accept a host-injected transport via `setBroadcastTransport` (the native
//     analog of the cross-tab bus, e.g. backed by a socket or push fanout).
//
// ## Design constraints (unchanged from web)
//
//   1. **Single channel** named `'teslasync'` so all features share one
//      broadcaster.
//   2. **Lazy channel construction** — never paid in SSR / tests that don't
//      touch the bus.
//   3. **Self-surface filter** — every envelope carries `_from: TAB_ID`. The
//      subscriber drops messages whose `_from` matches the current surface.
//      `BroadcastChannel.postMessage` does NOT echo to the same channel object,
//      but the filter is defense-in-depth and also makes the storage-event
//      fallback path safe across the same origin.
//   4. **No PII** — message payloads carry IDs the other surface can already
//      see. No tokens, no draft contents, no user-typed strings.
//   5. **No back-pressure** in the core bus.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only `react`.

import {useEffect} from 'react';

/**
 * Discriminated-union message shape. Extend per feature, but keep the
 * payload small (IDs / version strings / counts only).
 */
export type BroadcastMessage =
  // ── Theme ────────────────────────────────────────────────────────────────
  | {type: 'theme.changed'; themeId: string; modeId: string}
  | {type: 'theme.customColors'; primary: string; accent: string}
  // ── Auth ─────────────────────────────────────────────────────────────────
  | {type: 'auth.logout'}
  // ── Notifications ────────────────────────────────────────────────────────
  | {type: 'notifications.read'; alertIds: number[]}
  | {type: 'notifications.cleared'}
  | {type: 'snooze.changed'; ruleId: number; until: number | null}
  // ── First-run / discovery surfaces ───────────────────────────────────────
  | {type: 'changelog.seen'; version: string}
  | {type: 'tour.completed'; tourId: string; version: number}
  | {type: 'tour.reset'; tourId?: string}
  // Replay requested by Settings UI / command palette.
  // Same-surface callers MUST also dispatch the local `TOUR_START_EVENT`
  // because the bus filters self-messages out by design; the broadcast variant
  // exists so peer surfaces that have Layout mounted can start the tour in
  // lockstep without a reload.
  | {type: 'tour.replay-requested'; tourId: string}
  | {type: 'checklist.dismissed'}
  | {type: 'onboarded'}
  | {type: 'onboarding.skip.changed'; skipped: boolean}
  | {type: 'install.dismissed'}
  // ── Per-vehicle visual prefs ─────────────────────────────────────────────
  | {type: 'vehicle.paint.changed'; vehicleId: number; paintId: string | null}
  // ── Layout / saved-state ─────────────────────────────────────────────────
  | {type: 'dashboard.layout'}
  | {type: 'savedView.changed'; pageId: string}
  // ── Form drafts (composes with useFormDraft) ────────────────────────────
  | {type: 'formDraft.acquired'; draftKey: string; tabId: string; ts: number}
  | {type: 'formDraft.released'; draftKey: string; tabId: string}
  | {type: 'formDraft.committed'; draftKey: string}
  // ── Edit leases (useEditLease) ───────────────────────────────────────────
  // Coordinates "I am editing X" between surfaces of the same origin so a
  // surface that opened a stale view of a shared resource can warn the user
  // before their save silently overwrites a peer's changes. The protocol is
  // intentionally minimal: a `lease.request` asks any active owner to
  // re-announce; `lease.granted` IS that announcement and carries `claimedAt`
  // so a later (newer) claim can win a tiebreaker; a `lease.released` lets peer
  // surfaces re-elect immediately when the owner closes the form. `tabId` is
  // the owning surface's stable `TAB_ID`.
  | {type: 'lease.request'; resourceKey: string; tabId: string}
  | {type: 'lease.granted'; resourceKey: string; tabId: string; claimedAt: number}
  | {type: 'lease.released'; resourceKey: string; tabId: string}
  // ── TanStack Query ───────────────────────────────────────────────────────
  | {type: 'queryInvalidate'; keys: ReadonlyArray<ReadonlyArray<unknown>>}
  // ── Settings / preferences ───────────────────────────────────────────────
  // Umbrella event for any AppSettings mutation (units, locale, decimals,
  // theme, currency, etc). `keys` is a hint for debug/tracing — subscribers
  // MUST re-read from `useSettings()` rather than trust the payload to be
  // exhaustive.
  | {type: 'settings.changed'; keys?: ReadonlyArray<string>};

/** Internal envelope wrapper added on send and stripped on receive. */
interface Envelope {
  _from: string;
  _ts: number;
  msg: BroadcastMessage;
}

/**
 * Pluggable cross-surface transport. A host may inject one via
 * {@link setBroadcastTransport} to make the bus fan messages out across real
 * surfaces (sockets, push fanout, a `BroadcastChannel` polyfill, …). The
 * default transport auto-detects a global `BroadcastChannel` + `localStorage`
 * and is otherwise a no-op. Implementations MUST NOT echo a message back to the
 * surface that sent it.
 */
export interface BroadcastTransport {
  /** Broadcast a message to every OTHER surface. The sender never sees it. */
  postMessage(msg: BroadcastMessage): void;
  /** Subscribe to messages from OTHER surfaces. Returns an unsubscribe fn. */
  subscribe(handler: (msg: BroadcastMessage) => void): () => void;
}

/**
 * Generate a v4-shaped identifier without Web Crypto. React Native ships no
 * `crypto.randomUUID` / `crypto.getRandomValues` by default, so this mirrors
 * the `Math.random` fallback branch of the web `./safeUUID` helper. It is for
 * uniqueness only (per-surface tab id) — NOT cryptographically secure.
 */
function safeRandomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand % 4) + 8;
    return value.toString(16);
  });
}

const CHANNEL_NAME = 'teslasync';

/** Stable per-surface identifier used to filter self-broadcasts. */
export const TAB_ID: string = safeRandomUUID();

// React Native's tsconfig omits the DOM lib, so the optional global
// `BroadcastChannel` is typed structurally (mirrors the automationSSE /
// useEditLease ports' structural `EventSource` / `BroadcastChannel`).
interface NativeBroadcastChannel {
  postMessage(data: unknown): void;
  addEventListener(
    type: 'message',
    listener: (event: {data?: unknown}) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: {data?: unknown}) => void,
  ): void;
  close(): void;
}

type NativeBroadcastChannelConstructor = new (
  name: string,
) => NativeBroadcastChannel;

let chan: NativeBroadcastChannel | null = null;

function getBroadcastChannelConstructor(): NativeBroadcastChannelConstructor | null {
  const candidate = (
    globalThis as typeof globalThis & {BroadcastChannel?: unknown}
  ).BroadcastChannel;
  return typeof candidate === 'function'
    ? (candidate as NativeBroadcastChannelConstructor)
    : null;
}

function hasBroadcastChannel(): boolean {
  return getBroadcastChannelConstructor() !== null;
}

function getChannel(): NativeBroadcastChannel | null {
  if (!hasBroadcastChannel()) {
    return null;
  }
  const Constructor = getBroadcastChannelConstructor();
  if (!Constructor) {
    return null;
  }
  if (!chan) {
    try {
      chan = new Constructor(CHANNEL_NAME);
    } catch {
      // Some embedded contexts disable BroadcastChannel even though the
      // constructor exists. Fall back to storage-event mode.
      chan = null;
    }
  }
  return chan;
}

/** Storage-key prefix used by the localStorage fallback transport. */
const FALLBACK_KEY_PREFIX = '__teslasync_bus_';

// Structural typing for the optional `localStorage` global + its `storage`
// event target (present on the react-native-web browser build, absent on pure
// native). The DOM `Storage` / `StorageEvent` / `window` types are unavailable
// without the DOM lib, so only the members actually used are modelled.
interface NativeWebStorage {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface NativeStorageEvent {
  key?: string | null;
  newValue?: string | null;
}

interface NativeStorageEventTarget {
  addEventListener(
    type: 'storage',
    listener: (event: NativeStorageEvent) => void,
  ): void;
  removeEventListener(
    type: 'storage',
    listener: (event: NativeStorageEvent) => void,
  ): void;
}

function getWebStorage(): NativeWebStorage | null {
  const candidate = (
    globalThis as typeof globalThis & {localStorage?: unknown}
  ).localStorage;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const storage = candidate as Partial<NativeWebStorage>;
  return typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
    ? (candidate as NativeWebStorage)
    : null;
}

function getStorageEventTarget(): NativeStorageEventTarget | null {
  const candidate = globalThis as typeof globalThis &
    Partial<NativeStorageEventTarget>;
  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? (candidate as NativeStorageEventTarget)
    : null;
}

function postViaStorage(envelope: Envelope): void {
  const storage = getWebStorage();
  if (!storage) {
    return;
  }
  const key = `${FALLBACK_KEY_PREFIX}${envelope._ts}_${Math.random()
    .toString(36)
    .slice(2)}`;
  try {
    storage.setItem(key, JSON.stringify(envelope));
    // Removing immediately keeps localStorage clean. The 'storage' event
    // fires for both setItem and removeItem in OTHER surfaces (not the same
    // one), so the message has already been delivered.
    storage.removeItem(key);
  } catch {
    // Quota / private mode / disabled — best-effort drop.
  }
}

/**
 * Default transport: the native-safe equivalent of the web bus. Broadcasts via
 * a detected global `BroadcastChannel`, falling back to a detected
 * `localStorage` storage-event hop; on pure native (neither present) it is a
 * documented no-op. Subscribes to BOTH transports so a surface emitting via the
 * channel can still receive from a surface emitting via the storage fallback.
 */
const defaultTransport: BroadcastTransport = {
  postMessage(msg) {
    const envelope: Envelope = {_from: TAB_ID, _ts: Date.now(), msg};
    const ch = getChannel();
    if (ch) {
      try {
        ch.postMessage(envelope);
        return;
      } catch {
        // Fall through to the storage path on serialization errors so the
        // bus never silently swallows a message just because the channel
        // hiccuped.
      }
    }
    postViaStorage(envelope);
  },

  subscribe(handler) {
    // We always wire BOTH transports when available so that a surface that's
    // emitting via the channel can still receive from a surface that's emitting
    // via the storage fallback (e.g. private-mode peer + normal peer on the
    // same origin). De-duplication by `_ts + _from` would be overkill; in
    // practice a single surface uses one transport at a time.
    const cleanups: Array<() => void> = [];

    const ch = getChannel();
    if (ch) {
      const fn = (e: {data?: unknown}) => {
        const data = e.data as Envelope | null;
        if (!data || typeof data !== 'object') {
          return;
        }
        if (data._from === TAB_ID) {
          return;
        }
        if (!data.msg || typeof data.msg !== 'object') {
          return;
        }
        try {
          handler(data.msg);
        } catch {
          // Subscriber threw — never let one consumer crash the bus.
        }
      };
      ch.addEventListener('message', fn);
      cleanups.push(() => ch.removeEventListener('message', fn));
    }

    const storageTarget = getStorageEventTarget();
    if (storageTarget) {
      const onStorage = (e: NativeStorageEvent) => {
        if (!e.key || !e.key.startsWith(FALLBACK_KEY_PREFIX)) {
          return;
        }
        if (!e.newValue) {
          return;
        }
        let env: Envelope | null = null;
        try {
          env = JSON.parse(e.newValue) as Envelope;
        } catch {
          return;
        }
        if (!env || env._from === TAB_ID) {
          return;
        }
        if (!env.msg || typeof env.msg !== 'object') {
          return;
        }
        try {
          handler(env.msg);
        } catch {
          // swallow
        }
      };
      storageTarget.addEventListener('storage', onStorage);
      cleanups.push(() =>
        storageTarget.removeEventListener('storage', onStorage),
      );
    }

    return () => {
      for (const c of cleanups) {
        c();
      }
    };
  },
};

/**
 * Explicit unavailable-state reason, surfaced (and documented in the parity
 * sidecar) so callers/log readers can tell "no peer surface is listening" apart
 * from "cross-surface broadcast cannot happen on this platform". On pure native
 * (no `BroadcastChannel`, no `localStorage`, no injected transport) the bus is a
 * no-op; a host enables real fanout by injecting a transport via
 * {@link setBroadcastTransport}.
 */
export const BROADCAST_BUS_UNAVAILABLE_REASON =
  'React Native provides no BroadcastChannel and no localStorage storage event; ' +
  'cross-surface broadcast is a no-op until a host injects a transport via ' +
  'setBroadcastTransport (the react-native-web browser build auto-detects both transports).';

let injectedTransport: BroadcastTransport | null = null;

/**
 * Wire (or clear) the native cross-surface transport. Passing `null` reverts to
 * the auto-detected `BroadcastChannel` + `localStorage` transport when
 * available, otherwise the no-op default. Intended for hosts that provide real
 * fanout and for tests that simulate peer surfaces.
 */
export function setBroadcastTransport(transport: BroadcastTransport | null): void {
  injectedTransport = transport;
}

function activeTransport(): BroadcastTransport {
  return injectedTransport ?? defaultTransport;
}

/**
 * Broadcast a message to every other surface of the same origin. The current
 * surface does NOT receive its own message.
 */
export function broadcast(msg: BroadcastMessage): void {
  activeTransport().postMessage(msg);
}

/**
 * Subscribe to messages broadcast from OTHER surfaces. Returns an unsubscribe
 * function. Messages from the current surface are filtered out.
 */
export function subscribe(handler: (msg: BroadcastMessage) => void): () => void {
  return activeTransport().subscribe(handler);
}

/**
 * React hook variant of {@link subscribe}. Subscribes for the lifetime of the
 * component. The handler is captured by reference each render — pass a stable
 * callback (or wrap in `useCallback`) if you want to avoid re-subscribing on
 * every render.
 */
export function useBroadcast(handler: (msg: BroadcastMessage) => void): void {
  useEffect(() => {
    return subscribe(handler);
  }, [handler]);
}

/**
 * Test-only helper: forces the next call to {@link getChannel} to rebuild the
 * singleton. Used by tests that swap `BroadcastChannel` between
 * defined/undefined to exercise both transports.
 */
export function __resetBroadcastForTests(): void {
  if (chan) {
    try {
      chan.close();
    } catch {
      // ignore
    }
  }
  chan = null;
}
