//
//  StateMachineDebuggerPageSample.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Sample Source
//
//  A representative local seed used as the page/preview default until the KMP-backed source is
//  injected at composition time (mirroring `SampleCommandHistoryDataSource`). It is NOT
//  production telemetry — it exists so the surface renders its populated state (distribution,
//  counts, timeline, diagram, flap warnings, live state, snapshot inspector) out of the box.
//  Honors the FSM-type filter and server pagination so the table + pager behave realistically.
//

import Foundation

/// A representative seed FSM stream covering the vehicle + telemetry_connection FSMs, including a
/// deliberate same-FSM burst so the flap-warning panel exercises (web `computeFlapIds`).
public struct SampleStateMachineDataSource: StateMachineDataSource {
    public init() {}

    public func vehicles() async throws -> [DebuggerVehicle] {
        [
            DebuggerVehicle(id: 1, displayName: "Model 3 Performance", vin: "5YJ3E1EA7KF000001"),
            DebuggerVehicle(id: 2, displayName: "Model Y Long Range", vin: "5YJYGDEE9MF000002")
        ]
    }

    public func useVehicleStateMachine(vehicleID: Int64) async throws -> VehicleLiveState? {
        VehicleLiveState(
            state: "driving",
            since: Date().addingTimeInterval(-18 * 60),
            isCharging: false,
            speed: 64
        )
    }

    public func useFSMStats(vehicleID: Int64) async throws -> FSMStatsData {
        FSMStatsData(
            enabled: true,
            counts: ["online": 14, "driving": 9, "charging": 6, "parked": 11, "asleep": 4, "offline": 2],
            activeSubs: [
                ActiveSubFSM(
                    id: "drive-8841",
                    type: "drive",
                    state: "active",
                    startTime: Date().addingTimeInterval(-18 * 60)
                )
            ]
        )
    }

    public func useFSMTransitions(
        vehicleID: Int64, fsmType: String, hours: Int, page: Int, perPage: Int
    ) async throws -> FSMTransitionPage {
        let pool = Self.pool(vehicleID: vehicleID).filter { row in
            fsmType.isEmpty || row.fsmName == fsmType
        }
        let lower = max(0, (page - 1) * perPage)
        guard lower < pool.count else { return FSMTransitionPage(rows: [], total: pool.count) }
        let upper = min(pool.count, page * perPage)
        return FSMTransitionPage(rows: Array(pool[lower ..< upper]), total: pool.count)
    }

    public func useSignalSnapshot(vehicleID: Int64, at: Date) async throws -> [SignalSnapshotRow] {
        [
            SignalSnapshotRow(name: "VehicleSpeed", value: "64 mph"),
            SignalSnapshotRow(name: "Gear", value: "D"),
            SignalSnapshotRow(name: "Soc", value: "72 %"),
            SignalSnapshotRow(name: "ChargeState", value: "Disconnected"),
            SignalSnapshotRow(name: "Odometer", value: "18,402 mi")
        ]
    }

    // MARK: Seed pool

    private static func pool(vehicleID: Int64) -> [FSMDebuggerTransition] {
        let now = Date()
        var rows: [FSMDebuggerTransition] = []
        var clock = now.addingTimeInterval(-Double(cycle.count) * 7 * 60)
        var nextID: Int64 = 9000

        for (offset, step) in cycle.enumerated() {
            clock = clock.addingTimeInterval(7 * 60 + Double(offset % 5) * 40)
            rows.append(transition(id: nextID, vehicleID: vehicleID, ts: clock, step: step))
            nextID += 1
        }
        rows.append(contentsOf: flapBurst(
            vehicleID: vehicleID, anchor: now.addingTimeInterval(-90 * 60), startID: nextID
        ))
        rows.append(contentsOf: telemetry(vehicleID: vehicleID, now: now, startID: nextID + 20))
        return rows.sorted { $0.ts > $1.ts }
    }

    private static func transition(
        id: Int64, vehicleID: Int64, ts: Date, step: Step
    ) -> FSMDebuggerTransition {
        FSMDebuggerTransition(
            id: id,
            vehicleID: vehicleID,
            ts: ts,
            fsmName: "vehicle",
            fromState: step.from,
            toState: step.to,
            trigger: step.trigger,
            guardName: step.guardName,
            durationInStateMs: step.durationMs,
            details: [
                FSMTransitionDetail(key: "trigger", value: step.trigger),
                FSMTransitionDetail(key: "timing", value: step.timing)
            ]
        )
    }

    /// A >5-per-60s same-FSM burst so the flap-warning panel exercises.
    private static func flapBurst(vehicleID: Int64, anchor: Date, startID: Int64) -> [FSMDebuggerTransition] {
        (0 ..< 7).map { index in
            FSMDebuggerTransition(
                id: startID + Int64(index),
                vehicleID: vehicleID,
                ts: anchor.addingTimeInterval(Double(index) * 7),
                fsmName: "vehicle",
                fromState: index.isMultiple(of: 2) ? "online" : "offline",
                toState: index.isMultiple(of: 2) ? "offline" : "online",
                trigger: index.isMultiple(of: 2) ? "heartbeat_lost" : "signal_received",
                guardName: nil,
                durationInStateMs: 4200,
                details: [FSMTransitionDetail(key: "flap", value: "true")]
            )
        }
    }

    private static func telemetry(vehicleID: Int64, now: Date, startID: Int64) -> [FSMDebuggerTransition] {
        [
            FSMDebuggerTransition(
                id: startID,
                vehicleID: vehicleID,
                ts: now.addingTimeInterval(-26 * 60),
                fsmName: "telemetry_connection",
                fromState: "disconnected",
                toState: "connected",
                trigger: "stream_opened",
                durationInStateMs: 9000,
                details: [FSMTransitionDetail(key: "trigger", value: "stream_opened")]
            ),
            FSMDebuggerTransition(
                id: startID + 1,
                vehicleID: vehicleID,
                ts: now.addingTimeInterval(-52 * 60),
                fsmName: "telemetry_connection",
                fromState: "connected",
                toState: "reconnecting",
                trigger: "stream_stalled",
                durationInStateMs: 9000,
                details: [FSMTransitionDetail(key: "trigger", value: "stream_stalled")]
            )
        ]
    }

    private struct Step {
        let from: String
        let to: String
        let trigger: String
        let guardName: String?
        let timing: String
        let durationMs: Double

        init(
            _ from: String, _ to: String, _ trigger: String,
            _ guardName: String?, _ timing: String, _ durationMs: Double
        ) {
            self.from = from
            self.to = to
            self.trigger = trigger
            self.guardName = guardName
            self.timing = timing
            self.durationMs = durationMs
        }
    }

    private static let cycle: [Step] = [
        Step("online", "driving", "gear_driving", nil, "immediate", 0),
        Step("driving", "parked", "gear_parked", "no_charge", "immediate", 1_980_000),
        Step("parked", "asleep", "sleep_timeout", "no_activity", "immediate", 720_000),
        Step("asleep", "online", "activity_detected", nil, "immediate", 5_400_000),
        Step("online", "charging", "charge_started", nil, "immediate", 240_000),
        Step("charging", "online", "charge_ended", "no_charge", "immediate", 3_600_000),
        Step("online", "driving", "speed_detected", "no_gear", "immediate", 180_000),
        Step("driving", "online", "speed_zero", "no_gear", "debounced", 2_640_000),
        Step("online", "offline", "heartbeat_lost", nil, "immediate", 90_000),
        Step("offline", "online", "signal_received", nil, "immediate", 600_000),
        Step("online", "parked", "gear_parked", "no_charge", "debounced", 300_000),
        Step("parked", "driving", "gear_driving", nil, "immediate", 4_200_000)
    ]
}
