//
//  RedisDiagnosticEmptyState.Copy.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  The per-branch copy catalog — every `t(key, default)` string the web component
//  renders, as `RDText` constants with the exact web i18next key + English fallback.
//  Kept beside the projection (not in the view) so the strings are referenced by key in
//  one place, the interpolating bodies (status/message, count, date) are unit-testable,
//  and the catalog-coverage test can iterate the full set. The view never inlines English.
//

import Foundation

/// The branch copy catalog. Static `RDText` for the fixed strings; small builders for the
/// three interpolating bodies (web `{{status}} {{message}}`, `{{count}}`, `{{date}}`).
public enum RedisDiagnosticCopy {
    // MARK: Branch 0.A — cache not wired (503 + "not available")

    public static let cacheNotWiredTitle = RDText(
        "redis.diagnostic.cacheNotWired.title",
        "Redis cache is not configured"
    )
    public static let cacheNotWiredBody = RDText(
        "redis.diagnostic.cacheNotWired.body",
        """
        The TeslaSync API server started without a Redis connection. Set REDIS_ADDR \
        (or REDIS_HOST + REDIS_PORT) in your environment, ensure the Redis service is \
        reachable, and restart the API. This page reads exclusively from Redis and \
        cannot function without it.
        """
    )
    public static let cacheNotWiredCTA = RDCTA(
        label: RDText("redis.diagnostic.cacheNotWired.cta", "See cache configuration docs"),
        path: "/docs/caching#configuration"
    )

    // MARK: Branch 0.B — unreachable (5xx + "unreachable"/"upstream")

    public static let unreachableTitle = RDText(
        "redis.diagnostic.unreachable.title",
        "Redis is unreachable"
    )
    public static let unreachableBody = RDText(
        "redis.diagnostic.unreachable.body",
        """
        The API server is configured to use Redis, but the connection failed. Check that \
        the Redis pod is running, that network policies allow the API to reach it, and \
        review API server logs for "redis signal cache: GetAll failed".
        """
    )

    // MARK: Branch 0.C — generic request failure

    public static let requestFailedTitle = RDText(
        "redis.diagnostic.requestFailed.title",
        "Could not load Redis signals"
    )

    /// Web body interpolating the HTTP `{{status}} {{message}}` so an operator can grep
    /// the API logs for the same string.
    public static func requestFailedBody(status: Int, message: String) -> RDText {
        RDText(
            "redis.diagnostic.requestFailed.body",
            """
            The server returned an error: {{status}} {{message}}. The Redis Signal Viewer \
            cannot recover automatically — try refreshing, and if the error persists check \
            the API server logs.
            """,
            args: ["status": String(status), "message": message]
        )
    }

    // MARK: Branch 0.D — network failure

    public static let networkErrorTitle = RDText(
        "redis.diagnostic.networkError.title",
        "Cannot reach the API server"
    )
    public static let networkErrorBody = RDText(
        "redis.diagnostic.networkError.body",
        """
        The browser failed to fetch /api/v1/dev-tools/redis-signals. Check that the API \
        server is running, the proxy/ingress is healthy, and there are no CORS or network \
        errors in DevTools.
        """
    )

    // MARK: No-meta fallback (web legacy generic EmptyState)

    public static let legacyEmptyMessage = RDText(
        "redis.noSignals",
        "No signals cached for this vehicle"
    )

    // MARK: Branch 1 — mode=local

    public static let modeLocalTitle = RDText(
        "redis.diagnostic.modeLocal.title",
        "Redis L2 writes are disabled"
    )
    public static let modeLocalBody = RDText(
        "redis.diagnostic.modeLocal.body",
        """
        LIVE_SIGNAL_STORE_MODE=local means the telemetry pipeline writes only to the \
        in-process L1 store and never mirrors to Redis. This page reads exclusively from \
        Redis, so it cannot show data while local mode is active.
        """
    )
    public static let modeLocalCTA = RDCTA(
        label: RDText("redis.diagnostic.modeLocal.cta", "See live-state contract docs"),
        path: "/docs/caching"
    )

    // MARK: Branch 2 — L2 mirror broken

    public static let mirrorBrokenTitle = RDText(
        "redis.diagnostic.mirrorBroken.title",
        "L2 mirror is failing"
    )

    /// Web body interpolating the `{{count}}` of L1 signals present without an L2 mirror.
    public static func mirrorBrokenBody(count: Int) -> RDText {
        RDText(
            "redis.diagnostic.mirrorBroken.body",
            """
            The in-process L1 store has {{count}} signals for this vehicle but Redis is \
            empty. The async mirror goroutine in HybridLiveSignalStore.UpdateNonBlocking \
            may be timing out or the Redis connection may be saturated. Check pod logs for \
            "live signal store: Redis mirror failed".
            """,
            args: ["count": String(count)]
        )
    }

    // MARK: Branch 3 — no recent telemetry (TTL expired / never streamed)

    public static let noTelemetryTitle = RDText(
        "redis.diagnostic.noTelemetry.title",
        "No recent telemetry for this vehicle"
    )

    /// Web stale body interpolating the formatted `{{date}}` of the last L1 entry.
    public static func noTelemetryStaleBody(dateText: String) -> RDText {
        RDText(
            "redis.diagnostic.noTelemetry.bodyStale",
            """
            Last L1 entry was {{date}}. The 7-day Redis TTL has likely expired. Wait for \
            the next telemetry push or warm the cache from the cold-path reader.
            """,
            args: ["date": dateText]
        )
    }

    public static let noTelemetryAbsentBody = RDText(
        "redis.diagnostic.noTelemetry.bodyAbsent",
        """
        This vehicle has no L1 entries on this pod. Either telemetry has never streamed for \
        it, or this pod restarted before any telemetry arrived.
        """
    )

    // MARK: Branch 4 — fallthrough (both empty, recent absence)

    public static let fallthroughTitle = RDText(
        "redis.diagnostic.empty.title",
        "No signals cached for this vehicle"
    )
    public static let fallthroughBody = RDText(
        "redis.diagnostic.empty.body",
        """
        Both L1 and L2 are empty. If this vehicle is currently streaming, give the next \
        batch a few seconds to arrive. Otherwise check the telemetry pipeline.
        """
    )

    // MARK: "Other vehicles" section + meta list labels

    public static let otherVehicles = RDText(
        "redis.diagnostic.otherVehicles",
        "Other vehicles with cached signals"
    )
    public static let metaMode = RDText("redis.diagnostic.meta.mode", "Live store mode")
    public static let metaKey = RDText("redis.diagnostic.meta.key", "Redis key")
    public static let metaL1Count = RDText("redis.diagnostic.meta.l1Count", "L1 signals")
    public static let metaL2Count = RDText("redis.diagnostic.meta.l2Count", "L2 fields (raw)")
    public static let metaL1LastSeen = RDText("redis.diagnostic.meta.l1LastSeen", "L1 last seen")
    public static let metaL2LastSeen = RDText("redis.diagnostic.meta.l2LastSeen", "L2 last seen")
    public static let metaVin = RDText("redis.diagnostic.meta.vin", "VIN")

    // MARK: Native chrome (states contract + a11y — not in the web leaf)

    public static let retry = RDText("redis.diagnostic.retry", "Retry")
    public static let loadingOtherVehicles = RDText(
        "redis.diagnostic.loadingOtherVehicles",
        "Loading other vehicles with cached signals"
    )
    public static let otherVehicleHint = RDText(
        "redis.diagnostic.otherVehicleHint",
        "Switches the viewer to this vehicle's cached signals"
    )

    // MARK: Chip name (web `display_name || vehicle_vin || `Vehicle ${id}``)

    /// The vehicle chip's display name, falling back through display name → VIN → the
    /// localized `Vehicle {{id}}` (the web hardcodes English here; the native catalog
    /// localizes it). Pure + testable via the injected localizer.
    public static func chipName(for entry: RedisSignalKeyEntry, localize: (String, String) -> String) -> String {
        if let name = entry.displayName, !name.isEmpty { return name }
        if let vin = entry.vehicleVin, !vin.isEmpty { return vin }
        let template = localize("redis.diagnostic.vehicleFallback", "Vehicle {{id}}")
        return RDInterpolate.apply(template, ["id": String(entry.vehicleId)])
    }
}
