import SwiftUI

// MARK: - Current-position stat kinds (web "Current Position Stats" MetricCards)

/// The six live stats under the playhead (web `replay.stat.*`). One case per named parity panel so
/// each renders from the bound model with its own i18n key + SF Symbol.
public enum TripsReplayStatKind: String, CaseIterable, Identifiable, Sendable {
    case speed, power, battery, elevation, range, temperature

    public var id: String { rawValue }

    /// The web `replay.stat.*` key for the card label.
    var titleKey: LocalizedStringKey {
        switch self {
        case .speed: "replay.stat.speed"
        case .power: "replay.stat.power"
        case .battery: "replay.stat.battery"
        case .elevation: "replay.stat.elevation"
        case .range: "replay.stat.range"
        case .temperature: "replay.stat.temp"
        }
    }

    var systemImage: String {
        switch self {
        case .speed: "gauge.with.dots.needle.50percent"
        case .power: "bolt.fill"
        case .battery: "battery.75percent"
        case .elevation: "mountain.2.fill"
        case .range: "location.north.line.fill"
        case .temperature: "thermometer.medium"
        }
    }
}

/// A formatted current-position stat (web `MetricCard`). `value` is already display-unit formatted;
/// `isActive` mirrors the web `cardHighlight` ring when the playhead sits on a related marker.
public struct TripsReplayStatValue: Identifiable, Sendable {
    public let kind: TripsReplayStatKind
    public let value: String
    public let isActive: Bool

    public var id: String { kind.rawValue }
}

// MARK: - Drive-summary kinds (web "Drive Summary" StatCards)

/// The eight drive-summary tiles (web `replay.summary.*`). One case per named parity panel.
public enum TripsReplaySummaryKind: String, CaseIterable, Identifiable, Sendable {
    case distance, duration, efficiency, elevationGain, elevationLoss, maxSpeed, avgSpeed, battery

    public var id: String { rawValue }

    /// The web `replay.summary.*` key for the tile label.
    var titleKey: LocalizedStringKey {
        switch self {
        case .distance: "replay.summary.distance"
        case .duration: "replay.summary.duration"
        case .efficiency: "replay.summary.efficiency"
        case .elevationGain: "replay.summary.elevGain"
        case .elevationLoss: "replay.summary.elevLoss"
        case .maxSpeed: "replay.summary.maxSpeed"
        case .avgSpeed: "replay.summary.avgSpeed"
        case .battery: "replay.summary.battery"
        }
    }

    var systemImage: String {
        switch self {
        case .distance: "road.lanes"
        case .duration: "clock.fill"
        case .efficiency: "chart.line.uptrend.xyaxis"
        case .elevationGain: "arrow.up.right"
        case .elevationLoss: "arrow.down.right"
        case .maxSpeed, .avgSpeed: "gauge.with.dots.needle.67percent"
        case .battery: "battery.100percent.bolt"
        }
    }
}

/// A formatted drive-summary tile (web `StatCard`). `value` is display-unit formatted.
public struct TripsReplaySummaryValue: Identifiable, Sendable {
    public let kind: TripsReplaySummaryKind
    public let value: String

    public var id: String { kind.rawValue }
}

// MARK: - Display projection (web render-boundary formatting)

extension TripsReplayModel {
    /// Em-dash sentinel for an absent measurement (web `'—'`).
    static let emDash = "—"

    /// The six current-position stats formatted to the user's units (web `MetricCard` grid).
    func currentStats(units: UnitPreferences) -> [TripsReplayStatValue] {
        let position = currentPosition
        let kind = activeMarker?.kind
        return TripsReplayStatKind.allCases.map { stat in
            TripsReplayStatValue(
                kind: stat,
                value: statValue(stat, position: position, units: units),
                isActive: isHighlighted(stat, marker: kind)
            )
        }
    }

    private func statValue(
        _ stat: TripsReplayStatKind,
        position: TripsReplaySample?,
        units: UnitPreferences
    ) -> String {
        guard let position else { return Self.emDash }
        switch stat {
        case .speed:
            return position.speedMps.map { Units.formatSpeed($0, units) } ?? Self.emDash
        case .power:
            return position.powerW.map { String(format: "%.1f kW", $0 / 1000) } ?? Self.emDash
        case .battery:
            return "\(Int(position.batteryPct.rounded()))%"
        case .elevation:
            return position.elevationM.map { "\(Int($0.rounded())) m" } ?? Self.emDash
        case .range:
            return position.ratedRangeM.map { Units.formatDistance($0, units) } ?? Self.emDash
        case .temperature:
            return position.outsideTempC.map { Units.formatTemperature($0, units) } ?? Self.emDash
        }
    }

    /// Web `cardHighlight`: the playhead-on-marker ring for the speed / power / battery cards.
    private func isHighlighted(_ stat: TripsReplayStatKind, marker: TripsReplayMarkerKind?) -> Bool {
        switch stat {
        case .speed: marker == .fastSegment
        case .power: marker == .regenPeak
        case .battery: marker == .lowSoc
        default: false
        }
    }

    /// The eight drive-summary tiles formatted to the user's units (web `StatCard` grid).
    func summaryItems(units: UnitPreferences) -> [TripsReplaySummaryValue] {
        TripsReplaySummaryKind.allCases.map { kind in
            TripsReplaySummaryValue(kind: kind, value: summaryValue(kind, units: units))
        }
    }

    private func summaryValue(_ kind: TripsReplaySummaryKind, units: UnitPreferences) -> String {
        guard let record else { return Self.emDash }
        switch kind {
        case .distance: return Units.formatDistance(record.distanceM, units)
        case .duration: return Self.formatDriveTime(minutes: record.durationS / 60)
        case .efficiency: return efficiencyText(record, units: units)
        case .elevationGain: return elevationText(TripsReplayDerivations.elevationGainM(positions))
        case .elevationLoss: return elevationText(TripsReplayDerivations.elevationLossM(positions))
        case .maxSpeed: return record.maxSpeedMps.map { Units.formatSpeed($0, units) } ?? Self.emDash
        case .avgSpeed: return record.avgSpeedMps.map { Units.formatSpeed($0, units) } ?? Self.emDash
        case .battery: return batteryText(record)
        }
    }

    private func efficiencyText(_ record: TripsReplayRecord, units: UnitPreferences) -> String {
        let distanceUser = Units.convertDistance(record.distanceM, units)
        guard record.distanceM > 0, distanceUser > 0,
              let start = record.startBatteryPct, let end = record.endBatteryPct
        else {
            return Self.emDash
        }
        let efficiency = (start - end) / distanceUser * 1000
        return String(format: "%.0f Wh/km", efficiency)
    }

    private func elevationText(_ meters: Double?) -> String {
        meters.map { "\(Int($0.rounded())) m" } ?? Self.emDash
    }

    private func batteryText(_ record: TripsReplayRecord) -> String {
        guard let start = record.startBatteryPct, let end = record.endBatteryPct else {
            return Self.emDash
        }
        return "\(Int(start.rounded()))% → \(Int(end.rounded()))%"
    }

    /// Web `fmtDriveTime`: minutes → "Xh Ym" / "Ym".
    static func formatDriveTime(minutes: Double) -> String {
        let hours = Int(minutes) / 60
        let mins = Int(minutes.rounded()) % 60
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Web `fmtDuration`: milliseconds → "H:MM:SS" / "MM:SS" for the transport time labels.
    static func formatElapsed(_ milliseconds: Double) -> String {
        guard milliseconds.isFinite, milliseconds > 0 else { return "00:00" }
        let totalSeconds = Int(milliseconds / 1000)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        let mm = String(format: "%02d", minutes)
        let ss = String(format: "%02d", seconds)
        return hours > 0 ? "\(hours):\(mm):\(ss)" : "\(mm):\(ss)"
    }
}
