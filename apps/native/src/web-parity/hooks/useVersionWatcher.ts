/**
 * useVersionWatcher — native-safe port of web/src/hooks/useVersionWatcher.ts.
 *
 * Web parity source: web/src/hooks/useVersionWatcher.ts.
 *
 * Proactive new-deploy detection. Polls the backend `/system/version` endpoint
 * at a fixed cadence and compares the returned `app_version` against the version
 * captured when the app first booted. When they diverge, `newVersionAvailable`
 * flips to `true` so the NewVersionBanner can surface a soft "Reload" affordance
 * ahead of an inevitable chunk-load failure (web) / stale-bundle mismatch
 * (native).
 *
 * Cross-instance coordination — the browser-only seam
 * ---------------------------------------------------
 * On the web this hook uses a dedicated `BroadcastChannel` named
 * 'teslasync:version' so that when one TAB discovers the new deploy, every other
 * tab on the same origin learns within milliseconds instead of waiting for its
 * own poll to fire. The central `@/lib/broadcast` bus is intentionally NOT
 * extended for this infrastructural signal.
 *
 * React Native has no `BroadcastChannel` global and, more fundamentally, no peer
 * browser tabs / separate same-origin documents to coordinate across — a native
 * app is a single process. True cross-tab / cross-process broadcast is therefore
 * UNAVAILABLE (see `nativeVersionWatcherCapabilities`). This port keeps the exact
 * public surface and the three-effect structure of the web hook and routes the
 * channel seam through an in-process emitter (`InProcessVersionChannel`) — the
 * faithful native analog of "multiple BroadcastChannel instances on the same
 * origin". It coordinates the several `useVersionWatcher` instances mounted
 * inside the one JS runtime and replicates BroadcastChannel's "never echo to the
 * poster" semantics, without reaching the user-facing settings/theme/auth bus.
 * The hook degrades gracefully exactly like the web "BroadcastChannel
 * unavailable" path when `readChannel()` returns `null` — every instance still
 * discovers the new version on its own poll cycle.
 *
 * The hook performs no work during the render phase (the web SSR-safety property)
 * and swallows transient poll errors, surfacing only 4xx ApiError responses as a
 * single console warning so an operator can spot a misconfigured deployment.
 *
 * No DOM modules, browser HTML elements, Recharts, Leaflet, BroadcastChannel, or
 * old web UI components are imported here. The web `@/api/client` import is
 * rewired to the native parity client at ../api/client. `window.setInterval` /
 * `window.clearInterval` become the React Native global `setInterval` /
 * `clearInterval`.
 */
import { useEffect, useState } from 'react';

import { ApiError, request } from '../api/client';

interface SystemVersionResponse {
  app_version: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const VERSION_CHANNEL = 'teslasync:version';

interface VersionEnvelope {
  version: string;
}

export interface VersionWatcherState {
  /** The `app_version` reported by the backend on the very first poll after mount. `null` until the boot probe resolves. */
  bootVersion: string | null;
  /** The most recent `app_version` reported by either a local poll or a peer instance. `null` until the first poll completes. */
  latestVersion: string | null;
  /** `true` iff `bootVersion && latestVersion && latestVersion !== bootVersion`. */
  newVersionAvailable: boolean;
}

/**
 * Capability descriptor for the native version-channel seam. Mirrors the explicit
 * "unavailable" pattern used by the other web-parity ports so callers can branch
 * on what the platform can actually do instead of discovering it via a thrown
 * error.
 */
export const nativeVersionWatcherCapabilities = {
  broadcastChannelAvailable: false,
  crossTabCoordinationAvailable: false,
  inProcessCoordinationAvailable: true,
  versionChannelName: VERSION_CHANNEL,
  unavailableReason:
    'React Native has no BroadcastChannel global and no peer browser tabs / same-origin documents to coordinate across (a native app is a single process), so true cross-tab/cross-process version broadcast is unavailable. An in-process emitter coordinates the useVersionWatcher instances within the one JS runtime instead; every instance still discovers a new deploy on its own poll cycle.',
} as const;

/** Native analog of the DOM `MessageEvent<VersionEnvelope>` a BroadcastChannel delivers. */
interface VersionMessageEvent {
  data: VersionEnvelope;
}

type VersionMessageListener = (event: VersionMessageEvent) => void;

/**
 * The subset of the web `BroadcastChannel` surface this hook touches. The native
 * implementation (InProcessVersionChannel) preserves these signatures so the
 * three web effects port near-verbatim.
 */
interface VersionChannel {
  postMessage(message: VersionEnvelope): void;
  addEventListener(type: 'message', listener: VersionMessageListener): void;
  removeEventListener(type: 'message', listener: VersionMessageListener): void;
  close(): void;
}

// Registry of every open in-process channel, the native stand-in for "all
// BroadcastChannel instances on the same origin".
const openChannels = new Set<InProcessVersionChannel>();

/**
 * In-process analog of a `BroadcastChannel`. Coordinates the `useVersionWatcher`
 * instances mounted inside a single JS runtime — the native stand-in for several
 * BroadcastChannel instances on the same web origin. Like `BroadcastChannel`, a
 * channel never receives its own posted message: `postMessage` fans out to every
 * OTHER open channel of the same name only.
 */
class InProcessVersionChannel implements VersionChannel {
  private readonly listeners = new Set<VersionMessageListener>();
  private closed = false;

  constructor(readonly name: string) {
    openChannels.add(this);
  }

  postMessage(message: VersionEnvelope): void {
    if (this.closed) {
      throw new Error('Cannot postMessage on a closed version channel');
    }
    for (const channel of openChannels) {
      if (channel === this || channel.closed || channel.name !== this.name) {
        continue;
      }
      channel.deliver(message);
    }
  }

  private deliver(message: VersionEnvelope): void {
    const event: VersionMessageEvent = { data: message };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  addEventListener(type: 'message', listener: VersionMessageListener): void {
    if (type !== 'message') {
      return;
    }
    this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: VersionMessageListener): void {
    if (type !== 'message') {
      return;
    }
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    openChannels.delete(this);
  }
}

/**
 * Native analog of the web `readChannel()`. Returns an in-process version
 * channel, or `null` when in-process coordination is disabled — the native
 * equivalent of the web "`window` / `BroadcastChannel` unavailable"
 * graceful-degradation branch, where every instance still discovers the new
 * version on its own poll cycle.
 */
function readChannel(): VersionChannel | null {
  if (!nativeVersionWatcherCapabilities.inProcessCoordinationAvailable) {
    return null;
  }
  try {
    return new InProcessVersionChannel(VERSION_CHANNEL);
  } catch {
    return null;
  }
}

async function fetchVersion(): Promise<string | null> {
  try {
    const resp = await request<SystemVersionResponse>('/system/version');
    if (
      resp &&
      typeof resp.app_version === 'string' &&
      resp.app_version.length > 0
    ) {
      return resp.app_version;
    }
    return null;
  } catch (err) {
    // Swallow transient errors silently — the next tick will retry.
    // Surface ApiError 4xx (e.g. 401 unauthenticated) as a single
    // console warning so an operator can spot a misconfigured deployment.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      console.warn(
        '[useVersionWatcher] /system/version returned',
        err.status,
        err.message,
      );
    }
    return null;
  }
}

export function useVersionWatcher(): VersionWatcherState {
  const [bootVersion, setBootVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  // 1. Boot probe — captured ONCE on mount.
  useEffect(() => {
    let cancelled = false;
    void fetchVersion().then(v => {
      if (cancelled || !v) {
        return;
      }
      setBootVersion(v);
      setLatestVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Periodic poll — only starts once we have a baseline to compare against.
  useEffect(() => {
    if (!bootVersion) {
      return;
    }

    let cancelled = false;
    const channel = readChannel();

    const tick = async () => {
      const v = await fetchVersion();
      if (cancelled || !v) {
        return;
      }
      setLatestVersion(v);
      if (v !== bootVersion) {
        try {
          channel?.postMessage({ version: v } satisfies VersionEnvelope);
        } catch {
          // postMessage can throw on a closed channel — ignore.
        }
      }
    };

    const id = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (channel) {
        try {
          channel.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [bootVersion]);

  // 3. Cross-instance subscription — a peer instance discovered a new version,
  //    hoist the banner without waiting for our own next poll.
  useEffect(() => {
    const channel = readChannel();
    if (!channel) {
      return undefined;
    }
    const onMessage = (e: VersionMessageEvent) => {
      const v = e.data?.version;
      if (typeof v === 'string' && v.length > 0) {
        setLatestVersion(v);
      }
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      try {
        channel.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const newVersionAvailable = !!(
    bootVersion &&
    latestVersion &&
    latestVersion !== bootVersion
  );

  return { bootVersion, latestVersion, newVersionAvailable };
}
