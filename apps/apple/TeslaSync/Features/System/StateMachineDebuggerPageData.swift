//
//  StateMachineDebuggerPageData.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Wire Types & Sample
//
//  Native SwiftUI parity of `web/src/features/system/pages/StateMachineDebuggerPage.tsx`
//  (route `/state-debugger`): the multi-FSM transition debugger. This file owns the wire value
//  types the four data sources decode into (the native peers of the web `FSMTransition` /
//  `VehicleState` / `FSMStats` / `SignalSnapshotResponse` shapes), plus the representative
//  sample source the page/preview use until the shared KMP store is injected (ADR-004). Field
//  names mirror the wire so the production KMP binding maps straight across; timestamps are
//  unit-agnostic control-plane values so no SI conversion (P1/S5) applies on this surface.
//

import Foundation

// MARK: - Vehicle (web `useSelectedVehicle().vehicles[]`)

/// A vehicle the picker can select. Only id + display name + VIN are needed to populate the
/// selector and key the per-vehicle FSM queries.
public struct DebuggerVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String?
    public let vin: String?

    public init(id: Int64, displayName: String?, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web ``v.display_name || v.vin`` with an id fallback.
    public var label: String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let vin, !vin.isEmpty { return vin }
        return "Vehicle \(id)"
    }
}

// MARK: - Current vehicle live state (web `GET /vehicles/{id}/state` → `VehicleState`)

/// The FSM-resolved live state of the vehicle (web `stateResponse.state`). Only the fields the
/// hero + summary card render are modeled; `mode` is derived from charging / speed / state.
public struct VehicleLiveState: Equatable, Sendable {
    public let state: String
    public let since: Date?
    public let isCharging: Bool
    public let speed: Double

    public init(state: String, since: Date?, isCharging: Bool, speed: Double) {
        self.state = state
        self.since = since
        self.isCharging = isCharging
        self.speed = speed
    }
}

// MARK: - FSM stats (web `GET /fsm/stats` → `FSMStats`)

/// One active sub-FSM (web `ActiveSubFSM`): a live drive or charge lifecycle.
public struct ActiveSubFSM: Identifiable, Hashable, Sendable {
    public let id: String
    public let type: String
    public let state: String
    public let startTime: Date?

    public init(id: String, type: String, state: String, startTime: Date?) {
        self.id = id
        self.type = type
        self.state = state
        self.startTime = startTime
    }
}

/// The FSM stats roll-up (web `statsData`): enable flag, per-state counts, and active subs.
public struct FSMStatsData: Equatable, Sendable {
    public let enabled: Bool
    public let counts: [String: Int]
    public let activeSubs: [ActiveSubFSM]

    public init(enabled: Bool, counts: [String: Int], activeSubs: [ActiveSubFSM]) {
        self.enabled = enabled
        self.counts = counts
        self.activeSubs = activeSubs
    }

    public static let empty = FSMStatsData(enabled: false, counts: [:], activeSubs: [])
}

// MARK: - Transitions (web `GET /fsm/transitions` → `FSMTransitionResponse`)

/// One ordered detail key/value of a transition (web `transition.details` entries).
public struct FSMTransitionDetail: Identifiable, Hashable, Sendable {
    public let id: String
    public let value: String

    public init(key: String, value: String) {
        id = key
        self.value = value
    }

    public var key: String { id }
}

/// One FSM transition row (web `FSMTransition`). `guardName` + `durationInStateMs` are lifted
/// out of `details` because the detail panel surfaces them as their own fields.
public struct FSMDebuggerTransition: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let ts: Date
    public let fsmName: String
    public let fromState: String
    public let toState: String
    public let trigger: String
    public let guardName: String?
    public let durationInStateMs: Double?
    public let details: [FSMTransitionDetail]

    public init(
        id: Int64,
        vehicleID: Int64,
        ts: Date,
        fsmName: String,
        fromState: String,
        toState: String,
        trigger: String,
        guardName: String? = nil,
        durationInStateMs: Double? = nil,
        details: [FSMTransitionDetail] = []
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.ts = ts
        self.fsmName = fsmName
        self.fromState = fromState
        self.toState = toState
        self.trigger = trigger
        self.guardName = guardName
        self.durationInStateMs = durationInStateMs
        self.details = details
    }

    /// Web `tr.fsm_name?.replace('_', ' ') ?? 'vehicle'`.
    public var displayFSMName: String {
        let name = fsmName.isEmpty ? "vehicle" : fsmName
        return name.replacingOccurrences(of: "_", with: " ")
    }
}

/// A page of transitions plus the server total (web `FSMTransitionResponse` `data` + `total`).
public struct FSMTransitionPage: Sendable {
    public let rows: [FSMDebuggerTransition]
    public let total: Int

    public init(rows: [FSMDebuggerTransition], total: Int) {
        self.rows = rows
        self.total = total
    }
}

// MARK: - Snapshot (web `GET /signals/{id}/snapshot` → `SignalSnapshotResponse`)

/// One signal name/value of a point-in-time snapshot (web `selectedSnapshot` row).
public struct SignalSnapshotRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let value: String

    public init(name: String, value: String) {
        id = name
        self.value = value
    }

    public var name: String { id }
}

// MARK: - Derived summary row (web `StatSummaryRow`)

/// A per-`to_state` roll-up for the Transition Counts table (web `summaryRows`).
public struct StateSummaryRow: Identifiable, Hashable, Sendable {
    public let toState: String
    public let count: Int
    public let avgIntervalSec: Double

    public init(toState: String, count: Int, avgIntervalSec: Double) {
        self.toState = toState
        self.count = count
        self.avgIntervalSec = avgIntervalSec
    }

    public var id: String { toState }
}

// MARK: - One slice of the distribution (web `pieData` entry)

/// A (name, value) pair for the state-distribution donut (web `pieData`).
public struct StateDistributionSlice: Identifiable, Hashable, Sendable {
    public let id: String
    public let value: Int
    public let colorIndex: Int

    public init(name: String, value: Int, colorIndex: Int) {
        id = name
        self.value = value
        self.colorIndex = colorIndex
    }

    public var name: String { id }
}

// MARK: - One node of the state-diagram overview (web `FSMStateDiagram`)

/// A state node with its inbound/outbound transition counts (native adaptation of the web
/// `FSMStateDiagram` graph — a count-annotated state grid rather than an SVG graph).
public struct StateDiagramNode: Identifiable, Hashable, Sendable {
    public let id: String
    public let inbound: Int
    public let outbound: Int

    public init(state: String, inbound: Int, outbound: Int) {
        id = state
        self.inbound = inbound
        self.outbound = outbound
    }

    public var state: String { id }
}
