//
//  PositionHeatmapWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  Pure, unit-tested adapter — a faithful Swift port of the web source's
//  clusterPositions / centroid / intensityColor helpers plus the responsive
//  precision / zoom / radius / fill-opacity tables. No SwiftUI state, no
//  transport: this is the "cached → projection" core the tests exercise.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Density colour

/// The sRGB components (0–1) of a density colour (web `intensityColor`). A named
/// value type rather than a tuple so it reads clearly at call/test sites.
public struct PositionHeatmapRGB: Sendable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }
}

// MARK: - PositionHeatmapBuilder (port of the web module-level functions)

/// Pure adapters that turn cached GPS samples into the density projection the
/// `PositionHeatmapWidget` renders. Mirrors `PositionHeatmapWidget.tsx` exactly so
/// web and native agree on bucketing, centring, and colour.
public enum PositionHeatmapBuilder {
    /// Fallback centre when there are no clusters (web `centroid` → San Francisco).
    public static let fallbackCenter = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)

    /// A mutable accumulator for one grid bucket while clustering.
    private struct DensityBucket {
        var lat: Double
        var lon: Double
        var count: Int
    }

    // MARK: Responsive tier

    /// The responsive tier for a column count (web `isCompact` / `isWide`).
    public static func tier(forColumns columns: Int) -> PositionHeatmapTier {
        if columns <= 1 { return .compact }
        if columns >= 3 { return .wide }
        return .standard
    }

    /// Grid precision: finer (500) for standard/wide, coarser (200) for compact
    /// (web `precision = isCompact ? 200 : 500`).
    public static func precision(for tier: PositionHeatmapTier) -> Int {
        tier == .compact ? 200 : 500
    }

    // MARK: Clustering (web `clusterPositions`)

    /// Grid-based density clustering: bucket positions by truncated lat/lon, keep a
    /// running average centre per bucket, then normalise counts to a 0–1 intensity.
    /// Insertion order is preserved to match the web `Map` iteration order.
    public static func clusterPositions(_ positions: [HeatPosition], precision: Int) -> [HeatCluster] {
        var order: [String] = []
        var buckets: [String: DensityBucket] = [:]
        let scale = Double(precision)

        for position in positions {
            if position.latitude == 0, position.longitude == 0 { continue }
            guard position.latitude.isFinite, position.longitude.isFinite else { continue }
            let key = "\(Int(position.latitude * scale)):\(Int(position.longitude * scale))"
            if var existing = buckets[key] {
                let nextCount = Double(existing.count + 1)
                existing.lat = (existing.lat * Double(existing.count) + position.latitude) / nextCount
                existing.lon = (existing.lon * Double(existing.count) + position.longitude) / nextCount
                existing.count += 1
                buckets[key] = existing
            } else {
                buckets[key] = DensityBucket(lat: position.latitude, lon: position.longitude, count: 1)
                order.append(key)
            }
        }

        var maxCount = 1
        for key in order {
            if let bucket = buckets[key], bucket.count > maxCount { maxCount = bucket.count }
        }

        var result: [HeatCluster] = []
        result.reserveCapacity(order.count)
        for (index, key) in order.enumerated() {
            guard let bucket = buckets[key] else { continue }
            result.append(
                HeatCluster(
                    id: index,
                    latitude: bucket.lat,
                    longitude: bucket.lon,
                    count: bucket.count,
                    intensity: Double(bucket.count) / Double(maxCount)
                )
            )
        }
        return result
    }

    // MARK: Centre (web `centroid`)

    /// The averaged centre of every cluster, or the SF fallback when empty.
    public static func centroid(_ clusters: [HeatCluster]) -> CLLocationCoordinate2D {
        guard !clusters.isEmpty else { return fallbackCenter }
        var latSum = 0.0
        var lonSum = 0.0
        for cluster in clusters {
            latSum += cluster.latitude
            lonSum += cluster.longitude
        }
        let divisor = Double(clusters.count)
        return CLLocationCoordinate2D(latitude: latSum / divisor, longitude: lonSum / divisor)
    }

    // MARK: Colour (web `intensityColor`)

    /// The sRGB components (0–1) for an intensity (web cool teal → hot magenta).
    /// Alpha is applied separately via `fillOpacity` (Leaflet's `fillOpacity`
    /// wins over the colour's alpha), so this returns an opaque triple.
    public static func intensityRGB(_ intensity: Double) -> PositionHeatmapRGB {
        let clamped = min(max(intensity, 0), 1)
        return PositionHeatmapRGB(
            red: (20 + clamped * 225).rounded() / 255,
            green: (184 - clamped * 120).rounded() / 255,
            blue: (166 + clamped * 60).rounded() / 255
        )
    }

    /// The opaque density colour for an intensity (web `intensityColor` RGB).
    public static func color(forIntensity intensity: Double) -> Color {
        let components = intensityRGB(intensity)
        return Color(.sRGB, red: components.red, green: components.green, blue: components.blue, opacity: 1)
    }

    /// Fill opacity per tier (web: compact `0.4 + i*0.5`, else `0.35 + i*0.55`).
    public static func fillOpacity(_ intensity: Double, tier: PositionHeatmapTier) -> Double {
        let clamped = min(max(intensity, 0), 1)
        return tier == .compact ? 0.4 + clamped * 0.5 : 0.35 + clamped * 0.55
    }

    /// Blob radius in points (web Leaflet pixel radius): compact `4 + i*6`,
    /// wide `6 + i*14`, standard `6 + i*10`.
    public static func radius(_ intensity: Double, tier: PositionHeatmapTier) -> Double {
        let clamped = min(max(intensity, 0), 1)
        switch tier {
        case .compact: return 4 + clamped * 6
        case .wide: return 6 + clamped * 14
        case .standard: return 6 + clamped * 10
        }
    }

    // MARK: Camera (web fixed `center` + `zoom`)

    /// Slippy-map zoom level per tier (web compact/standard 11, wide 12).
    public static func zoom(for tier: PositionHeatmapTier) -> Double {
        tier == .wide ? 12 : 11
    }

    /// Convert a web centre + slippy-map zoom into an `MKCoordinateRegion`. The
    /// longitude span is the full world divided by `2^zoom`; latitude is scaled to
    /// the widget's roughly portrait aspect.
    public static func region(center: CLLocationCoordinate2D, zoom: Double) -> MKCoordinateRegion {
        let longitudeDelta = 360.0 / pow(2.0, zoom)
        let latitudeDelta = longitudeDelta * 0.7
        return MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
        )
    }
}
