//
//  ConnectionSegment.Adapter.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The testable, dependency-light core for the footer status-bar API-connection segment — the SwiftUI
//  parity of `web/src/components/layout/status-bar/ConnectionSegment.tsx`. Everything here is pure
//  (Foundation only): the surface identity (the diagnostics slug, the web `/healthz` poll cadence + probe
//  timeout, the degraded latency threshold, the staleness window, the linked route, and the host-navigation
//  broadcast), the localization seam, the health-status taxonomy (``ConnectionHealthStatus`` — the native
//  peer of the web `ApiHealthStatus`), the latency bucketing (``ConnectionHealthBucket`` — the web
//  `bucket(result)`), the value-typed probe reading (``ConnectionProbeResult`` — the web `ProbeResult`), the
//  coalesced ``ConnectionSegmentSnapshot`` (the `useApiHealth` reading + the probe lifecycle), the P4 leaf
//  freshness axis (``ConnectionFreshness``), and the SwiftUI-free tone / glyph selectors. No store, no URL
//  session, no rendered view, so each rule is unit-tested in isolation.
//
//  Parity note (states): the web `<ConnectionSegment>` reads `useApiHealth()`, a `useQuery` that polls
//  `/healthz` and reports one of FOUR statuses — `ok` / `degraded` / `offline` / `unknown` — as a single
//  chip (a tone dot + an icon + the "API" label + a latency / "Offline" suffix). It has no skeleton /
//  spinner-only gate, so the P4 leaf contract maps onto the web's REAL surfaces rather than inventing
//  chrome (exactly as the sibling 0180 LiveTelemetrySegment documents):
//    • loading / initial  → `connecting` (the muted "Connecting…" chip, before the first probe completes)
//    • ready              → `online` (emerald) / `degraded` (amber), with the "· {latency}ms" stamp
//    • error / offline    → `offline` (the rose "Offline" chip — a failed `/healthz` probe; the web buckets
//                           a network error / non-2xx / timeout straight to `offline`)
//    • stale              → a healthy reading aged past the staleness window → the dimmed "· stale" chip,
//                           with the poll cadence + the on-appear re-probe as the auto-refresh (the web hook
//                           `refetchIntervalInBackground: false` pauses polling when backgrounded, so the
//                           reading genuinely ages, then refetches on foreground)
//  A health probe always resolves a status, so there is no "empty / no value" branch (the never-probed
//  state IS `connecting`); inventing a blank box would fabricate a surface the source does not have.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug + web cadence + route)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11), the
/// `/healthz` poll cadence + probe timeout carried over from the web `useApiHealth` (`POLL_INTERVAL_MS` /
/// `PROBE_TIMEOUT_MS`), the degraded latency threshold (web `latencyMs >= 500`), the P4 staleness window,
/// the route the segment links to (web `<Link to="/system-status">`), and the host-navigation broadcast the
/// default tap handler posts. Kept SwiftUI-free so the state-holder + the polling source can reference them
/// without depending on the view layer.
public enum ConnectionSegmentSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ConnectionSegment"

    /// The `/healthz` poll cadence — the native peer of the web `POLL_INTERVAL_MS = 15_000` (15s).
    public static let pollIntervalSeconds: TimeInterval = 15

    /// The per-probe timeout — the native peer of the web `PROBE_TIMEOUT_MS = 5_000` (5s). Carried so a
    /// host-supplied probe can honour the same deadline the web `AbortController` enforces.
    public static let probeTimeoutSeconds: TimeInterval = 5

    /// The "slow but up" latency threshold in milliseconds — the web `bucket`'s `latencyMs >= 500`
    /// boundary between `ok` and `degraded`.
    public static let degradedThresholdMs = 500

    /// The P4 freshness window: a healthy reading older than this is `stale`. Sized at the poll cadence
    /// plus the probe timeout plus a small grace (15 + 5 + 10), so a single missed poll does not flap the
    /// chip — only a genuinely paused feed (the web `refetchIntervalInBackground: false`) ages past it.
    public static let stalenessWindowSeconds: TimeInterval = 30

    /// The destination the segment links to — verbatim from the web `<Link to="/system-status">`.
    public static let route = "/system-status"

    /// The em-dash sentinel — the web `latencyLabel` null return (`latencyMs != null ? … : '—'`).
    public static let latencyFallback = "—"

    /// Broadcast posted by the default tap handler with ``route`` as the object, so the host shell can
    /// navigate without the surface owning the router — the native peer of the web `<Link>` navigation.
    public static let openSystemStatusNotification = Notification.Name("teslasync:system-status:open")
}

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle: the
/// production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias ConnectionSegmentResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Health status taxonomy (web `ApiHealthStatus`)

/// The coarse-grained API health bucket — the native peer of the web `ApiHealthStatus`
/// (`ok | degraded | offline | unknown`). `connecting` is the web `unknown` (the query has not completed a
/// probe yet); the renamed case reads truthfully as the loading state the chip shows ("Connecting…").
public enum ConnectionHealthStatus: String, Sendable, Equatable, CaseIterable {
    /// Web `ok` — a 2xx `/healthz` response under the degraded threshold.
    case online
    /// Web `degraded` — a 2xx response that is slow (≥ the degraded threshold).
    case degraded
    /// Web `offline` — a non-2xx, a network error, or no response within the timeout.
    case offline
    /// Web `unknown` — no probe has completed yet (the loading state).
    case connecting

    /// Whether a measured latency is displayed for the status — the web shows the `· {latency}ms` stamp
    /// only for `online` / `degraded` (`status !== 'offline' && status !== 'unknown'`).
    public var showsLatency: Bool {
        self == .online || self == .degraded
    }
}

// MARK: - Latency bucketing (web `bucket(result)`)

/// The pure classification of a probe reading into a health status — the byte-for-byte native port of the
/// web `bucket(result)`: a failed probe is `offline`; a slow (≥ threshold ms) success is `degraded`; a fast
/// success is `online`. Exposed as a static function so the rule is unit-tested without a probe or a clock.
public enum ConnectionHealthBucket {
    /// Classifies one probe reading — web `bucket`: `if (!ok) offline; if (latencyMs >= 500) degraded; else
    /// ok`.
    public static func classify(ok: Bool, latencyMs: Int) -> ConnectionHealthStatus {
        guard ok else { return .offline }
        return latencyMs >= ConnectionSegmentSurface.degradedThresholdMs ? .degraded : .online
    }
}

// MARK: - Probe reading (web `ProbeResult`)

/// The value-typed result of one `/healthz` probe — the native peer of the web `ProbeResult`
/// (`{ ok, latencyMs, checkedAt }`). The web hook catches a network failure and still returns a result with
/// `ok: false` and the measured time-to-failure, so a probe ALWAYS yields a reading (there is no separate
/// failure case) — `ok == false` is the failure.
public struct ConnectionProbeResult: Sendable, Equatable {
    /// Whether the response was a 2xx (web `res.ok`); `false` on a non-2xx, network error, or timeout.
    public let ok: Bool
    /// The measured round-trip in milliseconds (web `Math.round(performance.now() - start)`).
    public let latencyMs: Int
    /// When the probe completed (web `new Date().toISOString()`).
    public let checkedAt: Date

    public init(ok: Bool, latencyMs: Int, checkedAt: Date) {
        self.ok = ok
        self.latencyMs = latencyMs
        self.checkedAt = checkedAt
    }
}

// MARK: - Coalesced snapshot (the web `useApiHealth` reading + probe lifecycle)

/// One coalesced snapshot of the API-health feed — the native peer of the web `useApiHealth` return
/// (`{ status, latencyMs, lastCheckedAt }`) plus the probe lifecycle the web `useQuery` keeps implicit. The
/// initial value (web `if (!data) return { status: 'unknown', latencyMs: null, lastCheckedAt: null }`) is a
/// `connecting` snapshot with a `nil` latency + check time.
public struct ConnectionSegmentSnapshot: Sendable, Equatable {
    public let status: ConnectionHealthStatus
    /// The most-recent measured round-trip (web `latencyMs`); `nil` until the first probe completes.
    public let latencyMs: Int?
    /// When the last probe completed (web `lastCheckedAt`); `nil` until the first probe completes. Drives
    /// the P4 freshness axis.
    public let lastCheckedAt: Date?

    public init(
        status: ConnectionHealthStatus = .connecting,
        latencyMs: Int? = nil,
        lastCheckedAt: Date? = nil
    ) {
        self.status = status
        self.latencyMs = latencyMs
        self.lastCheckedAt = lastCheckedAt
    }

    /// The pre-probe reading — the native peer of the web `useApiHealth`'s `!data` return.
    public static let initial = ConnectionSegmentSnapshot()

    /// Builds the snapshot a completed probe yields — buckets the reading into a status (web `bucket`) and
    /// carries the measured latency + check time, exactly as `useApiHealth` maps `data` into its return.
    public static func make(from result: ConnectionProbeResult) -> ConnectionSegmentSnapshot {
        ConnectionSegmentSnapshot(
            status: ConnectionHealthBucket.classify(ok: result.ok, latencyMs: result.latencyMs),
            latencyMs: result.latencyMs,
            lastCheckedAt: result.checkedAt
        )
    }
}

// MARK: - Freshness (P4 leaf axis)

/// The freshness of the displayed reading — the P4 leaf axis layered over the web's four statuses. `fresh`
/// renders the reading as-is; `stale` (a healthy reading aged past ``ConnectionSegmentSurface/stalenessWindowSeconds``)
/// dims the chip and swaps the latency stamp for the "stale" marker, since the cached latency is no longer
/// trustworthy. Only `online` / `degraded` readings can age — `offline` is already terminal and `connecting`
/// has never had a reading.
public enum ConnectionFreshness: String, Sendable, Equatable {
    case fresh
    case stale
}

// MARK: - Visual tone (token selector, kept SwiftUI-free)

/// The semantic tone for a status — a token selector the Views layer maps to a `Color.TS` value, so the
/// projection stays SwiftUI-free and unit-testable. Mirrors the web emerald / amber / rose / muted map
/// (`text-emerald-300` / `text-amber-300` / `text-rose-300` / `text-[var(--text-muted)]`).
public enum ConnectionSegmentTone: String, Sendable, Equatable {
    case success
    case warning
    case danger
    case muted
}

// MARK: - Status glyph (SF-symbol selector)

/// The glyph for a status — an SF-symbol selector the Views layer maps to a system image. Mirrors the web
/// lucide icons: `Activity` (ok), `AlertTriangle` (degraded), `CircleSlash` (offline), `HelpCircle`
/// (unknown / connecting).
public enum ConnectionSegmentIcon: String, Sendable, Equatable {
    case activity
    case warning
    case slash
    case help
}
