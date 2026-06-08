//
//  FSMStateDiagram.Projection.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The pure projection from the panel inputs to the view-ready state — the native port
//  of the web component's `useMemo` (state/edge counts + latest state) and its render
//  branches, widened with the P4 leaf contract (loading / empty / error / data). No
//  SwiftUI, no networking: a deterministic function of the input snapshot, unit-tested
//  across every branch. The orthogonal connection axis (live / stale / offline) lives on
//  the model, not here.
//

import Foundation

// MARK: - View-ready node + edge

/// One state node in the diagram (web node box): its name, resolved colour, the
/// observed transition count, whether it is the latest state, and — for all but the
/// last node — the count on the arrow to the next state (web `edgeCounts.get(a->b)`,
/// shown only when present).
public struct FSMDiagramNode: Sendable, Equatable, Identifiable {
    public let state: String
    public let color: FSMStateColor
    public let count: Int
    public let isActive: Bool
    public let isCurrent: Bool
    public let hasArrow: Bool
    public let arrowCount: Int?

    public var id: String {
        state
    }

    public init(
        state: String,
        color: FSMStateColor,
        count: Int,
        isActive: Bool,
        isCurrent: Bool,
        hasArrow: Bool,
        arrowCount: Int?
    ) {
        self.state = state
        self.color = color
        self.count = count
        self.isActive = isActive
        self.isCurrent = isCurrent
        self.hasArrow = hasArrow
        self.arrowCount = arrowCount
    }
}

/// One edge-summary chip (web bottom summary): the from/to states, their resolved
/// colours, and the observed count.
public struct FSMDiagramEdge: Sendable, Equatable, Identifiable {
    public let from: String
    public let to: String
    public let count: Int
    public let fromColor: FSMStateColor
    public let toColor: FSMStateColor

    public var id: String {
        "\(from)->\(to)"
    }

    public init(from: String, to: String, count: Int, fromColor: FSMStateColor, toColor: FSMStateColor) {
        self.from = from
        self.to = to
        self.count = count
        self.fromColor = fromColor
        self.toColor = toColor
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and the nodes / edge
/// summary / latest state are pre-computed so the view is a pure function of this value.
public struct FSMStateDiagramResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let nodes: [FSMDiagramNode]
    public let edgeSummary: [FSMDiagramEdge]
    public let latestState: String

    public init(
        phase: Phase,
        nodes: [FSMDiagramNode] = [],
        edgeSummary: [FSMDiagramEdge] = [],
        latestState: String = ""
    ) {
        self.phase = phase
        self.nodes = nodes
        self.edgeSummary = edgeSummary
        self.latestState = latestState
    }
}

// MARK: - Memoised counts (web useMemo)

/// The native port of the web `useMemo` result — the per-state and per-edge counts plus
/// the latest (most recent `to_state`) — over the fsmType-filtered transitions.
public struct FSMDiagramCounts: Sendable, Equatable {
    public let stateCounts: [String: Int]
    public let edgeCounts: [String: Int]
    public let latestState: String
}

// MARK: - Projection

/// Pure projection: input snapshot → resolved view-state. Mirrors the web `useMemo`
/// (counts + latest) and the render branches, plus the P4 leaf loading/error states.
public enum FSMStateDiagramProjection {
    private static let isoFractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let isoPlain = Date.ISO8601FormatStyle(includingFractionalSeconds: false)

    /// Web `new Date(tr.ts).getTime()` — parses an ISO-8601 timestamp (with or without
    /// fractional seconds) to seconds since epoch; `nil` for an unparseable string (which
    /// the latest-state scan skips, exactly as `NaN > latestTime` is always false).
    static func parseTimestamp(_ value: String) -> TimeInterval? {
        if let date = try? isoFractional.parse(value) { return date.timeIntervalSince1970 }
        if let date = try? isoPlain.parse(value) { return date.timeIntervalSince1970 }
        return nil
    }

    /// Web `useMemo`: accumulate state + edge counts and track the latest `to_state`,
    /// filtering to the FSM type (unless `all`, exactly as the source does).
    public static func counts(fsmType: String, transitions: [FSMTransition]) -> FSMDiagramCounts {
        var stateCounts: [String: Int] = [:]
        var edgeCounts: [String: Int] = [:]
        var latest = ""
        var latestTime: TimeInterval = 0

        for transition in transitions {
            if fsmType != "all", transition.fsmName != fsmType { continue }
            stateCounts[transition.toState, default: 0] += 1
            stateCounts[transition.fromState, default: 0] += 1
            let key = "\(transition.fromState)->\(transition.toState)"
            edgeCounts[key, default: 0] += 1
            if let time = parseTimestamp(transition.ts), time > latestTime {
                latestTime = time
                latest = transition.toState
            }
        }
        return FSMDiagramCounts(stateCounts: stateCounts, edgeCounts: edgeCounts, latestState: latest)
    }

    /// The full resolve: error → loading → empty (unknown FSM) → data.
    public static func resolve(_ input: FSMStateDiagramInput) -> FSMStateDiagramResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return FSMStateDiagramResolved(phase: .error(message))
        }
        if input.isLoading {
            return FSMStateDiagramResolved(phase: .loading)
        }
        // Web guard `if (!states || !edges)` — an unknown FSM type renders the empty surface.
        guard let states = FSMRegistry.states(for: input.fsmType),
              FSMRegistry.edges(for: input.fsmType) != nil
        else {
            return FSMStateDiagramResolved(phase: .empty)
        }
        let counts = counts(fsmType: input.fsmType, transitions: input.transitions)
        return FSMStateDiagramResolved(
            phase: .data,
            nodes: nodes(fsmType: input.fsmType, states: states, counts: counts),
            edgeSummary: edgeSummary(fsmType: input.fsmType, edgeCounts: counts.edgeCounts),
            latestState: counts.latestState
        )
    }

    /// Builds the ordered node row (web `states.map`), attaching the arrow + arrow count
    /// to all but the last node.
    static func nodes(fsmType: String, states: [String], counts: FSMDiagramCounts) -> [FSMDiagramNode] {
        states.enumerated().map { index, state in
            let isLast = index == states.count - 1
            var arrowCount: Int?
            if !isLast {
                arrowCount = counts.edgeCounts["\(state)->\(states[index + 1])"]
            }
            let observed = counts.stateCounts[state] ?? 0
            return FSMDiagramNode(
                state: state,
                color: FSMRegistry.color(for: fsmType, state: state),
                count: observed,
                isActive: observed > 0,
                isCurrent: !counts.latestState.isEmpty && state == counts.latestState,
                hasArrow: !isLast,
                arrowCount: arrowCount
            )
        }
    }

    /// Builds the edge-summary chips (web: sort by count desc, take 10). Ties break on the
    /// edge key ascending so the projection is deterministic for tests/snapshots.
    static func edgeSummary(fsmType: String, edgeCounts: [String: Int]) -> [FSMDiagramEdge] {
        edgeCounts
            .sorted { lhs, rhs in lhs.value != rhs.value ? lhs.value > rhs.value : lhs.key < rhs.key }
            .prefix(10)
            .compactMap { key, count in
                let parts = key.components(separatedBy: "->")
                guard parts.count == 2 else { return nil }
                return FSMDiagramEdge(
                    from: parts[0],
                    to: parts[1],
                    count: count,
                    fromColor: FSMRegistry.color(for: fsmType, state: parts[0]),
                    toColor: FSMRegistry.color(for: fsmType, state: parts[1])
                )
            }
    }
}
