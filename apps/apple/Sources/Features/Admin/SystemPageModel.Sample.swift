import Foundation

/// Sample-seeded source factories for the System page panels. These are NOT
/// production telemetry — they exist so the composed page renders its populated state
/// out of the box, mirroring the sibling `SampleDiskForecastDataSource` /
/// `StaticApiEndpointCatalog` defaults. Production replaces them with the live
/// `RateLimitSource` / `QueueStatusSource` adapters over GET /system/rate-limits and
/// GET /system/queues (each panel's own P4 unit owns that wiring).
public enum SystemPageSampleSources {
    @MainActor
    public static func rateLimit(now: Date = Date()) -> InMemoryRateLimitSource {
        InMemoryRateLimitSource(initial: RateLimitInput(response: SystemPageSamples.rateLimitResponse(now: now)))
    }

    @MainActor
    public static func queue(now: Date = Date()) -> InMemoryQueueStatusSource {
        InMemoryQueueStatusSource(initial: QueueStatusInput(response: SystemPageSamples.queueSnapshot(now: now)))
    }
}

/// Pure, `Sendable` sample envelopes mirroring each panel's own preview fixtures, so
/// the composed page matches the panels' data parity. Kept off the main actor so unit
/// tests can build them directly.
public enum SystemPageSamples {
    /// Three representative rate-limit scopes (ok / warn / critical), matching the
    /// `RateLimitStatusPanel` preview.
    public static func rateLimitResponse(now: Date = Date()) -> RateLimitStatusResponse {
        RateLimitStatusResponse(
            generatedAt: now.addingTimeInterval(-12),
            scopes: [
                RateLimitScope(
                    id: "tesla.fleet_api.burst",
                    name: "Tesla Fleet API · burst",
                    current: 1,
                    limit: 5,
                    windowSeconds: 0,
                    severity: .ok,
                    detail: "Token-bucket guard in front of the Tesla Fleet API command proxy."
                ),
                RateLimitScope(
                    id: "api.internal.minute",
                    name: "Internal API · per minute",
                    current: 350,
                    limit: 600,
                    windowSeconds: 60,
                    resetAt: now.addingTimeInterval(42),
                    severity: .warn,
                    detail: "Shared rolling-window budget for all authenticated dashboard reads."
                ),
                RateLimitScope(
                    id: "api.write.minute",
                    name: "Write endpoints · per minute",
                    current: 110,
                    limit: 120,
                    windowSeconds: 60,
                    resetAt: now.addingTimeInterval(8),
                    severity: .critical,
                    detail: "POST / PUT / DELETE throttle. Approaching the cap."
                )
            ]
        )
    }

    /// Three representative background workers (notification / export / automation),
    /// matching the `QueueStatusPanel` preview.
    public static func queueSnapshot(now: Date = Date()) -> QueueStatusSnapshot {
        QueueStatusSnapshot(
            generatedAt: now.addingTimeInterval(-6),
            workers: [
                QueueStat(
                    worker: "notification",
                    displayName: "Notification worker",
                    pending: 0,
                    inProgress: 1,
                    succeeded24h: 1280,
                    failed24h: 2,
                    oldestPendingAgeSeconds: 0,
                    heartbeatSeverity: .ok,
                    heartbeatDetail: "Last heartbeat 4s ago",
                    lastHeartbeatAt: now.addingTimeInterval(-4),
                    startedAt: now.addingTimeInterval(-86400),
                    host: "worker-01",
                    version: "1.4.2"
                ),
                QueueStat(
                    worker: "export",
                    displayName: "Export worker",
                    pending: 3,
                    inProgress: 0,
                    succeeded24h: 84,
                    failed24h: 0,
                    oldestPendingAgeSeconds: 35,
                    heartbeatSeverity: .warn,
                    heartbeatDetail: "Last heartbeat 72s ago",
                    lastHeartbeatAt: now.addingTimeInterval(-72),
                    startedAt: now.addingTimeInterval(-43200),
                    host: "worker-01",
                    version: "1.4.2"
                ),
                QueueStat(
                    worker: "automation",
                    displayName: "Automation worker",
                    pending: 0,
                    inProgress: 0,
                    succeeded24h: 512,
                    failed24h: 5,
                    oldestPendingAgeSeconds: 0,
                    heartbeatSeverity: .ok,
                    heartbeatDetail: "Last heartbeat 9s ago",
                    lastHeartbeatAt: now.addingTimeInterval(-9),
                    startedAt: now.addingTimeInterval(-72000),
                    host: "worker-02",
                    version: "1.4.2"
                )
            ]
        )
    }
}
