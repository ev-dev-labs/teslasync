import Foundation

/// One scripted FSM transition in the sample cycle (avoids a 3-tuple per SwiftLint `large_tuple`).
private struct SampleTransition {
    let from: String
    let to: String
    let trigger: String
}

/// One scripted per-state summary row in the sample fixture.
private struct SampleSummaryRow {
    let state: String
    let seconds: Double
    let count: Int
}

/// A representative local seed used as the `TimelinePage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with a few days of FSM transitions plus a
/// per-state time summary) so the surface renders its populated success state out of the box
/// (mirroring the sibling page's sample source). Durations are SI seconds.
public struct SampleTimelineDataSource: TimelineDataSource {
    public init() {}

    public func loadVehicles() async throws -> [TimelineVehicle] {
        [
            TimelineVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            TimelineVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            TimelineVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadTransitions(vehicleID: Int64) async throws -> [TimelineTransitionRecord] {
        let cycle: [SampleTransition] = [
            SampleTransition(from: "sleeping", to: "online", trigger: "is_user_present"),
            SampleTransition(from: "online", to: "driving", trigger: "drive_state"),
            SampleTransition(from: "driving", to: "idle", trigger: "shift_state"),
            SampleTransition(from: "idle", to: "charging", trigger: "charging_state"),
            SampleTransition(from: "charging", to: "online", trigger: "charging_state"),
            SampleTransition(from: "online", to: "parked", trigger: "shift_state"),
            SampleTransition(from: "parked", to: "sleeping", trigger: "vehicle_state")
        ]
        // One full cycle per day for the last `days` days, offset so each vehicle differs slightly.
        let days = 3 + Int(vehicleID % 2)
        let hourStep: TimeInterval = 3 * 3600
        var records: [TimelineTransitionRecord] = []
        for day in 0 ..< days {
            for (step, transition) in cycle.enumerated() {
                let offset = TimeInterval(day) * 86400 + TimeInterval(step) * hourStep
                let timestamp = Date(timeIntervalSinceNow: -offset - TimeInterval(vehicleID) * 600)
                records.append(
                    TimelineTransitionRecord(
                        timestamp: timestamp,
                        fromState: transition.from,
                        toState: transition.to,
                        triggerField: transition.trigger,
                        triggerValue: "true"
                    )
                )
            }
        }
        return records
    }

    public func loadSummary(vehicleID: Int64) async throws -> TimelineSummary? {
        let rows: [SampleSummaryRow] = switch vehicleID {
        case 1:
            [
                SampleSummaryRow(state: "driving", seconds: 18000, count: 5),
                SampleSummaryRow(state: "charging", seconds: 9000, count: 3),
                SampleSummaryRow(state: "online", seconds: 3600, count: 4),
                SampleSummaryRow(state: "parked", seconds: 43200, count: 6),
                SampleSummaryRow(state: "idle", seconds: 1800, count: 2),
                SampleSummaryRow(state: "sleeping", seconds: 54000, count: 4)
            ]
        case 2:
            [
                SampleSummaryRow(state: "driving", seconds: 14400, count: 4),
                SampleSummaryRow(state: "charging", seconds: 7200, count: 3),
                SampleSummaryRow(state: "online", seconds: 5400, count: 5),
                SampleSummaryRow(state: "parked", seconds: 50400, count: 7),
                SampleSummaryRow(state: "sleeping", seconds: 46800, count: 5)
            ]
        default:
            [
                SampleSummaryRow(state: "driving", seconds: 21600, count: 6),
                SampleSummaryRow(state: "charging", seconds: 10800, count: 4),
                SampleSummaryRow(state: "online", seconds: 2700, count: 3),
                SampleSummaryRow(state: "parked", seconds: 39600, count: 5),
                SampleSummaryRow(state: "idle", seconds: 2400, count: 2),
                SampleSummaryRow(state: "sleeping", seconds: 50400, count: 4)
            ]
        }
        return Self.summary(from: rows)
    }

    /// Builds a `TimelineSummary` from the scripted rows, computing each row's percentage of the
    /// grand total.
    private static func summary(from rows: [SampleSummaryRow]) -> TimelineSummary {
        let total = rows.reduce(0) { $0 + $1.seconds }
        let byState = rows.map { row in
            TimelineStateSummaryRow(
                state: row.state,
                totalSeconds: row.seconds,
                percentage: total > 0 ? row.seconds / total * 100 : 0,
                transitionCount: row.count
            )
        }
        return TimelineSummary(totalSeconds: total, byState: byState)
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no transitions and no state summary — drives the
    /// page's all-empty state and each panel's own empty state.
    public struct EmptyTimelineDataSource: TimelineDataSource {
        public init() {}

        public func loadVehicles() async throws -> [TimelineVehicle] {
            [TimelineVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadTransitions(vehicleID _: Int64) async throws -> [TimelineTransitionRecord] {
            []
        }

        public func loadSummary(vehicleID _: Int64) async throws -> TimelineSummary? {
            TimelineSummary(totalSeconds: 0, byState: [])
        }
    }

    /// Preview/test seam whose transition + summary loads both fail — drives the error state
    /// (web `anyError`).
    public struct FailingTimelineDataSource: TimelineDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [TimelineVehicle] {
            [TimelineVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadTransitions(vehicleID _: Int64) async throws -> [TimelineTransitionRecord] {
            throw Failure()
        }

        public func loadSummary(vehicleID _: Int64) async throws -> TimelineSummary? {
            throw Failure()
        }
    }
#endif
