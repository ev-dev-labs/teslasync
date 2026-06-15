import Foundation

/// A representative in-memory seed used as the page/preview default until the KMP-backed source
/// is injected at composition time. It is NOT production data — it exists so the surface renders
/// its populated states out of the box (mirroring the sibling `SampleDLQInspectorDataSource`).
/// An `actor` so its (immutable) seed stays `Sendable`. Production replaces it with the X-Ray
/// adapter over the shared core.
public actor SampleIngestXRayDataSource: IngestXRayDataSource {
    private let vehicles: [XRayVehicleRef]
    private let emptyVehicles: Bool

    public init(emptyVehicles: Bool = false, vehicles: [XRayVehicleRef]? = nil) {
        self.emptyVehicles = emptyVehicles
        self.vehicles = vehicles ?? Self.seedVehicles
    }

    public func loadVehicles() async throws -> [XRayVehicleRef] {
        emptyVehicles ? [] : vehicles
    }

    public func loadXRay(
        vehicleID: Int,
        window: IngestXRayWindow,
        bucket: IngestXRayBucket,
        limit: Int
    ) async throws -> IngestXRayResult {
        let now = Date()
        let buckets = Self.seedBuckets(window: window, bucket: bucket, now: now, seed: vehicleID)
        let fields = Array(Self.seedFields(now: now, seed: vehicleID).prefix(max(0, limit)))
        let total = buckets.reduce(0) { $0 + ($1.count ?? 0) }
        return IngestXRayResult(
            vehicleID: vehicleID,
            window: window,
            bucket: bucket,
            generatedAt: now,
            totalSamples: total,
            uniqueFields: fields.count,
            fields: fields,
            buckets: buckets
        )
    }

    // MARK: - Seeds

    static let seedVehicles: [XRayVehicleRef] = [
        XRayVehicleRef(id: 1, displayName: "Model 3 Performance", vin: "7SAYGDEE9PF000912"),
        XRayVehicleRef(id: 3, displayName: "Model Y Long Range", vin: "5YJ3E1EA7KF000337"),
        XRayVehicleRef(id: 7, displayName: nil, vin: "LRW3E7EK8PC123456")
    ]

    /// One ISO-8601 instant per bucket across the selected window, newest last, with a
    /// deterministic-but-varied count so the bar chart + header read like live ingest.
    static func seedBuckets(
        window: IngestXRayWindow,
        bucket: IngestXRayBucket,
        now: Date,
        seed: Int
    ) -> [XRayBucketInput] {
        let windowSeconds = XRayControlsProjection.windowSeconds(window)
        let bucketSeconds = max(1, bucket.seconds)
        let rawCount = windowSeconds / bucketSeconds
        let count = min(max(rawCount, 1), 48)
        let formatter = isoFormatter()
        return (0 ..< count).map { offset in
            let start = now.addingTimeInterval(Double(-(count - offset) * bucketSeconds))
            let base = 40 + (seed * 7) % 25
            let sampleCount = base + (offset * 13 + seed * 5) % 60
            return XRayBucketInput(bucketStart: formatter.string(from: start), count: sampleCount)
        }
    }

    /// A handful of Tesla telemetry signal fields with sample counts, recent last-seen instants,
    /// and observed value kinds (matching `protomodel.ValueKind`).
    static func seedFields(now: Date, seed: Int) -> [XRayFieldStat] {
        let formatter = isoFormatter()
        func iso(_ secondsAgo: Int) -> String {
            formatter.string(from: now.addingTimeInterval(Double(-secondsAgo)))
        }
        let scale = 1 + (seed % 3)
        return [
            XRayFieldStat(field: "VehicleSpeed", sampleCount: 18234 * scale, lastSeenAt: iso(4), valueKind: 6),
            XRayFieldStat(field: "Soc", sampleCount: 9120 * scale, lastSeenAt: iso(12), valueKind: 5),
            XRayFieldStat(field: "Location", sampleCount: 8742 * scale, lastSeenAt: iso(7), valueKind: 10),
            XRayFieldStat(field: "ChargeState", sampleCount: 3110 * scale, lastSeenAt: iso(48), valueKind: 7),
            XRayFieldStat(field: "DriveState", sampleCount: 2980 * scale, lastSeenAt: iso(63), valueKind: 7),
            XRayFieldStat(field: "InsideTemp", sampleCount: 1542 * scale, lastSeenAt: iso(140), valueKind: 6),
            XRayFieldStat(field: "Odometer", sampleCount: 642 * scale, lastSeenAt: iso(900), valueKind: 6),
            XRayFieldStat(field: "Gear", sampleCount: 305 * scale, lastSeenAt: iso(1860), valueKind: 1),
            XRayFieldStat(field: "DoorState", sampleCount: 96 * scale, lastSeenAt: iso(5400), valueKind: 4),
            XRayFieldStat(field: "SentryMode", sampleCount: 24 * scale, lastSeenAt: iso(43200), valueKind: 2)
        ]
    }

    /// Per-call ISO-8601 formatter (`ISO8601DateFormatter` is not `Sendable`).
    static func isoFormatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }
}
