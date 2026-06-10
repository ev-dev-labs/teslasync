//
//  TelemetryPipelineCard.Adapter.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  The testable projection core: the cached vehicle / polling / streaming DTOs →
//  the view-ready `TelemetryPipelineVehicleRow` rows + the fleet liveness summary.
//  Reproduces the web source's liveness rules verbatim — the union of the two ingest
//  paths (Fleet Telemetry stream `lastReceived` and REST poll `last_poll_time`), the
//  freshest-wins source selection (stream wins a tie), the < 5 / < 30 min severity
//  ladder, the `VIN ···{tail}` formatting, the ≥ 50 / ≥ 20 battery tone, the canonical
//  `vehicleStateBadge` mapping, the grouped count / em-dash formatting, the per-card
//  render-phase resolution, and the VoiceOver row summary. All pure + dependency-free so
//  the adapter can be unit-tested without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Render phase (web shell loading / content / empty branches)

/// The mutually-exclusive render branches the card switches over, mirroring the web
/// `vehicles` prop + the polling/MQTT queries: the initial skeleton, the "no vehicles
/// configured" empty state, the query-failure error state, and the resolved content.
public enum TelemetryPipelinePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Liveness (web `Liveness` / `LivenessSource`)

/// The per-vehicle liveness severity bucket (web `Liveness`). `allCases` preserves the
/// web's fixed chip order (sending → slow → stale → offline).
public enum TelemetryLiveness: String, Equatable, Sendable, CaseIterable {
    case sending
    case slow
    case stale
    case offline
}

/// Which ingest path produced the freshest timestamp (web `LivenessSource`), so the chip
/// can label itself "stream" or "poll".
public enum TelemetryLivenessSource: Equatable, Sendable {
    case stream
    case poll
    case none
}

/// The resolved liveness of one vehicle: its severity bucket, the winning source, and the
/// union last-seen instant the relative-time label renders from.
public struct TelemetryLivenessResult: Equatable, Sendable {
    public let level: TelemetryLiveness
    public let source: TelemetryLivenessSource
    public let lastSeen: Date?

    public init(level: TelemetryLiveness, source: TelemetryLivenessSource, lastSeen: Date?) {
        self.level = level
        self.source = source
        self.lastSeen = lastSeen
    }
}

// MARK: - Canonical vehicle-state label (web `vehicleStateBadge`)

/// A vehicle-state badge label: a localization `key` when the state is one of the canonical
/// buckets the web normalizes to, or `nil` to render the server value verbatim (an unknown
/// state is data, not a UI literal).
public struct TelemetryStateLabel: Equatable, Sendable {
    public let key: String?
    public let fallback: String

    public init(key: String?, fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

// MARK: - Row projection (web per-vehicle `<li>`)

/// One projected per-vehicle row: identity + display name, the `···{tail}` VIN tail, the
/// canonical state label, the resolved liveness (level + source + last-seen), the optional
/// next-poll instant, and the optional rounded battery percent (nil → em-dash).
public struct TelemetryPipelineVehicleRow: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vinTail: String
    public let state: TelemetryStateLabel
    public let level: TelemetryLiveness
    public let source: TelemetryLivenessSource
    public let lastSeen: Date?
    public let nextPoll: Date?
    public let batteryPercent: Int?

    public init(
        id: Int64,
        displayName: String,
        vinTail: String,
        state: TelemetryStateLabel,
        level: TelemetryLiveness,
        source: TelemetryLivenessSource,
        lastSeen: Date?,
        nextPoll: Date?,
        batteryPercent: Int?
    ) {
        self.id = id
        self.displayName = displayName
        self.vinTail = vinTail
        self.state = state
        self.level = level
        self.source = source
        self.lastSeen = lastSeen
        self.nextPoll = nextPoll
        self.batteryPercent = batteryPercent
    }
}

// MARK: - Fleet liveness summary (web sub-header chips)

/// The fleet-wide liveness rollup (web `counts` reduce), used by the summary chips. Only
/// non-zero buckets render, in the fixed `TelemetryLiveness.allCases` order.
public struct TelemetryFleetSummary: Equatable, Sendable {
    public var sending: Int
    public var slow: Int
    public var stale: Int
    public var offline: Int

    public init(sending: Int = 0, slow: Int = 0, stale: Int = 0, offline: Int = 0) {
        self.sending = sending
        self.slow = slow
        self.stale = stale
        self.offline = offline
    }

    /// The tally for one bucket.
    public func tally(for level: TelemetryLiveness) -> Int {
        switch level {
        case .sending: sending
        case .slow: slow
        case .stale: stale
        case .offline: offline
        }
    }

    /// The non-zero buckets in the web's fixed chip order (web `.filter((k) => counts[k] > 0)`).
    public var orderedNonZero: [(level: TelemetryLiveness, count: Int)] {
        TelemetryLiveness.allCases.compactMap { level in
            let tally = tally(for: level)
            return tally > 0 ? (level, tally) : nil
        }
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection + presentation rules shared by the model and the views. No store, no
/// bundle, no SwiftUI view — only value-typed inputs/outputs.
public enum TelemetryPipelineProjection {
    /// The em-dash the web renders for an absent count / battery / last-seen.
    public static let emDash = "—"

    /// The middle-dot run the web prefixes the VIN tail with (`VIN ···{tail}`).
    public static let vinDots = "···"

    /// The fallback tail when a VIN is missing (web `'????'`).
    public static let vinFallback = "????"

    /// Liveness thresholds in minutes (web `< 5` sending, `< 30` slow).
    public static let sendingWindowMinutes: Double = 5
    public static let slowWindowMinutes: Double = 30

    /// Derive per-vehicle liveness from the UNION of both ingest paths (web `liveness`).
    /// Returns the severity bucket plus which source produced the freshest timestamp; a tie
    /// resolves to the stream (web `streamMs >= pollMs`). A future timestamp reads as
    /// `sending` (the web's signed age comparison).
    public static func liveness(
        lastPoll: Date?,
        lastStream: Date?,
        now: Date
    ) -> TelemetryLivenessResult {
        var lastSeen: Date?
        var source: TelemetryLivenessSource = .none

        if let poll = lastPoll, let stream = lastStream {
            if stream >= poll {
                lastSeen = stream
                source = .stream
            } else {
                lastSeen = poll
                source = .poll
            }
        } else if let stream = lastStream {
            lastSeen = stream
            source = .stream
        } else if let poll = lastPoll {
            lastSeen = poll
            source = .poll
        }

        guard let seen = lastSeen else {
            return TelemetryLivenessResult(level: .offline, source: .none, lastSeen: nil)
        }
        let ageMinutes = now.timeIntervalSince(seen) / 60
        let level: TelemetryLiveness = if ageMinutes < sendingWindowMinutes {
            .sending
        } else if ageMinutes < slowWindowMinutes {
            .slow
        } else {
            .stale
        }
        return TelemetryLivenessResult(level: level, source: source, lastSeen: seen)
    }

    /// The last four VIN characters (web `vinTail`): the whole trimmed value when ≤ 4, the
    /// `????` sentinel when absent/blank.
    public static func vinTail(_ vin: String?) -> String {
        guard let trimmed = vin?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return vinFallback
        }
        if trimmed.count <= 4 { return trimmed }
        return String(trimmed.suffix(4))
    }

    /// The canonical state label (web `vehicleStateBadge`): online/driving/charging pass
    /// through as their own bucket, asleep/sleeping fold to `asleep`, offline stays offline,
    /// an absent state is `unknown`, and any other value renders verbatim (server data).
    public static func stateLabel(for state: String?) -> TelemetryStateLabel {
        guard let raw = state?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return TelemetryStateLabel(key: "telemetry.pipeline.state.unknown", fallback: "unknown")
        }
        return switch raw.lowercased() {
        case "online": TelemetryStateLabel(key: "telemetry.pipeline.state.online", fallback: "online")
        case "driving": TelemetryStateLabel(key: "telemetry.pipeline.state.driving", fallback: "driving")
        case "charging": TelemetryStateLabel(key: "telemetry.pipeline.state.charging", fallback: "charging")
        case "asleep", "sleeping": TelemetryStateLabel(key: "telemetry.pipeline.state.asleep", fallback: "asleep")
        case "offline": TelemetryStateLabel(key: "telemetry.pipeline.state.offline", fallback: "offline")
        default: TelemetryStateLabel(key: nil, fallback: raw.lowercased())
        }
    }

    /// The battery tone (web `batteryColor`): ≥ 50 success, ≥ 20 warning, else danger.
    public static func batteryTone(_ percent: Int) -> TSTone {
        if percent >= 50 { return .success }
        if percent >= 20 { return .warning }
        return .danger
    }

    /// Clamp a rounded battery percent to 0…100 for the bar width (web `Math.min/Math.max`).
    public static func clampBattery(_ percent: Int) -> Int {
        min(100, max(0, percent))
    }

    /// The status-token color for a liveness bucket (web emerald/amber/red/grey dot).
    public static func color(for level: TelemetryLiveness) -> Color {
        switch level {
        case .sending: Color.TS.statusSuccess
        case .slow: Color.TS.statusWarning
        case .stale: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        }
    }

    /// The localization key + English fallback for a liveness label (web `cls.label`).
    public static func label(for level: TelemetryLiveness) -> (key: String, fallback: String) {
        switch level {
        case .sending: ("telemetry.pipeline.sending", "sending")
        case .slow: ("telemetry.pipeline.slow", "slow")
        case .stale: ("telemetry.pipeline.stale", "stale")
        case .offline: ("telemetry.pipeline.offline", "offline")
        }
    }

    /// Roll the per-vehicle liveness into the fleet summary (web `counts` reduce).
    public static func summary(for rows: [TelemetryPipelineVehicleRow]) -> TelemetryFleetSummary {
        var summary = TelemetryFleetSummary()
        for row in rows {
            switch row.level {
            case .sending: summary.sending += 1
            case .slow: summary.slow += 1
            case .stale: summary.stale += 1
            case .offline: summary.offline += 1
            }
        }
        return summary
    }

    /// Resolve the card's render phase. The skeleton shows only on the initial fetch (no
    /// vehicles yet); resolved-with-vehicles is content; resolved-empty is the empty state;
    /// a failure with no cached vehicles is the error state, while cached vehicles stay
    /// visible behind a failure with the freshness banner reflecting staleness.
    public static func resolvePhase(
        _ status: TelemetryPipelineLoadStatus,
        hasVehicles: Bool
    ) -> TelemetryPipelinePhase {
        switch status {
        case .loading:
            hasVehicles ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasVehicles ? .content : .empty
        case let .failed(message):
            hasVehicles ? .content : .error(message)
        }
    }

    /// Grouped integer formatting (web `fmtInt`); an absent value renders the em-dash
    /// sentinel (web `fmtCount`).
    public static func formattedCount(_ value: Int?) -> String {
        guard let value else { return emDash }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// The resolved display name (web ``v.display_name || `Vehicle ${id}` ``): the trimmed
    /// name, or a localized "Vehicle {id}" fallback when blank.
    public static func displayName(
        raw: String,
        id: Int64,
        localize: (String, String) -> String
    ) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        let template = localize("telemetry.pipeline.vehicleFallback", "Vehicle %lld")
        return String(format: template, id)
    }
}

// MARK: - Timestamp formatting (web `relativeTime`)

/// Localized timestamp rendering for the card. The relative form (web `relativeTime`) is
/// delegated to the OS so it is localized without hardcoded English; the absolute form
/// backs the accessibility value.
public enum TelemetryPipelineTimestamp {
    /// Relative "2 min ago" / "in 5s" label, localized + injectable `now` for tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// The relative label for an optional instant; em-dash when absent (web `?? '—'`).
    public static func relativeOrDash(for date: Date?, relativeTo now: Date = Date()) -> String {
        guard let date else { return TelemetryPipelineProjection.emDash }
        return relative(for: date, relativeTo: now)
    }

    /// Absolute, locale-aware "Apr 4, 2:30 AM" body; em-dash when absent.
    public static func absolute(for date: Date?) -> String {
        guard let date else { return TelemetryPipelineProjection.emDash }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a per-vehicle row. Pure + public so the spoken content
/// can be unit-tested without rendering; labels resolve through the injected localizer
/// (bundle-free in tests). An absent battery is omitted rather than read as "dash".
public enum TelemetryPipelineAccessibility {
    public static func rowSummary(
        _ row: TelemetryPipelineVehicleRow,
        now: Date,
        localize: (String, String) -> String
    ) -> String {
        let livenessLabel = TelemetryPipelineProjection.label(for: row.level)
        let stateText = row.state.key.map { localize($0, row.state.fallback) } ?? row.state.fallback
        var parts = [
            row.displayName,
            localize(livenessLabel.key, livenessLabel.fallback),
            "\(localize("telemetry.pipeline.vin", "VIN")) \(row.vinTail)",
            stateText
        ]
        if let battery = row.batteryPercent {
            parts.append(String(
                format: localize("telemetry.pipeline.batteryValue", "battery %lld%%"),
                battery
            ))
        }
        let lastSeen = TelemetryPipelineTimestamp.relativeOrDash(for: row.lastSeen, relativeTo: now)
        parts.append("\(localize("telemetry.pipeline.lastSeen", "last seen")) \(lastSeen)")
        return parts.joined(separator: ", ")
    }
}
