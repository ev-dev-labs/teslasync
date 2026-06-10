//
//  SignalDiffTable.Models.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  Foundation-only value types for the Signal Diff table — the SwiftUI parity of
//  features/telemetry/components/SignalDiffTable.tsx.
//
//  These mirror the web data contract `SignalDiffRow` (api/hooks/useTelemetry):
//  each diff entry carries the signal name, the two opaque window values
//  (`value_a` / `value_b`), the per-window source layer + age, and the
//  backend `changed` flag. `SignalDiffCellValue` models the decoded JSON value
//  space the web `formatRaw` / `asNumber` coerce; `SignalDiffSourceLayer` mirrors
//  `SignalSourceLayer` ('l1' | 'l2' | 'log' | 'stale' | 'unknown'). Everything
//  here is pure + `Sendable` so the adapter in `SignalDiffTable.Adapter.swift`
//  can be exercised by an executed host harness and the XCTest suite without
//  SwiftUI.
//

import Foundation

// MARK: - Decoded cell value (web `unknown` value space)

/// One decoded window value, mirroring the `unknown` the web `formatRaw` /
/// `asNumber` coerce. `compound` holds the pre-serialized JSON the web produces
/// via `JSON.stringify` for object/array values; `absent` is the web `undefined`
/// and `null` is the JSON null — both render as the web em dash.
public enum SignalDiffCellValue: Equatable, Sendable {
    case null
    case absent
    case string(String)
    case number(Double)
    case bool(Bool)
    case compound(String)
}

// MARK: - Source layer (web `SignalSourceLayer`)

/// Where a window value was served from, mirroring the backend-reported
/// `SignalSourceLayer` the web `SourceLayerBadge` renders: `l1` (in-process),
/// `l2` (Redis), `log` (signal_log replay), `stale` (>2 min Redis), or `unknown`.
public enum SignalDiffSourceLayer: String, Sendable, CaseIterable {
    case l1
    case l2
    case log
    case stale
    case unknown

    /// Folds an optional backend string into the enum — unrecognized or missing
    /// layers collapse to `.unknown`, matching the web `STYLE[key] ?? STYLE.unknown`.
    public init(raw: String?) {
        switch (raw ?? "unknown").lowercased() {
        case "l1": self = .l1
        case "l2": self = .l2
        case "log": self = .log
        case "stale": self = .stale
        default: self = .unknown
        }
    }

    /// The short glyph rendered in the badge (web `STYLE[key].label`).
    public var badgeLabel: String {
        switch self {
        case .l1: "L1"
        case .l2: "L2"
        case .log: "LOG"
        case .stale: "STALE"
        case .unknown: "—"
        }
    }
}

// MARK: - Raw diff entry (web `SignalDiffRow` from the source)

/// A single diff entry as handed to the adapter — the Swift port of the web
/// `SignalDiffRow` response item before display normalization.
public struct SignalDiffEntry: Equatable, Sendable {
    public let name: String
    public let valueA: SignalDiffCellValue
    public let valueB: SignalDiffCellValue
    public let sourceA: SignalDiffSourceLayer
    public let sourceB: SignalDiffSourceLayer
    public let ageMsA: Double?
    public let ageMsB: Double?
    public let changed: Bool

    public init(
        name: String,
        valueA: SignalDiffCellValue,
        valueB: SignalDiffCellValue,
        sourceA: SignalDiffSourceLayer = .unknown,
        sourceB: SignalDiffSourceLayer = .unknown,
        ageMsA: Double? = nil,
        ageMsB: Double? = nil,
        changed: Bool = true
    ) {
        self.name = name
        self.valueA = valueA
        self.valueB = valueB
        self.sourceA = sourceA
        self.sourceB = sourceB
        self.ageMsA = ageMsA
        self.ageMsB = ageMsB
        self.changed = changed
    }
}

// MARK: - Delta classification (web `deltaLabel`)

/// The Δ-column classification the web `deltaLabel` produces: a numeric delta
/// (with optional percent change), a non-numeric `changed`, or `none` when the
/// two windows render identically.
public enum SignalDiffDeltaKind: Equatable, Sendable {
    case none
    case changed
    case numeric(delta: Double, percent: Double?)
}

// MARK: - Normalized, display-ready row

/// A normalized row: the signal name, the two coerced value strings, the Δ
/// classification, the per-window source layers + ages, and whether the row is
/// pinned. `id` is the signal name (the web `keyExtractor`), unique within a
/// snapshot.
public struct SignalDiffRow: Identifiable, Equatable, Sendable {
    public let name: String
    public let valueAText: String
    public let valueBText: String
    public let delta: SignalDiffDeltaKind
    public let sourceA: SignalDiffSourceLayer
    public let sourceB: SignalDiffSourceLayer
    public let ageMsA: Double?
    public let ageMsB: Double?
    public let pinned: Bool

    public var id: String {
        name
    }

    public init(
        name: String,
        valueAText: String,
        valueBText: String,
        delta: SignalDiffDeltaKind,
        sourceA: SignalDiffSourceLayer,
        sourceB: SignalDiffSourceLayer,
        ageMsA: Double?,
        ageMsB: Double?,
        pinned: Bool
    ) {
        self.name = name
        self.valueAText = valueAText
        self.valueBText = valueBText
        self.delta = delta
        self.sourceA = sourceA
        self.sourceB = sourceB
        self.ageMsA = ageMsA
        self.ageMsB = ageMsB
        self.pinned = pinned
    }
}

// MARK: - Sort model (web sortable columns)

/// The sortable columns. The web marks `name` and `delta` sortable; the value
/// and source columns are not. Pinned rows always float above the sort (web
/// `sortedRows` pin priority).
public enum SignalDiffSortKey: String, Sendable, CaseIterable {
    case name
    case delta
}

/// Sort direction, mirroring the web `'asc' | 'desc'`.
public enum SignalDiffSortDirection: String, Sendable {
    case ascending
    case descending

    /// The flipped direction (web header re-click).
    public var toggled: SignalDiffSortDirection {
        self == .ascending ? .descending : .ascending
    }
}

// MARK: - Projection

/// The pinned-first, sorted projection produced from a snapshot. The view model
/// rebuilds this whenever the rows, the pin set, or the active sort changes,
/// mirroring the web `sortedRows` `useMemo`.
public struct SignalDiffTableProjection: Equatable, Sendable {
    public let rows: [SignalDiffRow]

    public init(rows: [SignalDiffRow]) {
        self.rows = rows
    }

    /// Whether any diff row exists (web `rows.length === 0`).
    public var hasData: Bool {
        !rows.isEmpty
    }

    /// An empty projection (no differing signals).
    public static let empty = SignalDiffTableProjection(rows: [])
}
