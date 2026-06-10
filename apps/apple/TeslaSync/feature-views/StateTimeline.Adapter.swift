//
//  StateTimeline.Adapter.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  Pure (Foundation-only) projection core for the FSM debugger's horizontal
//  mini-timeline — the faithful port of
//  features/system/components/state-machine/StateTimeline.tsx. The web component is
//  purely presentational: the page hands it a PRE-WINDOWED `transitions` array (the
//  windowing lives in `windowTransitions.ts`) plus the `fsmType`, the `windowMinutes`,
//  and an optional `anchor`; the component sorts the transitions chronologically and
//  places each one on the rail by its `created_at`, colored by its DESTINATION state
//  via the shared FSM theme (`getStateColor`). This adapter reproduces that `useMemo`
//  body verbatim so it unit-tests without a bundle or a rendered view.
//
//  Web parity notes (the `useMemo` body, ported 1:1):
//    • endTs   = (anchor ?? now).getTime()
//    • startTs = endTs − windowMinutes·60_000
//    • span    = (endTs − startTs) || 1          (the `|| 1` guards windowMinutes == 0)
//    • sorted  = [...transitions].sort(by ts ascending)  (a STABLE sort — ties keep
//                input order, matching JS Array.prototype.sort since ES2019)
//    • leftPct = ((ts − startTs) / span) · 100   (NOT clamped — the caller pre-windows)
//    • color   = getStateColor(fsmType, to_state) → native `FSMRegistry.color(for:state:)`
//  The DESTINATION (`to_state`) drives the dot hue, exactly like the web `tr.to_state`.
//

import Foundation

// MARK: - Input (web `FSMTransition` subset the timeline reads)

/// One FSM transition as delivered by the bound source — the four fields the web
/// `StateTimeline` reads from each `FSMTransition`: the stable `id` (selection key),
/// the `ts` instant (placed on the rail), and the `from_state` / `to_state` pair
/// (the tooltip + aria label, with the destination driving the dot hue). Kept as a
/// tiny transport-free value type so the projection stays testable.
public struct StateTransitionInput: Sendable, Equatable, Identifiable {
    /// Stable transition id (web `tr.id`) — the timeline selection key.
    public var id: Int
    /// The transition instant (web `new Date(tr.ts)`), positioned on the rail.
    public var timestamp: Date
    /// The origin state (web `tr.from_state`) — the tooltip / aria left side.
    public var fromState: String
    /// The destination state (web `tr.to_state`) — the dot hue + tooltip / aria right.
    public var toState: String

    public init(id: Int, timestamp: Date, fromState: String, toState: String) {
        self.id = id
        self.timestamp = timestamp
        self.fromState = fromState
        self.toState = toState
    }
}

// MARK: - Projected tick (one placed dot)

/// One resolved tick on the rail — the native parity of the web `{ tr, leftPct }`
/// entry plus the resolved destination-state hue. `leftPercent` is the 0…100 rail
/// position (web `leftPct`, intentionally NOT clamped — the caller pre-windows, so an
/// out-of-window tick simply lands off the rail, exactly as the web does).
public struct StateTimelineTick: Sendable, Equatable, Identifiable {
    public var id: Int
    public var fromState: String
    public var toState: String
    public var timestamp: Date
    /// The horizontal rail position as a percentage (web `leftPct`).
    public var leftPercent: Double
    /// The destination-state semantic hue (web `getStateColor(fsmType, to_state).dot`).
    public var tone: FSMStateColor

    public init(
        id: Int,
        fromState: String,
        toState: String,
        timestamp: Date,
        leftPercent: Double,
        tone: FSMStateColor
    ) {
        self.id = id
        self.fromState = fromState
        self.toState = toState
        self.timestamp = timestamp
        self.leftPercent = leftPercent
        self.tone = tone
    }
}

/// The full projection: the placed ticks plus the resolved window bounds the header
/// renders (web `start` / `end`) and the window length (web `windowMinutes`).
public struct StateTimelineProjection: Sendable, Equatable {
    public var ticks: [StateTimelineTick]
    public var windowStart: Date
    public var windowEnd: Date
    public var windowMinutes: Int

    public init(ticks: [StateTimelineTick], windowStart: Date, windowEnd: Date, windowMinutes: Int) {
        self.ticks = ticks
        self.windowStart = windowStart
        self.windowEnd = windowEnd
        self.windowMinutes = windowMinutes
    }
}

// MARK: - Render phase (web ticks/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes content vs empty
/// (`ticks.length === 0` swaps the rail for the actionable empty hint); the loading /
/// error envelope around it (prompt P4 states) is supplied by the bound source,
/// mirroring how the FSM debugger page owns the transition-query lifecycle.
public enum StateTimelinePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the transition query (web loading / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum StateTimelineLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached timeline is clearly labeled while reconnecting / offline.
public enum StateTimelineConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the pre-windowed transitions + window to the
/// placed ticks and resolved bounds — a faithful port of the web `StateTimeline`
/// `useMemo` body. `anchor` is injected for determinism (web `anchor ?? new Date()`).
public enum StateTimelineProjector {
    /// Epoch milliseconds for a date, truncated toward zero — the integer-ms parity of
    /// JS `Date.getTime()` (which returns whole milliseconds).
    public static func millis(from date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.towardZero))
    }

    /// Projects the pre-windowed transitions onto the rail — the verbatim port of the
    /// web `useMemo`. The sort is STABLE (ties keep input order) to match JS
    /// `Array.prototype.sort`; `leftPercent` is left unclamped (the caller windows).
    public static func project(
        transitions: [StateTransitionInput],
        fsmType: String,
        windowMinutes: Int,
        anchor: Date
    ) -> StateTimelineProjection {
        let endMs = millis(from: anchor)
        let startMs = endMs - Int64(windowMinutes) * 60000
        // web `const span = endTs - startTs || 1` — guards a zero-length window.
        let span = max(endMs - startMs, 1)

        // web `[...transitions].sort((a, b) => a.ts - b.ts)` — a stable ascending sort.
        // Swift's `sorted(by:)` is not guaranteed stable, so tie-break on the original
        // index to preserve input order for equal timestamps (JS sort is stable).
        let ordered = transitions.enumerated().sorted { lhs, rhs in
            let left = millis(from: lhs.element.timestamp)
            let right = millis(from: rhs.element.timestamp)
            if left != right { return left < right }
            return lhs.offset < rhs.offset
        }

        let ticks = ordered.map { _, transition -> StateTimelineTick in
            let tsMs = millis(from: transition.timestamp)
            let leftPercent = (Double(tsMs - startMs) / Double(span)) * 100
            return StateTimelineTick(
                id: transition.id,
                fromState: transition.fromState,
                toState: transition.toState,
                timestamp: transition.timestamp,
                leftPercent: leftPercent,
                tone: FSMRegistry.color(for: fsmType, state: transition.toState)
            )
        }

        return StateTimelineProjection(
            ticks: ticks,
            windowStart: Date(timeIntervalSince1970: Double(startMs) / 1000),
            windowEnd: Date(timeIntervalSince1970: Double(endMs) / 1000),
            windowMinutes: windowMinutes
        )
    }

    /// Whether the rail should render (web `ticks.length === 0` ⇒ the empty hint).
    public static func hasTicks(_ ticks: [StateTimelineTick]) -> Bool {
        !ticks.isEmpty
    }

    /// Resolves the render phase from the bound load status + whether any ticks landed
    /// (web `ticks.length === 0 ? <empty> : <rail>`). A `loaded` status with no ticks
    /// is `.empty` (never a blank box).
    public static func resolvePhase(_ status: StateTimelineLoadStatus, hasTicks: Bool) -> StateTimelinePhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasTicks ? .content : .empty
        }
    }

    /// The tick matching a selected id (web `tr.id === selectedId`) — the highlighted
    /// dot, or `nil` when nothing is selected / the id is no longer present.
    public static func tick(withID id: Int?, in ticks: [StateTimelineTick]) -> StateTimelineTick? {
        guard let id else { return nil }
        return ticks.first { $0.id == id }
    }
}
