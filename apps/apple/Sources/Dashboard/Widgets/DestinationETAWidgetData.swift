import SwiftUI

// MARK: - Data projection

/// Value-typed projection of the `GET /location-snapshots/latest` payload that the
/// web `DestinationETAWidget` consumes via `useLocationSnapshotLatest`.
///
/// The backend stores everything in SI, so `metersToArrival` is the SI source for
/// the web field historically named `miles_to_arrival` (the web feeds it straight
/// into `convertDistanceFromSI`, proving the value is meters). Display conversion
/// happens only at the SwiftUI render boundary through `Units` (ADR-013, S5).
public struct DestinationETASnapshot: Equatable, Sendable {
    public var destinationName: String?
    public var metersToArrival: Double?
    public var minutesToArrival: Double?
    public var locatedAtHome: Bool
    public var locatedAtWork: Bool
    public var locatedAtFavorite: Bool

    public init(
        destinationName: String? = nil,
        metersToArrival: Double? = nil,
        minutesToArrival: Double? = nil,
        locatedAtHome: Bool = false,
        locatedAtWork: Bool = false,
        locatedAtFavorite: Bool = false
    ) {
        self.destinationName = destinationName
        self.metersToArrival = metersToArrival
        self.minutesToArrival = minutesToArrival
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
    }
}

public extension DestinationETASnapshot {
    /// Pure projection from a decoded JSON object — the unit-tested data adapter.
    static func from(json: [String: Any]) -> DestinationETASnapshot {
        DestinationETASnapshot(
            destinationName: json["destination_name"] as? String,
            metersToArrival: number(json["miles_to_arrival"]),
            minutesToArrival: number(json["minutes_to_arrival"]),
            locatedAtHome: bool(json["located_at_home"]),
            locatedAtWork: bool(json["located_at_work"]),
            locatedAtFavorite: bool(json["located_at_favorite"])
        )
    }

    /// Bridges a shared-core `JsonElement` (handed across the KMP boundary as the
    /// success payload of `Resource<JsonElement>`) into the value projection.
    ///
    /// The element renders itself as JSON text via Kotlin's `toString()` (exported
    /// as `description`), so it round-trips cleanly through `JSONSerialization`. A
    /// `null` snapshot (no active route on record) yields `nil`, which the holder
    /// maps to the empty state — matching the web `!snapshot` branch.
    static func fromSharedJSON(_ raw: Any) -> DestinationETASnapshot? {
        let trimmed = String(describing: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"), let data = trimmed.data(using: .utf8) else { return nil }
        guard
            let decoded = try? JSONSerialization.jsonObject(with: data),
            let object = decoded as? [String: Any]
        else { return nil }
        return from(json: object)
    }

    private static func number(_ value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let num = value as? NSNumber { return num.doubleValue }
        return nil
    }

    private static func bool(_ value: Any?) -> Bool {
        if let flag = value as? Bool { return flag }
        if let num = value as? NSNumber { return num.boolValue }
        return false
    }
}

// MARK: - Location classification

/// Where the vehicle currently is, mirroring the web `locationBadge` helper.
public enum DestinationETALocationKind: Equatable, Sendable {
    case home, work, favorite, other

    public init(snapshot: DestinationETASnapshot) {
        if snapshot.locatedAtHome {
            self = .home
        } else if snapshot.locatedAtWork {
            self = .work
        } else if snapshot.locatedAtFavorite {
            self = .favorite
        } else {
            self = .other
        }
    }

    /// Glyph mirroring the web emoji badge.
    public var symbol: String {
        switch self {
        case .home: "🏠"
        case .work: "🏢"
        case .favorite: "⭐"
        case .other: "📍"
        }
    }

    public var labelKey: LocalizedStringKey {
        LocalizedStringKey(labelKeyString)
    }

    /// Raw key string for VoiceOver labels and tests.
    public var labelKeyString: String {
        switch self {
        case .home: "translation.widget.destinationETA.home"
        case .work: "translation.widget.destinationETA.work"
        case .favorite: "translation.widget.destinationETA.favorite"
        case .other: "translation.widget.destinationETA.other"
        }
    }

    public var tone: TSTone {
        switch self {
        case .home: .success
        case .work: .neutral
        case .favorite: .neutral
        case .other: .warning
        }
    }
}

// MARK: - View state

/// Pure render model derived from a `DestinationETASnapshot`. No KMP dependency, so
/// every derivation (navigation flag, countdown text, progress, badge) is
/// unit-tested in isolation. Distance conversion stays in the view via `Units`.
public struct DestinationETAViewState: Equatable, Sendable {
    public let isNavigating: Bool
    public let destinationName: String
    public let metersToArrival: Double
    public let roundedMinutes: Int
    public let etaText: String
    public let progressFraction: Double
    public let location: DestinationETALocationKind

    public init(snapshot: DestinationETASnapshot) {
        let meters = snapshot.metersToArrival ?? 0
        let minutes = snapshot.minutesToArrival ?? 0
        let hasDestination = (snapshot.destinationName?.isEmpty == false)

        isNavigating = hasDestination
        destinationName = hasDestination ? (snapshot.destinationName ?? "—") : "—"
        metersToArrival = meters
        roundedMinutes = Int(minutes.rounded())

        let hours = Int((minutes / 60).rounded(.down))
        let mins = Int(minutes.truncatingRemainder(dividingBy: 60).rounded())
        etaText = hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"

        // Reproduces the web `progressPercent` curve exactly (value is meters).
        progressFraction = (hasDestination && meters > 0)
            ? min(max(1 - meters / (meters + 1), 0), 1)
            : 0
        location = DestinationETALocationKind(snapshot: snapshot)
    }
}

// MARK: - Freshness

/// Header freshness state, collapsing a failed-with-cache refresh into `stale`.
public enum DestinationETAFreshness: Equatable, Sendable {
    case live, stale, offline

    public init(state: LoadableState<DestinationETASnapshot>) {
        if state.error == .offline {
            self = .offline
        } else if state.isStale || (state.error != nil && state.value != nil) {
            self = .stale
        } else {
            self = .live
        }
    }
}
