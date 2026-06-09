//
//  XRayBucketChart.Models.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  The pure value types for the Ingest X-Ray "Samples per bucket" surface — the
//  bucket input slice (web `IngestXRayBucketPoint` = { bucket_start, count }), the
//  projected chart bar, and the render / load / connection states. Foundation-only
//  so they are shared by the projection (`XRayBucketChart.Adapter.swift`), the state
//  holder, and the views without dragging in SwiftUI. Faithful to the web
//  features/admin/components/ingest-xray/XRayBucketChart.tsx data shape.
//

import Foundation

// MARK: - Bucket input (web `IngestXRayBucketPoint`)

/// One ingest time bucket exactly as handed to the web component
/// (`IngestXRayBucketPoint` — `{ bucket_start: string; count: number }`). The
/// parent admin page derives these from `useIngestXRay`; the component only renders
/// them. `count` is optional here for null-safety at the binding seam (the web treats
/// it as a present number).
public struct XRayBucketInput: Sendable, Equatable {
    /// The bucket's start instant as an ISO-8601 string (web `bucket_start`).
    public var bucketStart: String
    /// The number of ingested telemetry rows in this bucket (web `count`).
    public var count: Int?

    public init(bucketStart: String, count: Int?) {
        self.bucketStart = bucketStart
        self.count = count
    }
}

// MARK: - Chart bar (one projected time bucket)

/// One projected bar — the native parity of a single web `<Bar>` datum
/// (`{ ts, bucket_start, count }`). Carries the parsed `timestamp` (web
/// `ts = Date.parse(bucket_start)`) so the time axis sorts + formats cheaply, the raw
/// `bucketStart` for the table / accessibility fallback, and a stable `index` so the
/// `Identifiable` id stays unique even if two buckets ever shared a start string.
public struct XRayBucketBar: Sendable, Equatable, Identifiable {
    /// Plot order (web array order — earliest bucket first).
    public var index: Int
    /// The bucket's raw ISO-8601 start string (web `bucket_start`).
    public var bucketStart: String
    /// The parsed bucket start (web `ts = Date.parse(bucket_start)`), the x-axis value.
    public var timestamp: Date
    /// The ingested-row count for this bucket (web `count`), null-safe (`count ?? 0`).
    public var count: Int

    public var id: String {
        "\(index)#\(bucketStart)"
    }

    public init(index: Int, bucketStart: String, timestamp: Date, count: Int) {
        self.index = index
        self.bucketStart = bucketStart
        self.timestamp = timestamp
        self.count = count
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes content-vs-empty
/// (`!loading && series.length === 0`); the loading / error envelope around it (prompt
/// P4 states) is supplied by the bound source, mirroring the web parent page's
/// `loading` prop + its section error boundary.
public enum XRayBucketPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the X-Ray query the buckets derive from
/// (web `loading` / resolved / failure), projected to a phase by `resolvePhase`.
public enum XRayBucketLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so cached bars are clearly labeled while reconnecting / offline.
public enum XRayBucketConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
