//
//  FSMHealthPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  Pure (Foundation-only) projection core for the FSM-health surface — the faithful
//  port of features/system/components/FSMHealthPanel.tsx. The web component receives a
//  `transitions: FSMTransition[]` log (parent-owned) and derives up to three health
//  alerts inside one `useMemo`:
//
//    • flap     — per FSM name, more than five transitions inside any rolling one-minute
//                 window flags every transition in that window; the warning alert is
//                 pushed at most once with the flagged count at that moment.
//    • stuck    — the latest transition of each session FSM instance
//                 (`drive_session` / `charge_session`, keyed by `fsm_name:vehicle_id`)
//                 sitting in `pending` / `active` for more than four hours.
//    • recovery — the number of transitions whose target state is `recovered`.
//
//  When no alert fires the web renders a single "all FSMs healthy" row; otherwise it
//  renders the alert grid. Everything here is dependency-free so it unit-tests without a
//  bundle or a view. `now` is injected for determinism (the web captures `Date.now()` at
//  compute time).
//
//  Web parity note (the flap alert count): the web pushes the flap alert inside the
//  per-FSM loop, guarded by "no flap alert yet", reading `flapped.size` at that instant.
//  When several FSMs flap, the displayed count therefore reflects only the windows seen
//  up to (and including) the first flapping FSM, while `flapIds` (the exported
//  `computeFlapIds`) returns the full set. That push-once semantics is reproduced here
//  verbatim rather than "corrected", so native and web agree byte-for-byte.
//

import Foundation

// MARK: - Input (web `FSMTransition` subset)

/// One FSM transition as delivered by the bound source — the fields the web
/// `FSMHealthPanel` reads from each `FSMTransition`: the `id` (flagged-flap identity),
/// the `vehicleId` (the stuck-instance key), the `ts` timestamp (flap windows + stuck
/// age), the `fsmName` (grouping), and the `toState` (stuck / recovery classification).
/// Kept as a tiny value type so the projection stays transport-free and testable.
public struct FSMHealthTransitionInput: Sendable, Equatable, Identifiable {
    /// The transition row id (web `tr.id`) — the flap-flagged identity.
    public var id: Int
    /// The owning vehicle (web `tr.vehicle_id`) — part of the stuck-instance key.
    public var vehicleId: Int
    /// The transition instant (web `new Date(tr.ts)`).
    public var timestamp: Date
    /// The owning FSM's name (web `tr.fsm_name`) — the grouping key.
    public var fsmName: String
    /// The target state (web `tr.to_state`) — drives stuck / recovery classification.
    public var toState: String

    public init(id: Int, vehicleId: Int, timestamp: Date, fsmName: String, toState: String) {
        self.id = id
        self.vehicleId = vehicleId
        self.timestamp = timestamp
        self.fsmName = fsmName
        self.toState = toState
    }
}

// MARK: - Derived alert

/// The kind of health alert — the web `HealthAlert.type` union. Drives the card icon and
/// the title / message keys.
public enum FSMHealthAlertKind: String, Sendable, Equatable, CaseIterable {
    case flap
    case stuck
    case recovery
}

/// The alert severity — the web `HealthAlert.severity` union. Drives the card tone
/// (warning ⇒ amber, info ⇒ blue).
public enum FSMHealthAlertSeverity: String, Sendable, Equatable {
    case warning
    case info
}

/// One derived health alert — the native mirror of the web `HealthAlert`. The localized
/// message string is built at the display boundary (`FSMHealthMessages`) from the kind +
/// `count`, so this value type stays pure / bundle-free.
public struct FSMHealthAlert: Sendable, Equatable, Identifiable {
    public var kind: FSMHealthAlertKind
    public var severity: FSMHealthAlertSeverity
    public var count: Int

    public var id: String {
        kind.rawValue
    }

    public init(kind: FSMHealthAlertKind, severity: FSMHealthAlertSeverity, count: Int) {
        self.kind = kind
        self.severity = severity
        self.count = count
    }
}

// MARK: - Render phase (web all-clear / alert split, plus the load envelope)

/// What the surface should render. The web source distinguishes only the all-clear row
/// (`alerts.length === 0`) from the alert grid; the loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring how the FSM debugger
/// page owns the transition-query lifecycle. `.healthy` is the web all-clear row — the
/// friendly "empty" state, never a blank box.
public enum FSMHealthPhase: Sendable, Equatable {
    case loading
    case error(String)
    case healthy
    case alerts([FSMHealthAlert])
}

/// The bound source's load status for the transition query (web loading / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum FSMHealthLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so
/// cached health is clearly labeled while reconnecting / offline.
public enum FSMHealthConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the raw transition log to the derived health
/// alerts + the render phase — a faithful port of the web `FSMHealthPanel` `useMemo` body
/// (and the exported `computeFlapIds`).
public enum FSMHealthProjector {
    /// The flap window (web `60_000` ms) — transitions within this span of a start row
    /// count toward its same-FSM burst.
    public static let flapWindowMillis: Int64 = 60000
    /// The flap threshold (web `count > 5`) — strictly more than five same-FSM
    /// transitions inside one window flags the burst.
    public static let flapThreshold = 5
    /// The stuck age (web `4 * 60 * 60 * 1000` ms).
    public static let stuckWindowMillis: Int64 = 4 * 60 * 60 * 1000
    /// The session FSM names whose latest state is checked for stuck (web `sessionTypes`).
    public static let sessionTypes: Set<String> = ["drive_session", "charge_session"]
    /// The states considered stuck when held too long (web `stuckStates`).
    public static let stuckStates: Set<String> = ["pending", "active"]
    /// The target state counted as a pod recovery (web `to_state === 'recovered'`).
    public static let recoveredState = "recovered"

    /// Epoch milliseconds for a date, truncated toward zero — the integer-ms parity of JS
    /// `Date.getTime()` (which returns whole milliseconds).
    public static func millis(from date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.towardZero))
    }

    /// The flagged-flap transition ids — the verbatim port of the web `computeFlapIds`
    /// (and the in-component flap pass): per FSM name, sorted by time, every window of
    /// more than five transitions inside one minute flags each of its rows.
    public static func flapIds(_ transitions: [FSMHealthTransitionInput]) -> Set<Int> {
        var flagged = Set<Int>()
        for (_, list) in groupedByName(transitions) {
            accumulateFlapped(in: list, into: &flagged)
        }
        return flagged
    }

    /// The count of session FSM instances stuck in `pending` / `active` beyond the
    /// four-hour window — web `stuck` detection. Each instance is keyed by
    /// `fsm_name:vehicle_id` and only its latest transition is judged.
    public static func stuckCount(_ transitions: [FSMHealthTransitionInput], now: Date) -> Int {
        var latest: [String: FSMHealthTransitionInput] = [:]
        for transition in transitions where sessionTypes.contains(transition.fsmName) {
            let key = "\(transition.fsmName):\(transition.vehicleId)"
            if let existing = latest[key] {
                if transition.timestamp > existing.timestamp {
                    latest[key] = transition
                }
            } else {
                latest[key] = transition
            }
        }
        let nowMs = millis(from: now)
        return latest.values.reduce(0) { running, transition in
            let stuck = stuckStates.contains(transition.toState)
                && (nowMs - millis(from: transition.timestamp)) > stuckWindowMillis
            return running + (stuck ? 1 : 0)
        }
    }

    /// The number of transitions whose target state is `recovered` — web `recovery` count.
    public static func recoveryCount(_ transitions: [FSMHealthTransitionInput]) -> Int {
        transitions.reduce(0) { $0 + ($1.toState == recoveredState ? 1 : 0) }
    }

    /// The derived health alerts in web order (flap, then stuck, then recovery) — the
    /// faithful port of the `useMemo` body, including the flap push-once-with-running-count
    /// semantics described in the file header.
    public static func alerts(_ transitions: [FSMHealthTransitionInput], now: Date) -> [FSMHealthAlert] {
        var result: [FSMHealthAlert] = []
        var flagged = Set<Int>()

        for (_, list) in groupedByName(transitions) {
            accumulateFlapped(in: list, into: &flagged)
            if !flagged.isEmpty, !result.contains(where: { $0.kind == .flap }) {
                result.append(FSMHealthAlert(kind: .flap, severity: .warning, count: flagged.count))
            }
        }

        let stuck = stuckCount(transitions, now: now)
        if stuck > 0 {
            result.append(FSMHealthAlert(kind: .stuck, severity: .warning, count: stuck))
        }

        let recovery = recoveryCount(transitions)
        if recovery > 0 {
            result.append(FSMHealthAlert(kind: .recovery, severity: .info, count: recovery))
        }
        return result
    }

    /// Resolves the render phase from the bound load status + the derived alerts (web
    /// `alerts.length === 0 ? <all-clear> : <grid>`).
    public static func resolvePhase(_ status: FSMHealthLoadStatus, alerts: [FSMHealthAlert]) -> FSMHealthPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            alerts.isEmpty ? .healthy : .alerts(alerts)
        }
    }

    // MARK: - Private flap helpers (web `byType` grouping + the windowed pass)

    /// Groups transitions by FSM name, preserving first-seen order so the flap push-once
    /// alert reads the same running count as the web `Map` iteration order.
    private static func groupedByName(
        _ transitions: [FSMHealthTransitionInput]
    ) -> [(name: String, list: [FSMHealthTransitionInput])] {
        var order: [String] = []
        var byName: [String: [FSMHealthTransitionInput]] = [:]
        for transition in transitions {
            if byName[transition.fsmName] == nil {
                order.append(transition.fsmName)
            }
            byName[transition.fsmName, default: []].append(transition)
        }
        return order.map { (name: $0, list: byName[$0] ?? []) }
    }

    /// The windowed flap pass for one FSM's transitions — sorts by time, then for each
    /// start row flags every row inside the following one-minute window when that window
    /// holds more than `flapThreshold` rows (web inner double loop).
    private static func accumulateFlapped(
        in list: [FSMHealthTransitionInput],
        into flagged: inout Set<Int>
    ) {
        let sorted = list.sorted { millis(from: $0.timestamp) < millis(from: $1.timestamp) }
        for start in sorted.indices {
            let windowEnd = millis(from: sorted[start].timestamp) + flapWindowMillis
            var count = 0
            for index in start ..< sorted.count {
                if millis(from: sorted[index].timestamp) <= windowEnd {
                    count += 1
                } else {
                    break
                }
            }
            guard count > flapThreshold else { continue }
            for index in start ..< sorted.count {
                if millis(from: sorted[index].timestamp) <= windowEnd {
                    flagged.insert(sorted[index].id)
                } else {
                    break
                }
            }
        }
    }
}
