import Foundation

// MARK: - Loaded response (web `IngestXRayResponse`)

/// The per-vehicle ingest X-Ray the page renders — the native parity of the web
/// `IngestXRayResponse` (`internal/api/ingest_xray_handler.go`). Carries the aggregate
/// summary (`total_samples` / `unique_fields`), the per-field statistics, and the bucketed
/// sample-count time-series. The value sub-types (`XRayFieldStat`, `XRayBucketInput`,
/// `IngestXRaySummary`, `IngestXRayWindow`, `IngestXRayBucket`) are the P3 X-Ray component
/// library's types, reused verbatim so the page and the components agree on one shape.
///
/// Telemetry-sample counts are exact integers (no SI units); the only display-boundary
/// conversions are locale-grouped integers + relative timestamps, applied by the reused
/// `XRayHeaderProjection` / `XRayFieldsProjector` / `XRayBucketChartProjection`.
public struct IngestXRayResult: Equatable, Sendable {
    public let vehicleID: Int
    public let window: IngestXRayWindow
    public let bucket: IngestXRayBucket
    public let generatedAt: Date?
    public let totalSamples: Int
    public let uniqueFields: Int
    public let fields: [XRayFieldStat]
    public let buckets: [XRayBucketInput]

    public init(
        vehicleID: Int,
        window: IngestXRayWindow,
        bucket: IngestXRayBucket,
        generatedAt: Date? = nil,
        totalSamples: Int,
        uniqueFields: Int,
        fields: [XRayFieldStat],
        buckets: [XRayBucketInput]
    ) {
        self.vehicleID = vehicleID
        self.window = window
        self.bucket = bucket
        self.generatedAt = generatedAt
        self.totalSamples = totalSamples
        self.uniqueFields = uniqueFields
        self.fields = fields
        self.buckets = buckets
    }

    /// The header strip's summary slice (web `data` → the three `StatCard`s).
    public var summary: IngestXRaySummary {
        IngestXRaySummary(totalSamples: totalSamples, uniqueFields: uniqueFields, generatedAt: generatedAt)
    }

    /// Whether the window resolved with nothing to show (web `!loading && empty`): no buckets,
    /// no fields, and a zero aggregate. Drives the page's empty state.
    public var isEmpty: Bool {
        buckets.isEmpty && fields.isEmpty && totalSamples == 0
    }
}

// MARK: - Data source seam (web `useVehicles` / `useIngestXRay`)

/// Supplies the two reads the page binds (ADR-004 — the view holds no networking). Production
/// binds the shared KMP `/vehicles` + `/system/ingest-xray/{id}` endpoints; previews + tests
/// inject doubles to drive every data state. Mirrors the sibling `DLQInspectorDataSource` seam.
public protocol IngestXRayDataSource: Sendable {
    /// Web `useVehicles → GET /vehicles` — the vehicle picker's options.
    func loadVehicles() async throws -> [XRayVehicleRef]

    /// Web `useIngestXRay → GET /system/ingest-xray/{numericId}?window&bucket&limit` — the
    /// per-vehicle X-Ray for the selected window + bucket. `limit` caps the `fields` rows
    /// (buckets are never truncated), mirroring the web hook's `limit` param.
    func loadXRay(
        vehicleID: Int,
        window: IngestXRayWindow,
        bucket: IngestXRayBucket,
        limit: Int
    ) async throws -> IngestXRayResult
}

// MARK: - Page states (web `vehicles` / `xray` query phases)

/// The vehicle-list state (web `useVehicles`). `.empty` is a successful load with no vehicles
/// (the picker shows its empty hint), `.error` is retryable, `.loaded` carries the picker rows.
public enum IngestXRayVehiclesState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([XRayVehicleRef])
}

/// The X-Ray state (web `useIngestXRay`, only fetched once a vehicle is selected). `.idle` is
/// the pre-selection state (web `enabled: numericId > 0` — no request in flight); `.empty` is a
/// successful load with no samples in the window; `.error` is retryable; `.loaded` carries the
/// summary + fields + buckets.
public enum IngestXRayDataState: Equatable, Sendable {
    case idle
    case loading
    case empty
    case error(String)
    case loaded(IngestXRayResult)
}

// MARK: - Fetch key (re-fetch trigger)

/// The tuple that identifies one X-Ray request (web `ingestXRayKeys.detail(id, window, bucket,
/// limit)`). Used as the SwiftUI `.task(id:)` identity so the page re-fetches whenever the
/// operator changes the vehicle, window, or bucket — the native parity of the web query key
/// driving a refetch.
public struct IngestXRayFetchKey: Hashable, Sendable {
    public let vehicleID: Int?
    public let window: IngestXRayWindow
    public let bucket: IngestXRayBucket

    public init(vehicleID: Int?, window: IngestXRayWindow, bucket: IngestXRayBucket) {
        self.vehicleID = vehicleID
        self.window = window
        self.bucket = bucket
    }
}
