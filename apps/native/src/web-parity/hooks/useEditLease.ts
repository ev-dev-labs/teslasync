// Native parity port of web/src/hooks/useEditLease.ts.
//
// `useEditLease` coordinates "I am editing X" between peer surfaces of the same
// origin so that a surface opening a stale view of a shared resource can warn
// the user before their save silently overwrites a peer's changes. The whole
// election protocol (request → grant → tiebreaker → release) plus the
// module-level lease registry, the `EditConflictError`, `getCurrentLease`, and
// the `__resetEditLeasesForTests` test seam are pure, platform-agnostic
// TypeScript and are ported here unchanged.
//
// On the web the transport was `@/lib/broadcast` — a `BroadcastChannel` bus
// with a `localStorage` storage-event fallback that fans messages out across
// BROWSER TABS, plus a `window` `beforeunload` hook. React Native has no
// browser tabs, no `BroadcastChannel`, and no `localStorage`, so there is no
// peer instance to contend with: the lone app instance always wins its own
// election and renders no conflict banner. Following the sibling automationSSE
// native port, the browser-only transport is replaced by a native-safe seam
// that:
//   - exposes a stable per-instance `TAB_ID` (the tiebreaker still works),
//   - AUTO-DETECTS a global `BroadcastChannel` when one exists — e.g. the
//     react-native-web browser build, or a host polyfill — so cross-tab
//     coordination stays faithful there (with the same `_from`/self-filter
//     envelope semantics as the web bus),
//   - otherwise is a documented no-op whose `EDIT_LEASE_BUS_UNAVAILABLE_REASON`
//     explains the platform limitation, and
//   - accepts a host-injected transport via `setEditLeaseTransport` (the native
//     analog of the web cross-tab bus, e.g. backed by a socket or push fanout).
// The `window.beforeunload` release hint is likewise routed through a guarded
// `globalThis` lifecycle probe so it still fires on the react-native-web build
// and is a safe no-op on pure native.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only `react`.

import {useEffect, useState} from 'react';

// ─── Native-safe cross-instance bus (replaces @/lib/broadcast) ───────────────
//
// The web `BroadcastMessage` is a large discriminated union shared by many
// features; `useEditLease` only ever sends/receives the three lease variants,
// so only those are modelled here. The `handleMessage` type guards below are
// preserved verbatim against this subset.

/** Lease coordination messages exchanged between peer surfaces. */
export type BroadcastMessage =
  | {type: 'lease.request'; resourceKey: string; tabId: string}
  | {type: 'lease.granted'; resourceKey: string; tabId: string; claimedAt: number}
  | {type: 'lease.released'; resourceKey: string; tabId: string};

/**
 * Pluggable cross-instance transport. A host may inject one via
 * {@link setEditLeaseTransport} to make edit leases coordinate across real
 * surfaces (sockets, push fanout, a `BroadcastChannel` polyfill, …). The
 * default transport auto-detects a global `BroadcastChannel` and is otherwise a
 * no-op.
 */
export interface EditLeaseTransport {
  /** Broadcast a message to every OTHER surface. The sender never sees it. */
  postMessage(msg: BroadcastMessage): void;
  /** Subscribe to messages from OTHER surfaces. Returns an unsubscribe fn. */
  subscribe(handler: (msg: BroadcastMessage) => void): () => void;
}

/**
 * Generate a v4-shaped identifier without Web Crypto. React Native ships no
 * `crypto.randomUUID` / `crypto.getRandomValues` by default, so this mirrors
 * the `Math.random` fallback branch of the web `safeUUID` helper. It is for
 * uniqueness only (per-instance tab id, registry keys) — NOT cryptographically
 * secure.
 */
function safeRandomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand % 4) + 8;
    return value.toString(16);
  });
}

/** Stable per-instance identifier used to filter self-broadcasts. */
export const TAB_ID: string = safeRandomUUID();

/** Channel name kept identical to the web bus so a shared host can bridge. */
const BUS_CHANNEL_NAME = 'teslasync';

/** Internal envelope wrapper added on send and stripped on receive. */
interface BusEnvelope {
  _from: string;
  msg: BroadcastMessage;
}

// React Native's tsconfig omits the DOM lib, so the optional global
// `BroadcastChannel` is typed structurally (mirrors the automationSSE port's
// structural `EventSource`).
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
}

type NativeBroadcastChannelConstructor = new (
  name: string,
) => NativeBroadcastChannel;

function getBroadcastChannelConstructor(): NativeBroadcastChannelConstructor | null {
  const candidate = (
    globalThis as typeof globalThis & {BroadcastChannel?: unknown}
  ).BroadcastChannel;
  return typeof candidate === 'function'
    ? (candidate as NativeBroadcastChannelConstructor)
    : null;
}

/**
 * Build a transport backed by a real `BroadcastChannel` when the platform
 * provides one (react-native-web browser build / host polyfill). Carries the
 * same `_from: TAB_ID` envelope + self-filter as the web bus so a surface never
 * receives its own message.
 */
function createBroadcastChannelTransport(): EditLeaseTransport | null {
  const Constructor = getBroadcastChannelConstructor();
  if (!Constructor) {
    return null;
  }
  let channel: NativeBroadcastChannel;
  try {
    channel = new Constructor(BUS_CHANNEL_NAME);
  } catch {
    // Some embedded contexts expose the constructor but forbid construction.
    return null;
  }
  return {
    postMessage(msg) {
      try {
        const envelope: BusEnvelope = {_from: TAB_ID, msg};
        channel.postMessage(envelope);
      } catch {
        // Best-effort: never let a serialization hiccup crash the caller.
      }
    },
    subscribe(handler) {
      const listener = (event: {data?: unknown}) => {
        const envelope = event.data as BusEnvelope | null;
        if (!envelope || typeof envelope !== 'object') {
          return;
        }
        if (envelope._from === TAB_ID) {
          return;
        }
        if (!envelope.msg || typeof envelope.msg !== 'object') {
          return;
        }
        try {
          handler(envelope.msg);
        } catch {
          // Subscriber threw — never let one consumer crash the bus.
        }
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
  };
}

/**
 * Fallback transport for platforms with no peer surfaces (pure React Native):
 * broadcasting is a no-op and there is nothing to subscribe to.
 */
const NOOP_TRANSPORT: EditLeaseTransport = {
  postMessage() {
    // No peer app instances on this platform — nothing to notify.
  },
  subscribe() {
    return () => {};
  },
};

const detectedTransport = createBroadcastChannelTransport();

/**
 * Explicit unavailable-state reason, surfaced (and documented in the parity
 * sidecar) so callers can tell "no peer is editing" apart from "cross-instance
 * coordination cannot happen on this platform". A host enables real
 * coordination by injecting a transport via {@link setEditLeaseTransport}.
 */
export const EDIT_LEASE_BUS_UNAVAILABLE_REASON =
  'React Native provides no BroadcastChannel and no browser tabs; cross-instance edit-lease coordination is a no-op until a host injects a transport via setEditLeaseTransport (the react-native-web browser build auto-detects BroadcastChannel).';

let activeTransport: EditLeaseTransport = detectedTransport ?? NOOP_TRANSPORT;

/**
 * Wire (or clear) the native cross-instance transport. Passing `null` reverts
 * to the auto-detected `BroadcastChannel` transport when available, otherwise
 * the no-op transport. Intended for hosts that provide real fanout and for
 * tests that simulate peer surfaces.
 */
export function setEditLeaseTransport(transport: EditLeaseTransport | null): void {
  activeTransport = transport ?? detectedTransport ?? NOOP_TRANSPORT;
}

/**
 * Broadcast a message to every other surface of the same origin. The current
 * surface does NOT receive its own message.
 */
function broadcast(msg: BroadcastMessage): void {
  activeTransport.postMessage(msg);
}

/**
 * Subscribe to messages broadcast from OTHER surfaces. Returns an unsubscribe
 * function. Messages from the current surface are filtered out by the
 * transport.
 */
function subscribe(handler: (msg: BroadcastMessage) => void): () => void {
  return activeTransport.subscribe(handler);
}

// Guarded `globalThis` lifecycle probe — the native analog of the web hook's
// `window` `beforeunload` listener. Present on the react-native-web browser
// build; absent (and thus a safe no-op) on pure native.
interface GlobalLifecycle {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function getGlobalLifecycle(): GlobalLifecycle | null {
  const candidate = globalThis as typeof globalThis & Partial<GlobalLifecycle>;
  if (
    typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
  ) {
    return candidate as GlobalLifecycle;
  }
  return null;
}

// ─── Edit-lease protocol (ported 1:1 from the web hook) ──────────────────────
//
/**
 * Two-surface edit conflict detection.
 *
 * `useEditLease` coordinates "I am editing X" between peer surfaces of the
 * same origin so that a surface opening a stale view of a shared resource can
 * warn the user before their save silently overwrites a peer's changes.
 *
 * The protocol piggy-backs on the cross-instance bus above and does NOT
 * require any server-side coordination — it is a same-origin surface-to-surface
 * handshake.
 *
 * ## Election protocol
 *
 *   1. On mount the hook posts `lease.request` for the resource key and
 *      starts a {@link ELECTION_TIMEOUT_MS} timer.
 *   2. Any peer that already owns the lease responds with `lease.granted`
 *      carrying its `tabId` + `claimedAt` so the new surface can render the
 *      conflict banner.
 *   3. If no peer responds before the timer fires, this surface becomes the
 *      owner and itself broadcasts `lease.granted` so any other peers that
 *      were also racing-elect see it.
 *   4. Simultaneous-mount races are resolved by a deterministic tiebreaker:
 *      newer `claimedAt` wins; equal `claimedAt` falls back to lower `tabId`
 *      lexicographic comparison. The losing surface yields and renders the
 *      banner.
 *   5. On unmount and `beforeunload` the hook posts `lease.released`. A
 *      non-owner peer that was watching this surface clears its `otherTab`
 *      and starts a fresh election so the surviving surface smoothly
 *      promotes itself.
 *
 * ## Multiple subscribers within a single instance
 *
 * State is keyed by `resourceKey` at the module level so multiple components
 * on the same key share one election + one bus subscription.
 * {@link getCurrentLease} reads that shared state without subscribing — it is
 * the entry point a future mutation hook can use to implement client-side
 * save-collision rejection.
 *
 * ## What this hook is NOT
 *
 *   - Not a server-side ETag / `If-Match` enforcement layer. It cannot stop a
 *     third-party request from racing the app. It is defense in depth at the
 *     app layer only.
 *   - Not cross-origin.
 *   - Not durable across reloads. Each page load is a fresh surface and
 *     re-runs the election.
 *
 * On React Native (no peer surfaces / no `BroadcastChannel`) the bus is a
 * documented no-op, so the lone instance always self-grants and `otherTab`
 * stays `null`; on the react-native-web browser build the auto-detected
 * `BroadcastChannel` makes the full cross-tab handshake live.
 */

export interface OtherTabInfo {
  /** Stable per-surface identifier of the peer that holds the lease. */
  tabId: string;
  /** Wall-clock time at which the peer claimed the lease. */
  claimedAt: number;
}

export interface LeaseState {
  /** This surface currently owns the edit lease for the resource. */
  isOwner: boolean;
  /**
   * Information about a peer surface that holds the lease. `null` when this
   * surface is the owner OR no other surface has announced ownership yet.
   */
  otherTab: OtherTabInfo | null;
}

export interface UseEditLeaseResult extends LeaseState {
  /**
   * Forcibly take over the edit lease. Bumps `claimedAt` to the current
   * wall-clock + 1ms so the previous owner yields on receipt.
   *
   * Intended for the "Take over editing" affordance in
   * {@link EditConflictBanner}.
   */
  claim: () => void;
}

/**
 * Error thrown by client-side save-collision guards. Future mutation hooks may
 * import this and throw before issuing the network request when
 * {@link getCurrentLease} reports `!isOwner`.
 */
export class EditConflictError extends Error {
  readonly resourceKey: string;
  readonly otherTab: OtherTabInfo | null;

  constructor(resourceKey: string, otherTab: OtherTabInfo | null) {
    super(
      `Edit conflict on "${resourceKey}": another surface holds the edit lease.`,
    );
    this.name = 'EditConflictError';
    this.resourceKey = resourceKey;
    this.otherTab = otherTab;
  }
}

/**
 * Election timeout — the wall-clock window we wait for any active owner to
 * respond to our `lease.request` before we self-grant. Kept tight (250ms) so
 * the user perceives the banner as "instant" when a peer is open.
 */
export const ELECTION_TIMEOUT_MS = 250;

interface LeaseInternal {
  resourceKey: string;
  claimedAt: number;
  isOwner: boolean;
  otherTab: OtherTabInfo | null;
  subscribers: Set<() => void>;
  electionTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeBus: (() => void) | null;
}

/**
 * Module-level registry of active leases keyed by `resourceKey`. Multiple
 * `useEditLease(sameKey)` callers within one instance share the same entry —
 * each component-instance is a notify-only subscriber, not an independent
 * election voter.
 */
const leases = new Map<string, LeaseInternal>();

function notifySubscribers(internal: LeaseInternal): void {
  for (const sub of internal.subscribers) {
    try {
      sub();
    } catch {
      // Subscriber threw — never let one consumer crash the registry.
    }
  }
}

function broadcastGrant(internal: LeaseInternal): void {
  broadcast({
    type: 'lease.granted',
    resourceKey: internal.resourceKey,
    tabId: TAB_ID,
    claimedAt: internal.claimedAt,
  });
}

function broadcastRequest(internal: LeaseInternal): void {
  broadcast({
    type: 'lease.request',
    resourceKey: internal.resourceKey,
    tabId: TAB_ID,
  });
}

function broadcastReleased(internal: LeaseInternal): void {
  broadcast({
    type: 'lease.released',
    resourceKey: internal.resourceKey,
    tabId: TAB_ID,
  });
}

/**
 * Begin an election: ask any active owner to re-announce, then after
 * {@link ELECTION_TIMEOUT_MS} self-grant if nobody responded.
 */
function startElection(internal: LeaseInternal): void {
  if (internal.electionTimer != null) {
    clearTimeout(internal.electionTimer);
  }
  broadcastRequest(internal);
  internal.electionTimer = setTimeout(() => {
    internal.electionTimer = null;
    if (!internal.isOwner && internal.otherTab === null) {
      internal.claimedAt = Date.now();
      internal.isOwner = true;
      broadcastGrant(internal);
      notifySubscribers(internal);
    }
  }, ELECTION_TIMEOUT_MS);
}

function handleMessage(internal: LeaseInternal, msg: BroadcastMessage): void {
  if (
    msg.type !== 'lease.request' &&
    msg.type !== 'lease.granted' &&
    msg.type !== 'lease.released'
  ) {
    return;
  }
  if (msg.resourceKey !== internal.resourceKey) {
    return;
  }
  // Defense in depth — `subscribe()` already filters self-broadcasts by
  // TAB_ID; this guard makes the contract obvious to readers.
  if (msg.tabId === TAB_ID) {
    return;
  }

  if (msg.type === 'lease.request') {
    if (internal.isOwner) {
      broadcastGrant(internal);
    }
    return;
  }

  if (msg.type === 'lease.granted') {
    const peer: OtherTabInfo = {tabId: msg.tabId, claimedAt: msg.claimedAt};
    if (internal.isOwner) {
      // Tiebreaker: newer `claimedAt` wins; equal claim falls back to lower
      // `tabId` lexicographic comparison. This deterministically resolves
      // simultaneous-mount races without a coordinator.
      const peerWins =
        peer.claimedAt > internal.claimedAt ||
        (peer.claimedAt === internal.claimedAt && peer.tabId < TAB_ID);
      if (peerWins) {
        internal.isOwner = false;
        internal.otherTab = peer;
        notifySubscribers(internal);
      } else {
        // We win — re-assert so the loser learns to yield.
        broadcastGrant(internal);
      }
    } else {
      const current = internal.otherTab;
      const replace =
        !current ||
        peer.claimedAt > current.claimedAt ||
        (peer.claimedAt === current.claimedAt && peer.tabId < current.tabId);
      if (replace) {
        internal.otherTab = peer;
        notifySubscribers(internal);
      }
    }
    return;
  }

  if (msg.type === 'lease.released') {
    const current = internal.otherTab;
    if (current && current.tabId === msg.tabId) {
      internal.otherTab = null;
      notifySubscribers(internal);
      // The surface we were watching is gone; start a fresh election so we
      // smoothly promote ourselves (or learn about a third surface that's
      // also still around).
      startElection(internal);
    }
  }
}

function acquire(resourceKey: string): LeaseInternal {
  let internal = leases.get(resourceKey);
  if (!internal) {
    const created: LeaseInternal = {
      resourceKey,
      claimedAt: 0,
      isOwner: false,
      otherTab: null,
      subscribers: new Set(),
      electionTimer: null,
      unsubscribeBus: null,
    };
    leases.set(resourceKey, created);
    created.unsubscribeBus = subscribe(msg => handleMessage(created, msg));
    startElection(created);
    internal = created;
  }
  return internal;
}

function release(internal: LeaseInternal): void {
  if (internal.subscribers.size > 0) {
    return;
  }
  if (internal.electionTimer != null) {
    clearTimeout(internal.electionTimer);
    internal.electionTimer = null;
  }
  if (internal.unsubscribeBus) {
    internal.unsubscribeBus();
    internal.unsubscribeBus = null;
  }
  broadcastReleased(internal);
  leases.delete(internal.resourceKey);
}

function performClaim(internal: LeaseInternal): void {
  // +1ms guarantees we beat the previous owner's `claimedAt` even when the
  // user clicks "Take over" within the same millisecond they received the
  // granted message.
  internal.claimedAt = Date.now() + 1;
  internal.isOwner = true;
  internal.otherTab = null;
  broadcastGrant(internal);
  notifySubscribers(internal);
}

/**
 * Read the current lease state for `resourceKey` without subscribing.
 *
 * Returns `null` when no `useEditLease` instance is mounted for that key —
 * callers should treat that as "no contention" since without a mounted hook
 * there is no peer listener anyway.
 *
 * Intended entry point for client-side save-collision guards: a mutation hook
 * calls `getCurrentLease(key)` before issuing the network request and throws
 * {@link EditConflictError} when the snapshot reports `!isOwner`.
 */
export function getCurrentLease(resourceKey: string): LeaseState | null {
  const internal = leases.get(resourceKey);
  if (!internal) {
    return null;
  }
  return {isOwner: internal.isOwner, otherTab: internal.otherTab};
}

/**
 * React hook variant. Subscribes to the registry entry for the lifetime of the
 * calling component and re-renders on lease state changes.
 *
 * Pass `''` (empty string) to opt out — the hook then returns the "no-op"
 * defaults `{ isOwner: false, otherTab: null, claim: noop }` and does NOT
 * broadcast any messages. This lets callers conditionally disable the lease
 * without violating the rules-of-hooks ordering.
 */
export function useEditLease(resourceKey: string): UseEditLeaseResult {
  const [, force] = useState(0);

  useEffect(() => {
    if (!resourceKey) {
      return undefined;
    }

    const internal = acquire(resourceKey);
    const sub = () => force(n => n + 1);
    internal.subscribers.add(sub);
    // Push a render so the caller sees any state already accumulated by a
    // sibling subscriber (or the in-flight election).
    sub();

    const lifecycle = getGlobalLifecycle();
    const onBeforeUnload = () => {
      // The surface is going away — give peers a final hint so they re-elect
      // immediately instead of waiting for our next granted to time out.
      broadcastReleased(internal);
    };
    if (lifecycle) {
      lifecycle.addEventListener('beforeunload', onBeforeUnload);
    }

    return () => {
      if (lifecycle) {
        lifecycle.removeEventListener('beforeunload', onBeforeUnload);
      }
      internal.subscribers.delete(sub);
      release(internal);
    };
  }, [resourceKey]);

  if (!resourceKey) {
    return {
      isOwner: false,
      otherTab: null,
      claim: noop,
    };
  }

  const internal = leases.get(resourceKey);
  return {
    isOwner: internal?.isOwner ?? false,
    otherTab: internal?.otherTab ?? null,
    claim: () => {
      const cur = leases.get(resourceKey);
      if (cur) {
        performClaim(cur);
      }
    },
  };
}

function noop(): void {}

/**
 * Test seam — tears down every active lease registry entry so a fresh test
 * starts from a clean slate without leaking timers or subscribers. Production
 * callers must NOT use this.
 */
export function __resetEditLeasesForTests(): void {
  for (const internal of leases.values()) {
    if (internal.electionTimer != null) {
      clearTimeout(internal.electionTimer);
      internal.electionTimer = null;
    }
    if (internal.unsubscribeBus) {
      try {
        internal.unsubscribeBus();
      } catch {
        // ignore
      }
      internal.unsubscribeBus = null;
    }
    internal.subscribers.clear();
  }
  leases.clear();
}
