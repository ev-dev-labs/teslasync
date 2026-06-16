import Foundation

// MARK: - Pure derivations (web `TripReplayPage` memos + `useTripReplay` + `replayMarkers.ts`)

/// SwiftUI-free derivations mirroring the trip-replay page's inline memos and the `useTripReplay`
/// hook, kept here so the replay clock, the position↔telemetry merge, the timeline / elevation
/// series, and the marker detection unit-test independently of the view. Everything is computed
/// in SI; the views convert at the render boundary (ADR-005).
public enum TripReplayDerivations {
    // Web marker thresholds (replayMarkers.ts).
    static let lowSocPct = 20.0
    static let fastPercentile = 0.95
    static let regenPeakPercentile = 0.95
    static let maxMarkersPerKind = 25
    /// Stationary-GPS detector radius (web `hasMeaningfulRoute` ~10 m).
    static let stationaryRadiusM = 10.0

    // MARK: Position merge (web positions ↔ nearest telemetry join)

    /// Builds the replay trail: each position filled from its nearest-by-timestamp telemetry row
    /// for the fields positions don't carry (power/battery/elevation/range/temperature), then the
    /// null-island coordinates dropped. Without the merge the "Current Position Stats" panel would
    /// render `—` for every metric except speed (web `useDriveDetailData` comment).
    public static func mergedPositions(_ record: TripReplayRecord) -> [TripDrivePosition] {
        let telemetry = record.telemetry.sorted { $0.timestamp < $1.timestamp }
        return record.positions.map { position in
            guard let near = nearestByTime(telemetry, position.timestamp) else { return position }
            return TripDrivePosition(
                id: position.id,
                timestamp: position.timestamp,
                latitude: position.latitude,
                longitude: position.longitude,
                speedMps: position.speedMps ?? near.speedMps,
                powerW: position.powerW ?? near.powerW,
                batteryPct: position.batteryPct != 0 ? position.batteryPct : near.batteryPct,
                elevationM: position.elevationM ?? near.elevationM,
                outsideTempC: position.outsideTempC ?? near.outsideTempC,
                ratedRangeM: position.ratedRangeM ?? near.ratedRangeM
            )
        }
        .filter(\.hasCoordinate)
    }

    /// Binary-search the telemetry row whose timestamp is closest to `target`.
    static func nearestByTime(_ rows: [TripDrivePosition], _ target: Date) -> TripDrivePosition? {
        guard !rows.isEmpty else { return nil }
        var low = 0
        var high = rows.count - 1
        while low < high {
            let mid = (low + high) / 2
            if rows[mid].timestamp < target { low = mid + 1 } else { high = mid }
        }
        if low > 0 {
            let prev = rows[low - 1]
            let curr = rows[low]
            if abs(prev.timestamp.timeIntervalSince(target)) < abs(curr.timestamp.timeIntervalSince(target)) {
                return prev
            }
        }
        return rows[low]
    }

    // MARK: Replay clock (web `useTripReplay`)

    /// Per-position elapsed offsets in milliseconds since the first sample (web `buildTimeline`).
    public static func timelineOffsets(_ positions: [TripDrivePosition]) -> [Double] {
        guard let first = positions.first else { return [] }
        return positions.map { $0.timestamp.timeIntervalSince(first.timestamp) * 1000 }
    }

    /// The total replay duration in milliseconds (last offset, web `totalTime`).
    public static func totalTime(_ positions: [TripDrivePosition]) -> Double {
        timelineOffsets(positions).last ?? 0
    }

    /// Binary-search the position index whose offset is closest to `targetMs` (web `indexAtTime`).
    public static func indexAtTime(_ offsets: [Double], _ targetMs: Double) -> Int {
        guard !offsets.isEmpty else { return 0 }
        var low = 0
        var high = offsets.count - 1
        while low < high {
            let mid = (low + high) / 2
            if offsets[mid] < targetMs { low = mid + 1 } else { high = mid }
        }
        if low > 0, targetMs - offsets[low - 1] < offsets[low] - targetMs {
            return low - 1
        }
        return low
    }

    // MARK: Series (web `timelineData` / `elevationData`)

    /// The speed+power timeline (web `timelineData`): minutes-since-start on x, SI speed + power.
    public static func timelineData(_ positions: [TripDrivePosition]) -> [TripReplayTimelinePoint] {
        guard let first = positions.first else { return [] }
        return positions.enumerated().map { index, position in
            let minutes = position.timestamp.timeIntervalSince(first.timestamp) / 60
            return TripReplayTimelinePoint(
                index: index,
                timeMin: minutes,
                speedMps: position.speedMps ?? 0,
                powerW: position.powerW ?? 0
            )
        }
    }

    /// The elevation profile (web `elevationData`): cumulative haversine distance (SI metres),
    /// elevation, and speed per sample.
    public static func elevationData(_ positions: [TripDrivePosition]) -> [TripReplayElevationPoint] {
        var cumulativeM = 0.0
        return positions.enumerated().map { index, position in
            if index > 0 {
                let previous = positions[index - 1]
                cumulativeM += haversineMeters(
                    previous.latitude, previous.longitude,
                    position.latitude, position.longitude
                )
            }
            return TripReplayElevationPoint(
                index: index,
                cumulativeDistanceM: cumulativeM,
                elevationM: position.elevationM ?? 0,
                speedMps: position.speedMps ?? 0
            )
        }
    }

    /// A downsampled speed series for the scrubber sparkline (web `speedSparkData`, ~80 points).
    public static func speedSparkline(_ positions: [TripDrivePosition], target: Int = 80) -> [Double] {
        guard !positions.isEmpty else { return [] }
        if positions.count <= target { return positions.map { $0.speedMps ?? 0 } }
        let stride = Double(positions.count) / Double(target)
        return (0 ..< target).map { index in
            let sampleIndex = min(positions.count - 1, Int(Double(index) * stride))
            return positions[sampleIndex].speedMps ?? 0
        }
    }

    // MARK: Map helpers (web `TripReplayMap`)

    /// Whether the trail spreads beyond a stationary GPS cluster (web `hasMeaningfulRoute`).
    public static func hasMeaningfulRoute(_ positions: [TripDrivePosition]) -> Bool {
        guard let anchor = positions.first(where: \.hasCoordinate) else { return false }
        return positions.contains { sample in
            sample.hasCoordinate
                && haversineMeters(anchor.latitude, anchor.longitude, sample.latitude, sample.longitude)
                > stationaryRadiusM
        }
    }

    /// Linear scan for the sample closest (by haversine) to a tapped coordinate (web
    /// `nearestSampleIndex`) — replay trails top out at a few thousand samples.
    public static func nearestSampleIndex(_ positions: [TripDrivePosition], lat: Double, lon: Double) -> Int {
        guard !positions.isEmpty else { return 0 }
        var bestIndex = 0
        var bestDistance = Double.greatestFiniteMagnitude
        for (index, position) in positions.enumerated() {
            let distance = haversineMeters(position.latitude, position.longitude, lat, lon)
            if distance < bestDistance {
                bestDistance = distance
                bestIndex = index
            }
        }
        return bestIndex
    }

    // MARK: Markers (web `computeReplayMarkers` / `nearestMarker`)

    /// Detects the replay timeline markers (web `computeReplayMarkers`): start + stop anchors,
    /// the fast-segment (≥ p95 speed), regen-peak (≤ p95 regen magnitude), and low-SoC (< 20 %)
    /// families, each capped + spread so the scrubber tick strip stays legible.
    public static func markers(_ positions: [TripDrivePosition]) -> [TripReplayMarker] {
        guard positions.count > 1 else { return [] }
        let offsets = timelineOffsets(positions)
        let total = offsets.last ?? 0
        guard total > 0 else { return [] }
        func at(_ index: Int) -> Double { min(1, max(0, offsets[index] / total)) }

        var result: [TripReplayMarker] = [
            TripReplayMarker(at: 0, index: 0, kind: .start),
            TripReplayMarker(at: 1, index: positions.count - 1, kind: .stop)
        ]

        let speeds = positions.compactMap(\.speedMps)
        if let fastThreshold = percentile(speeds, fastPercentile), fastThreshold > 0 {
            let indices = positions.indices.filter { (positions[$0].speedMps ?? 0) >= fastThreshold }
            result += capped(indices).map { TripReplayMarker(at: at($0), index: $0, kind: .fastSegment) }
        }

        let regenMagnitudes = positions.compactMap(\.powerW).filter { $0 < 0 }.map(abs)
        if let regenThreshold = percentile(regenMagnitudes, regenPeakPercentile), regenThreshold > 0 {
            let indices = positions.indices.filter { index in
                guard let power = positions[index].powerW, power < 0 else { return false }
                return abs(power) >= regenThreshold
            }
            result += capped(indices).map { TripReplayMarker(at: at($0), index: $0, kind: .regenPeak) }
        }

        let lowSocIndices = positions.indices.filter {
            positions[$0].batteryPct < lowSocPct && positions[$0].batteryPct > 0
        }
        result += capped(lowSocIndices).map { TripReplayMarker(at: at($0), index: $0, kind: .lowSoc) }

        return result.sorted { $0.at < $1.at }
    }

    /// The marker nearest the playhead within `tolerance` (web `nearestMarker`), driving the
    /// active-stat-card highlight.
    public static func nearestMarker(
        _ markers: [TripReplayMarker],
        progress: Double,
        tolerance: Double = 0.02
    ) -> TripReplayMarker? {
        markers
            .map { ($0, abs($0.at - progress)) }
            .filter { $0.1 <= tolerance }
            .min { $0.1 < $1.1 }?
            .0
    }

    // MARK: Private

    /// Caps an index list to `maxMarkersPerKind`, stride-sampling to keep the spread.
    private static func capped(_ indices: [Int]) -> [Int] {
        guard indices.count > maxMarkersPerKind else { return indices }
        let step = Double(indices.count - 1) / Double(maxMarkersPerKind - 1)
        return (0 ..< maxMarkersPerKind).map { indices[Int((Double($0) * step).rounded())] }
    }

    /// Linear-interpolation percentile (web `safePercentile`), `nil` for empty input.
    static func percentile(_ values: [Double], _ fraction: Double) -> Double? {
        guard !values.isEmpty else { return nil }
        if values.count == 1 { return values[0] }
        let sorted = values.sorted()
        let rank = max(0, min(1, fraction)) * Double(sorted.count - 1)
        let lower = Int(rank.rounded(.down))
        let upper = Int(rank.rounded(.up))
        if lower == upper { return sorted[lower] }
        return sorted[lower] + (rank - Double(lower)) * (sorted[upper] - sorted[lower])
    }

    /// Great-circle distance in metres (web `haversineDistance`).
    static func haversineMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let earthRadius = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let hav = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return earthRadius * 2 * atan2(sqrt(hav), sqrt(1 - hav))
    }
}
