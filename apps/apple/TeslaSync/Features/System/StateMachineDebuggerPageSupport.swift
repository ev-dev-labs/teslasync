//
//  StateMachineDebuggerPageSupport.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Format & Derive
//
//  Pure, testable display-boundary helpers ported from `StateMachineDebuggerPage.tsx`:
//  `formatDuration`, the vehicle-state styling map, the `pieData` / `summaryRows` memos, and
//  `computeFlapIds` (from `FSMHealthPanel`). All copy resolves from `Localizable.xcstrings`;
//  these helpers return tokens (`TSTone`) or pre-formatted strings so the views stay declarative.
//

import Foundation
import SwiftUI

// MARK: - Formatters (web `formatDuration` / `getVehicleStyle` / number + date format)

/// Pure formatters mirroring the web helpers 1:1 so the rendered copy matches the React page.
public enum StateMachineFormat {
    /// The em dash shown for absent values (web `'—'`).
    public static let emptyValue = "—"

    /// Web `formatDuration`: seconds → `Ns` / `Nm` / `Nh Nm` (drops trailing `0m`).
    public static func duration(_ seconds: Double) -> String {
        if seconds < 60 { return "\(integer(seconds))s" }
        if seconds < 3600 { return "\(integer(seconds / 60))m" }
        let hours = Int(seconds / 3600)
        let minutesRaw = seconds.truncatingRemainder(dividingBy: 3600) / 60
        return minutesRaw >= 0.5 ? "\(hours)h \(integer(minutesRaw))m" : "\(hours)h"
    }

    /// Web `fmtInt` — grouped integer (rounds half-up like `Intl.NumberFormat`).
    public static func integer(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value.rounded())) ?? "\(Int(value.rounded()))"
    }

    public static func integer(_ value: Int) -> String { integer(Double(value)) }

    /// FSM badge-variant tone per state (web `VEHICLE_STATE_ENTRIES[state].variant`).
    public static func stateTone(_ state: String) -> TSTone {
        switch state.lowercased() {
        case "online", "driving", "connected": .success
        case "charging", "reconnecting": .warning
        case "parked", "updating": .info
        case "offline", "disconnected": .danger
        default: .neutral
        }
    }

    /// Web hero `Mode` derivation: charging → drive (speed>0) → sleep (asleep) → idle.
    public static func modeKey(for state: VehicleLiveState) -> LocalizedStringKey {
        if state.isCharging { return "fsm.modeCharging" }
        if state.speed > 0 { return "fsm.modeDrive" }
        if state.state.lowercased() == "asleep" { return "fsm.modeSleep" }
        return "fsm.modeIdle"
    }

    /// Absolute timestamp (web `TimeStamp format="absolute"`, UTC).
    public static func absolute(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MMM d, yyyy, HH:mm:ss"
        return formatter.string(from: date)
    }

    /// Relative timestamp (web `TimeStamp format="relative"`).
    public static func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    /// Short clock time `HH:mm:ss` (UTC) for the live timeline rows.
    public static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    /// Web `emptyRangeMessage` — "No transitions in {{range}}. …", key-stable.
    public static func noTransitions(range: String) -> String {
        let template = String(
            localized: "fsm.noTransitionsInRange",
            defaultValue: "No transitions in %@. Try expanding the time range."
        )
        return String(format: template, range)
    }

    /// Web `fsm.health.flapping` — "{{count}} transitions flagged …", key-stable.
    public static func flappingMessage(count: Int) -> String {
        let template = String(
            localized: "fsm.healthFlapping",
            defaultValue: "%lld transitions flagged as state flapping (>5 same-FSM transitions/min)"
        )
        return String(format: template, count)
    }
}

// MARK: - Pure derivations (web `pieData` / `summaryRows` / `computeFlapIds` / diagram)

/// Pure transforms over the transition list. Each is deterministic + unit-test friendly.
public enum StateMachineDerive {
    /// Web `pieData` — group by `to_state`, sort by count desc, color by order.
    public static func slices(from transitions: [FSMDebuggerTransition]) -> [StateDistributionSlice] {
        var byState: [String: Int] = [:]
        for transition in transitions {
            byState[transition.toState, default: 0] += 1
        }
        return byState
            .sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .enumerated()
            .map { index, entry in
                StateDistributionSlice(name: entry.key, value: entry.value, colorIndex: index)
            }
    }

    /// Web `summaryRows` — per `to_state` count + average inter-arrival interval (seconds).
    public static func summaryRows(from transitions: [FSMDebuggerTransition]) -> [StateSummaryRow] {
        var times: [String: [TimeInterval]] = [:]
        var counts: [String: Int] = [:]
        for transition in transitions {
            counts[transition.toState, default: 0] += 1
            times[transition.toState, default: []].append(transition.ts.timeIntervalSince1970)
        }
        return counts
            .sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .map { name, count in
                StateSummaryRow(
                    toState: name,
                    count: count,
                    avgIntervalSec: averageInterval(times[name] ?? [])
                )
            }
    }

    /// Web `summaryRows` interval: mean gap between sorted timestamps (0 for <2 samples).
    private static func averageInterval(_ samples: [TimeInterval]) -> Double {
        guard samples.count > 1 else { return 0 }
        let sorted = samples.sorted()
        var totalGap: TimeInterval = 0
        for index in 1 ..< sorted.count {
            totalGap += sorted[index] - sorted[index - 1]
        }
        return totalGap / Double(sorted.count - 1)
    }

    /// Web `computeFlapIds` — ids in any >5-per-60s same-FSM burst.
    public static func flapIDs(from transitions: [FSMDebuggerTransition]) -> Set<Int64> {
        var flapped: Set<Int64> = []
        var byType: [String: [FSMDebuggerTransition]] = [:]
        for transition in transitions {
            byType[transition.fsmName, default: []].append(transition)
        }
        for (_, list) in byType {
            let sorted = list.sorted { $0.ts < $1.ts }
            for start in sorted.indices {
                let windowEnd = sorted[start].ts.addingTimeInterval(60)
                let burst = sorted[start...].prefix { $0.ts <= windowEnd }
                if burst.count > 5 {
                    flapped.formUnion(burst.map(\.id))
                }
            }
        }
        return flapped
    }

    /// Mean inter-arrival gap across all transitions (overall health average interval).
    public static func overallAvgIntervalSec(from transitions: [FSMDebuggerTransition]) -> Double {
        let times = transitions.map { $0.ts.timeIntervalSince1970 }.sorted()
        guard times.count > 1 else { return 0 }
        var total: TimeInterval = 0
        for index in 1 ..< times.count {
            total += times[index] - times[index - 1]
        }
        return total / Double(times.count - 1)
    }

    /// Inbound/outbound counts per state (native `FSMStateDiagram` adaptation).
    public static func diagramNodes(from transitions: [FSMDebuggerTransition]) -> [StateDiagramNode] {
        var inbound: [String: Int] = [:]
        var outbound: [String: Int] = [:]
        var order: [String] = []
        for transition in transitions {
            for state in [transition.fromState, transition.toState] where !order.contains(state) {
                order.append(state)
            }
            inbound[transition.toState, default: 0] += 1
            outbound[transition.fromState, default: 0] += 1
        }
        return order.sorted().map { state in
            StateDiagramNode(state: state, inbound: inbound[state] ?? 0, outbound: outbound[state] ?? 0)
        }
    }

    /// Web `FSMTimelineChart` bucketing — counts over ≤24 even time buckets (native bar series).
    public static func timelineSeries(from transitions: [FSMDebuggerTransition]) -> TSChartSeries {
        let sorted = transitions.map(\.ts).sorted()
        guard let first = sorted.first, let last = sorted.last, last > first else {
            let points = transitions.isEmpty
                ? []
                : [TSChartPoint(x: 0, y: Double(transitions.count), id: "b0")]
            return series(points)
        }
        let bucketCount = min(24, max(1, transitions.count))
        let span = last.timeIntervalSince(first)
        var counts = Array(repeating: 0, count: bucketCount)
        for time in sorted {
            let fraction = time.timeIntervalSince(first) / span
            let index = min(bucketCount - 1, Int(fraction * Double(bucketCount)))
            counts[index] += 1
        }
        let points = counts.enumerated().map { index, count in
            TSChartPoint(x: Double(index), y: Double(count), id: "b\(index)")
        }
        return series(points)
    }

    private static func series(_ points: [TSChartPoint]) -> TSChartSeries {
        TSChartSeries(
            id: "transitions",
            name: "fsm.timelineChartTitle",
            nameText: "Transitions",
            points: points,
            colorIndex: 4
        )
    }
}
