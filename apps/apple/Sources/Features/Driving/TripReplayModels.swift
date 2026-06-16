import Foundation

// Value types for the Trip-Replay surface (web
// `web/src/features/trips/pages/TripReplayPage.tsx`, re-exported from
// `web/src/features/driving/pages/TripReplayPage.tsx`). The page replays one drive's recorded
// GPS + telemetry trail: a route map with a moving playhead, a transport scrubber, a live
// "current position" stat bar, an elevation profile, a speed+power timeline, and the drive
// summary. Every measurement is stored SI (m, m/s, W, °C — phase-42/48 canonical) and converted
// only at the SwiftUI render boundary via `Units` (ADR-005); the replay clock, the position↔
// telemetry merge, the timeline/elevation series, and the marker detection are pure functions in
// `TripReplayDerivations` so they unit-test without the view.

// MARK: - Position sample (web `DrivePosition`)

/// One replay sample along the drive. `powerW` is SI watts (the view shows kW via `/1000`, like
/// the sibling `DriveDetailPage`); `speedMps` is SI m/s; `ratedRangeM`/`elevationM` are metres;
/// `outsideTempC` is °C. Optional fields are `nil` when the source row didn't record them, which
/// the stat bar surfaces as the em-dash sentinel (web `'—'`).
public struct TripDrivePosition: Identifiable, Hashable, Sendable {
    public let id: String
    public let timestamp: Date
    public let latitude: Double
    public let longitude: Double
    public let speedMps: Double?
    public let powerW: Double?
    public let batteryPct: Double
    public let elevationM: Double?
    public let outsideTempC: Double?
    public let ratedRangeM: Double?

    public init(
        id: String,
        timestamp: Date,
        latitude: Double,
        longitude: Double,
        speedMps: Double? = nil,
        powerW: Double? = nil,
        batteryPct: Double = 0,
        elevationM: Double? = nil,
        outsideTempC: Double? = nil,
        ratedRangeM: Double? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
        self.powerW = powerW
        self.batteryPct = batteryPct
        self.elevationM = elevationM
        self.outsideTempC = outsideTempC
        self.ratedRangeM = ratedRangeM
    }

    /// Whether the sample carries a usable coordinate (web filters `lat !== 0 || lon !== 0`).
    public var hasCoordinate: Bool {
        latitude != 0 || longitude != 0
    }
}

// MARK: - Drive (web `useDrive` → `GET /drives/{id}`)

/// The drive being replayed. Aggregates are SI (m, s, m/s); `positions` is the primary trail and
/// `telemetry` is the parallel richer stream the web merges in by nearest timestamp to fill
/// power/battery/elevation/range/temperature (web `useDriveDetailData` join).
public struct TripReplayRecord: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let startedAt: Date
    public let startAddress: String?
    public let endAddress: String?
    public let distanceM: Double
    public let durationS: Double
    public let startBatteryPct: Double?
    public let endBatteryPct: Double?
    public let avgSpeedMps: Double?
    public let maxSpeedMps: Double?
    public let positions: [TripDrivePosition]
    public let telemetry: [TripDrivePosition]

    public init(
        id: Int64,
        vehicleID: Int64,
        startedAt: Date,
        startAddress: String?,
        endAddress: String?,
        distanceM: Double,
        durationS: Double,
        startBatteryPct: Double?,
        endBatteryPct: Double?,
        avgSpeedMps: Double?,
        maxSpeedMps: Double?,
        positions: [TripDrivePosition],
        telemetry: [TripDrivePosition] = []
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.startedAt = startedAt
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.distanceM = distanceM
        self.durationS = durationS
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
        self.avgSpeedMps = avgSpeedMps
        self.maxSpeedMps = maxSpeedMps
        self.positions = positions
        self.telemetry = telemetry
    }
}

// MARK: - Timeline markers (web `replayMarkers.ts`)

/// A notable moment along the replay timeline (web `ReplayMarkerKind`). Drives the scrubber tick
/// strip and the active-stat-card highlight when the playhead is near one.
public enum TripReplayMarkerKind: String, CaseIterable, Sendable {
    case start
    case stop
    case fastSegment
    case regenPeak
    case lowSoc
}

/// One detected marker (web `ReplayMarker`). `at` is normalized `0...1` over elapsed time so the
/// scrubber tick lines up with the playhead even when sampling is uneven; `index` is the
/// underlying position the marker seeks to.
public struct TripReplayMarker: Identifiable, Hashable, Sendable {
    public let id: String
    public let at: Double
    public let index: Int
    public let kind: TripReplayMarkerKind

    public init(at: Double, index: Int, kind: TripReplayMarkerKind) {
        id = "\(kind.rawValue)-\(index)"
        self.at = at
        self.index = index
        self.kind = kind
    }
}

// MARK: - Derived series (web `timelineData` / `elevationData`)

/// One speed+power timeline point (web `TripReplayChartPoint`). `timeMin` is minutes since the
/// drive start; `speedMps`/`powerW` stay SI and convert at the chart render boundary.
public struct TripReplayTimelinePoint: Identifiable, Hashable, Sendable {
    public let index: Int
    public let timeMin: Double
    public let speedMps: Double
    public let powerW: Double

    public var id: Int {
        index
    }

    public init(index: Int, timeMin: Double, speedMps: Double, powerW: Double) {
        self.index = index
        self.timeMin = timeMin
        self.speedMps = speedMps
        self.powerW = powerW
    }
}

/// One elevation-profile point (web `ElevationDataPoint`). `cumulativeDistanceM` is SI metres of
/// haversine path length; the chart converts it to the user's distance unit at render time.
public struct TripReplayElevationPoint: Identifiable, Hashable, Sendable {
    public let index: Int
    public let cumulativeDistanceM: Double
    public let elevationM: Double
    public let speedMps: Double

    public var id: Int {
        index
    }

    public init(index: Int, cumulativeDistanceM: Double, elevationM: Double, speedMps: Double) {
        self.index = index
        self.cumulativeDistanceM = cumulativeDistanceM
        self.elevationM = elevationM
        self.speedMps = speedMps
    }
}

// MARK: - Page status (web `isLoading ? Skeleton : error ? error : body`)

/// The page's terminal status. `.ready` is the web body (drive resolved; the map / scrubber /
/// stats / charts / summary render, or the no-GPS empty state when the trail is empty). `.error`
/// is the retryable drive-fetch failure (web `PageContainer error`); `.loading` is the initial
/// fetch (web `PageContainer loading`). Named `…PageStatus` to avoid colliding with the
/// component-library `TripReplayPhase` (the charts surface's content/empty/loading/error enum).
public enum TripReplayPageStatus: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}
