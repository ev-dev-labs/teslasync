//
//  FSMDistributionWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/FSMDistributionWidget.tsx: the per-state duration
//  input (web `FSMStats.stats` entry), the state-transition log row (web
//  `FSMTransition`), the vehicle identity, the color-coded state bucket, the
//  donut segment, the projected transition row, and the merged projection the
//  view renders. Pure Foundation — no SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of the web FSMStats / FSMTransition fields read here)

/// One `state → time-in-state` entry from `GET /fsm/stats?vehicle_id=…` (web
/// `FSMStats.stats`, a `Record<string, number>`). `milliseconds` is the
/// accumulated time the vehicle FSM spent in `state`, exactly as the web
/// `fmtDuration(ms)` consumes it. Carried as an *ordered* array (not a
/// dictionary) so the donut's tie-break ordering is deterministic across
/// platforms — a Swift `Dictionary` would iterate in a random order, whereas the
/// web reads the JSON object's stable key order.
public struct FSMStateDuration: Sendable, Equatable {
    public var state: String
    public var milliseconds: Double

    public init(state: String, milliseconds: Double) {
        self.state = state
        self.milliseconds = milliseconds
    }
}

/// One row from `GET /fsm/transitions?vehicle_id=…&fsm_name=vehicle&…` — the Swift
/// port of the subset of the web `FSMTransition` this widget reads (`id`,
/// `from_state`, `to_state`, `ts`). `timestamp` is the parsed `ts` instant (nil
/// when the backend omitted it, which the web guards with `tr.ts ?? ''` →
/// `TimeStamp` renders the universal "—").
public struct FSMStateTransitionDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var fromState: String
    public var toState: String
    public var timestamp: Date?

    public init(id: Int, fromState: String, toState: String, timestamp: Date? = nil) {
        self.id = id
        self.fromState = fromState
        self.toState = toState
        self.timestamp = timestamp
    }
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the queries, plus a name for
/// optional accessibility).
public struct FSMVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        return name
    }
}

// MARK: - State bucket (port of the web `STATE_COLORS` / `stateColor` lookup)

/// The color bucket a state is mapped into — the Swift port of the web
/// `STATE_COLORS` keys (`driving | charging | asleep | idle | offline`) plus the
/// `other` catch-all the web `stateColor` falls back to (its `?? '#6b7280'`
/// default gray). The raw value matches the web internal key so the bucket maps
/// to the same design-token color across platforms; the *label* is resolved
/// separately by state name so arbitrary FSM states still read correctly.
public enum FSMStateKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case driving
    case charging
    case asleep
    case idle
    case offline
    case other

    public var id: String {
        rawValue
    }
}

// MARK: - Projection (port of the web `DonutSegment` + transition feed rows)

/// One donut segment — the Swift port of the web `DonutSegment`: the raw state
/// key (drives the label + color), the accumulated milliseconds (the slice
/// angle, web `Pie dataKey="value"`), the share of the whole (web `pct`), and the
/// resolved color bucket.
public struct FSMDonutSegment: Sendable, Equatable, Identifiable {
    public var state: String
    public var milliseconds: Double
    public var percent: Double
    public var kind: FSMStateKind

    public init(state: String, milliseconds: Double, percent: Double, kind: FSMStateKind) {
        self.state = state
        self.milliseconds = milliseconds
        self.percent = percent
        self.kind = kind
    }

    public var id: String {
        state
    }
}

/// One projected transition-feed row — the Swift port of the web `TransitionRow`
/// inputs: the from/to state keys (already coalesced to "—" when missing, web
/// `?? '—'`) and the timestamp the relative-time label renders.
public struct FSMTransitionItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var fromState: String
    public var toState: String
    public var timestamp: Date?

    public init(id: Int, fromState: String, toState: String, timestamp: Date? = nil) {
        self.id = id
        self.fromState = fromState
        self.toState = toState
        self.timestamp = timestamp
    }
}

/// The merged projection the view switches over — the donut segments (filtered to
/// positive durations and sorted largest-first, web `buildDonutData`), the recent
/// transition rows (newest-first, as the API returns them), and whether there is
/// any state to chart (web `hasData = segments.length > 0`).
public struct FSMDistributionProjection: Sendable, Equatable {
    public var segments: [FSMDonutSegment]
    public var transitions: [FSMTransitionItem]
    public var hasData: Bool

    public init(segments: [FSMDonutSegment], transitions: [FSMTransitionItem], hasData: Bool) {
        self.segments = segments
        self.transitions = transitions
        self.hasData = hasData
    }

    /// The largest segment — the web compact view's "current state"
    /// (`segments[0]`, the list being sorted largest-first).
    public var dominant: FSMDonutSegment? {
        segments.first
    }

    /// Empty projection (no state data resolved yet).
    public static let empty = FSMDistributionProjection(segments: [], transitions: [], hasData: false)
}
