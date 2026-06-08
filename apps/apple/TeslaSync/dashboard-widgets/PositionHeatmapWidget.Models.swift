//
//  PositionHeatmapWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  Domain value types ported from features/dashboard/widgets/PositionHeatmapWidget.tsx:
//  the cached GPS sample projection, the density `ClusterPoint`, the responsive
//  tier, and the coalesced state-holder snapshot the source pushes.
//

import CoreLocation
import Foundation

// MARK: - Domain: cached sample + density cluster (port of PositionHeatmapWidget.tsx)

/// A cached GPS sample projected to the minimal shape the heatmap consumes — the
/// web `useVehiclePositions` row reduced to `{ latitude, longitude }`. SI/unitless
/// degrees; no display conversion applies to coordinates.
public struct HeatPosition: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// One density bucket (web `ClusterPoint`): an averaged centre, a visit count, and
/// a normalised 0–1 intensity. `Identifiable` so the map's `ForEach` is stable.
public struct HeatCluster: Sendable, Equatable, Identifiable {
    public let id: Int
    public var latitude: Double
    public var longitude: Double
    public var count: Int
    /// Normalised density in `0...1` (web `intensity = count / maxCount`).
    public var intensity: Double

    public init(id: Int, latitude: Double, longitude: Double, count: Int, intensity: Double) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.count = count
        self.intensity = intensity
    }

    /// The bucket centre as a map coordinate.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Responsive tier (web `isCompact` / `isWide` branches)

/// The widget's responsive density tier. Drives grid precision, map zoom, blob
/// radius, and fill opacity exactly as the web source's `size.cols` branches do.
public enum PositionHeatmapTier: Sendable, Equatable {
    /// `size.cols <= 1` — non-interactive map, coarser grid, no title.
    case compact
    /// `2 <= size.cols < 3` — titled map, standard grid.
    case standard
    /// `size.cols >= 3` — titled map + position-count badge, finer blobs.
    case wide
}

// MARK: - State-holder snapshot (P1/S8)

/// The load lifecycle for the widget's positions, mirroring the shared
/// `LoadableState` cases the production source projects from `Resource<T>`.
public enum PositionHeatmapLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum PositionHeatmapConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `PositionHeatmapSource`: the cached
/// positions plus their load/connection status. The model turns this into the
/// render phase; the view derives clusters from `positions` for the current size.
public struct PositionHeatmapUpdate: Sendable, Equatable {
    public var status: PositionHeatmapLoadStatus
    public var connection: PositionHeatmapConnection
    public var positions: [HeatPosition]
    public var updatedAt: Date?

    public init(
        status: PositionHeatmapLoadStatus = .loading,
        connection: PositionHeatmapConnection = .live,
        positions: [HeatPosition] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.positions = positions
        self.updatedAt = updatedAt
    }
}
