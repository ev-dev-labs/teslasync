//
//  SpeedHistogramChart.Models.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  The pure value types for the drive-detail "Speed Histogram" surface — the
//  speed-bucket input slice (web `SpeedHistogramBucket` = { range, pct }), the
//  projected chart bar, and the render / load / connection states. Foundation-only
//  so they are shared by the projection (`SpeedHistogramChart.Adapter.swift`), the
//  state holder, and the views without dragging in SwiftUI. Faithful to the web
//  features/driving/components/drive-detail/SpeedHistogramChart.tsx data shape.
//

import Foundation

// MARK: - Bucket input (web `SpeedHistogramBucket`)

/// One speed-distribution bucket exactly as handed to the web component
/// (`SpeedHistogramBucket` — `{ range: string; pct: number }`). The parent
/// drive-detail hook (`useDriveDetailData`) derives these from the per-sample
/// speed trace; the component itself only renders them. `pct` is optional here for
/// null-safety at the binding seam (the web treats it as a present number).
public struct SpeedHistogramBucketInput: Sendable, Equatable {
    /// The bucket's display label (web `range`, e.g. "20–40" or "120+").
    public var range: String
    /// The share of the drive spent in this bucket, in percent (web `pct`).
    public var pct: Double?

    public init(range: String, pct: Double?) {
        self.range = range
        self.pct = pct
    }
}

// MARK: - Chart bar (one projected histogram column)

/// One projected histogram column — the native parity of a single web `<Bar>`
/// datum (`{ range, pct }`). Carries a stable `index` so the `Identifiable` id is
/// unique even if two buckets ever shared a label, while the chart still plots by
/// the `range` category (web `XAxis dataKey="range"`).
public struct SpeedHistogramBar: Sendable, Equatable, Identifiable {
    /// Plot order (web array order — slowest bucket first).
    public var index: Int
    /// The bucket's display label / x-axis category (web `range`).
    public var range: String
    /// The share of the drive in percent (web `pct`), null-safe (`pct ?? 0`).
    public var pct: Double

    public var id: String {
        "\(index)#\(range)"
    }

    public init(index: Int, range: String, pct: Double) {
        self.index = index
        self.range = range
        self.pct = pct
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`speedHistData.length > 0`); the loading / error envelope
/// around it (prompt P4 states) is supplied by the bound source, mirroring the
/// web parent page's `isLoading` / error wiring + its section error boundary.
public enum SpeedHistogramPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive telemetry the buckets derive from
/// (web `isLoading` / resolved / failure), projected to a phase by `resolvePhase`.
public enum SpeedHistogramLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached bars are clearly labeled while reconnecting / offline.
public enum SpeedHistogramConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
