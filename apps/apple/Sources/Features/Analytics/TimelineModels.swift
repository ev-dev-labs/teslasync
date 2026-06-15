import Foundation

// Value types for the Timeline surface (web `TimelinePage.tsx`, route `/timeline`).
// Durations are SI seconds exactly as the FSM/summary endpoints emit them; the view formats
// seconds → "Xh Ym" only at the render boundary. Field names mirror the snake_case wire so the
// production KMP-backed data source maps straight across.

// MARK: - Vehicle (web `useVehicles` / `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not measurements, so they round-trip verbatim.
public struct TimelineVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Transition record (web `TransitionRecord` → `GET /vehicle-states/timeline`)

/// A single FSM transition event — point-in-time, not a state with duration (web
/// `TransitionRecord`). The model derives the per-row "duration in to_state" from the next
/// transition's timestamp.
public struct TimelineTransitionRecord: Hashable, Sendable {
    public let timestamp: Date
    public let fromState: String
    public let toState: String
    public let triggerField: String?
    public let triggerValue: String?

    public init(
        timestamp: Date,
        fromState: String,
        toState: String,
        triggerField: String? = nil,
        triggerValue: String? = nil
    ) {
        self.timestamp = timestamp
        self.fromState = fromState
        self.toState = toState
        self.triggerField = triggerField
        self.triggerValue = triggerValue
    }
}

/// An indexed transition row for the table (web `TransitionRow`): adds the index used as the
/// stable key and the timestamp of the *next* transition so the table can compute "duration spent
/// in to_state". The newest row has no successor — its duration is computed from `now` so the user
/// sees how long the vehicle has been in the current state.
public struct TimelineTransitionRow: Identifiable, Hashable, Sendable {
    public let id: Int
    public let timestamp: Date
    public let fromState: String
    public let toState: String
    public let triggerField: String?
    public let triggerValue: String?
    public let nextTimestamp: Date?

    public init(
        id: Int,
        timestamp: Date,
        fromState: String,
        toState: String,
        triggerField: String?,
        triggerValue: String?,
        nextTimestamp: Date?
    ) {
        self.id = id
        self.timestamp = timestamp
        self.fromState = fromState
        self.toState = toState
        self.triggerField = triggerField
        self.triggerValue = triggerValue
        self.nextTimestamp = nextTimestamp
    }

    /// Duration spent in `toState` = (next transition or `now`) − this row's timestamp, in SI
    /// seconds. `nil` when the interval is non-positive (web renders an em dash) — web
    /// `end <= start`.
    public func durationSeconds(now: Date) -> Double? {
        let end = nextTimestamp ?? now
        let seconds = end.timeIntervalSince(timestamp)
        return seconds > 0 ? seconds : nil
    }
}

// MARK: - State summary (web `SummaryResponse` → `GET /vehicle-states/summary`)

/// Time spent in one FSM state over the window (web `ByStateRow`). `totalSeconds` is SI seconds.
public struct TimelineStateSummaryRow: Identifiable, Hashable, Sendable {
    public let state: String
    public let totalSeconds: Double
    public let percentage: Double
    public let transitionCount: Int

    public var id: String {
        state
    }

    public init(state: String, totalSeconds: Double, percentage: Double, transitionCount: Int) {
        self.state = state
        self.totalSeconds = totalSeconds
        self.percentage = percentage
        self.transitionCount = transitionCount
    }
}

/// The state-summary response (web `SummaryResponse`): the server-provided total plus the
/// per-state rows. `totalSeconds` drives the proportional state-distribution bar.
public struct TimelineSummary: Hashable, Sendable {
    public let totalSeconds: Double
    public let byState: [TimelineStateSummaryRow]

    public init(totalSeconds: Double, byState: [TimelineStateSummaryRow]) {
        self.totalSeconds = totalSeconds
        self.byState = byState
    }
}

// MARK: - State distribution segment (web proportional `STATE_COLORS` bar)

/// One segment of the proportional state-distribution bar (web GlassPanel5): a state's share of
/// total time as a width percentage, colored by a stable per-state palette index.
public struct TimelineDistributionSegment: Identifiable, Hashable, Sendable {
    public let state: String
    public let widthPercent: Double
    public let totalSeconds: Double
    public let percentage: Double
    public let colorIndex: Int

    public var id: String {
        state
    }

    public init(state: String, widthPercent: Double, totalSeconds: Double, percentage: Double, colorIndex: Int) {
        self.state = state
        self.widthPercent = widthPercent
        self.totalSeconds = totalSeconds
        self.percentage = percentage
        self.colorIndex = colorIndex
    }
}

// MARK: - Daily breakdown bucket (web `dailyBreakdown` — per-day stacked counts)

/// Transition counts for one calendar day (UTC), grouped into the four user-facing buckets the
/// stacked bar chart shows (web `dailyBreakdown`).
public struct TimelineDayBucket: Identifiable, Hashable, Sendable {
    public let day: String
    public let driving: Int
    public let charging: Int
    public let idle: Int
    public let sleeping: Int

    public var id: String {
        day
    }

    public init(day: String, driving: Int, charging: Int, idle: Int, sleeping: Int) {
        self.day = day
        self.driving = driving
        self.charging = charging
        self.idle = idle
        self.sleeping = sleeping
    }

    public func count(for category: TimelineStateCategory) -> Int {
        switch category {
        case .driving: driving
        case .charging: charging
        case .idle: idle
        case .sleeping: sleeping
        }
    }
}

// MARK: - State buckets + palette mapping (web `STATE_COLORS` / bucket if-else chain)

/// The four user-facing buckets the daily chart collapses the raw FSM states into (web legend).
public enum TimelineStateCategory: String, CaseIterable, Sendable {
    case driving
    case charging
    case idle
    case sleeping

    /// Maps a raw FSM `to_state` onto its display bucket, or `nil` when it is none of the known
    /// states (web's if/else chain leaves unknown states uncounted).
    public static func bucket(for toState: String) -> TimelineStateCategory? {
        switch toState {
        case "driving": .driving
        case "charging": .charging
        case "idle", "online", "parked": .idle
        case "sleeping", "asleep", "offline": .sleeping
        default: nil
        }
    }
}

/// Stable per-state chart-palette index (mirrors the web `STATE_COLORS` hues onto the design-token
/// categorical palette). Kept pure (Foundation-only) so the model can derive distribution colors
/// without importing SwiftUI.
public enum TimelineStateColor {
    /// The eight FSM states the distribution legend lists, in web `STATE_COLORS` order.
    public static let legendStates = [
        "driving", "charging", "idle", "sleeping",
        "online", "offline", "parked", "asleep"
    ]

    /// Palette index for a state (design-token `chartCategorical`): driving≈green, charging≈cyan,
    /// idle≈amber, sleeping/asleep≈gray, online≈blue, offline≈vermillion, parked≈purple.
    public static func colorIndex(for state: String) -> Int {
        switch state {
        case "driving": 2
        case "charging": 4
        case "idle": 1
        case "sleeping": 7
        case "online": 0
        case "offline": 5
        case "parked": 6
        case "asleep": 7
        default: 7
        }
    }

    /// Palette index for a daily-chart bucket (same hues as the matching raw state).
    public static func colorIndex(for category: TimelineStateCategory) -> Int {
        colorIndex(for: category.rawValue)
    }
}
