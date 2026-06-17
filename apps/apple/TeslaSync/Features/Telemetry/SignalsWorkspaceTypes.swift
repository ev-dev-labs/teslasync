//
//  SignalsWorkspaceTypes.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  Value types backing the `/signals` workspace model. All Sendable so the
//  main-actor model can vend them to views without concurrency friction.
//

import Foundation

/// The phase of a single data source. Every source renders all four (ADR-011).
enum WorkspaceDataPhase: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

/// The three mutually-exclusive right-column modes (web `isLive` / `isCompare`,
/// neither ⇒ historical). Toggling Live clears Compare and vice-versa.
enum WorkspaceMode: String, CaseIterable, Sendable {
    case historical
    case live
    case compare
}

/// Chart layout segmented control (web `chart` URL param: auto | overlay | grid).
enum WorkspaceChartLayout: String, CaseIterable, Sendable {
    case auto
    case overlay
    case grid
}

/// A signal value that may be numeric, textual, boolean, or absent. Replaces the
/// web's untyped `unknown` with a Sendable, exhaustively-formatted enum.
enum WorkspaceSignalValue: Equatable, Hashable, Sendable {
    case number(Double)
    case text(String)
    case bool(Bool)
    case missing

    /// Human-readable display rendering (3 dp for numbers, em-dash for absent).
    var display: String {
        switch self {
        case let .number(value): String(format: "%.3f", value)
        case let .text(value): value
        case let .bool(value): value ? "true" : "false"
        case .missing: "—"
        }
    }

    /// CSV-safe rendering (6 dp for numbers, quoted text).
    var csv: String {
        switch self {
        case let .number(value): String(format: "%.6f", value)
        case let .text(value): "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        case let .bool(value): value ? "true" : "false"
        case .missing: ""
        }
    }

    /// Numeric projection used for delta + stats (booleans map to 1/0).
    var numeric: Double? {
        switch self {
        case let .number(value): value
        case let .bool(value): value ? 1 : 0
        case .text, .missing: nil
        }
    }
}

/// A vehicle in the selector (web `useVehicles`).
struct WorkspaceVehicle: Identifiable, Sendable, Hashable {
    let id: Int64
    let displayName: String
    let vin: String
}

/// A single row of the two-snapshot diff (web `SignalDiffRow`).
struct WorkspaceDiffEntry: Identifiable, Sendable, Hashable {
    var id: String { name }
    let name: String
    let valueA: WorkspaceSignalValue
    let valueB: WorkspaceSignalValue
    let sourceA: String?
    let sourceB: String?

    /// Numeric delta between the two windows, when both ends are numeric.
    var delta: Double? {
        guard let endA = valueA.numeric, let endB = valueB.numeric else { return nil }
        return endB - endA
    }
}

/// Per-signal aggregate over the historical / live window (web `WorkspaceSignalStat`).
struct WorkspaceSignalStat: Identifiable, Sendable, Hashable {
    var id: String { signal }
    let signal: String
    let min: Double
    let max: Double
    let avg: Double
    let count: Int
}

/// A paginated historical sample (web `SignalLogEntry`).
struct SignalHistoryEntry: Identifiable, Sendable, Hashable {
    let id: String
    let signal: String
    let timestamp: Date
    let value: WorkspaceSignalValue
}

/// A live-tail line (web `LiveSignalTail` entry).
struct LiveTailEntry: Identifiable, Sendable, Hashable {
    let id: String
    let signal: String
    let timestamp: Date
    let value: WorkspaceSignalValue
}

/// A catalog category grouping selectable signals by name prefix
/// (web `CATEGORY_PREFIXES` in SignalCompareControls).
struct SignalCategory: Identifiable, Sendable, Hashable {
    var id: String { key }
    let key: String
    let title: String
    let prefixes: [String]

    func matches(_ signal: String) -> Bool {
        let lower = signal.lowercased()
        return prefixes.contains { lower.hasPrefix($0) || lower.contains($0) }
    }
}
