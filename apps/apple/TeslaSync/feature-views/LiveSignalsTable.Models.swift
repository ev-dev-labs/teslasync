//
//  LiveSignalsTable.Models.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  Foundation-only value types for the Live Signal Inspector table — the SwiftUI
//  parity of features/admin/components/live-signal-inspector/LiveSignalsTable.tsx.
//
//  These mirror the web data contract: `VehicleLiveSignalsResponse.signals` is a
//  `Record<string, VehicleLiveSignal | scalar>` where each entry is either a
//  `{ value, timestamp }` envelope or a bare scalar. `LiveSignalCellValue` models
//  the decoded JSON value space the web `renderValue` coerces to a display string,
//  and `RawSignalPayload` carries the envelope-vs-bare distinction the web
//  `rowFromEntry` branches on. Everything here is pure + `Sendable` so the adapter
//  in `LiveSignalsTable.Adapter.swift` can be exercised by an executed host harness
//  and the XCTest suite without SwiftUI.
//

import Foundation

// MARK: - Decoded signal value (web JSON value space)

/// One decoded live-signal value, mirroring the `unknown` the web `renderValue`
/// coerces. `compound` holds the pre-serialized JSON the web produces via
/// `JSON.stringify` for object/array values; `absent` is the web `undefined`.
public enum LiveSignalCellValue: Equatable, Sendable {
    case null
    case string(String)
    case number(Double)
    case bool(Bool)
    case compound(String)
    case absent
}

// MARK: - Raw entry payload (web `rowFromEntry` input)

/// A single `signals` entry before normalization. `envelope` is the
/// `{ value, timestamp }` shape; `bare` is a raw scalar shipped by a repo that
/// did not wrap its value — both flow through `LiveSignalsTableBuilder.row`.
public enum RawSignalPayload: Equatable, Sendable {
    case envelope(value: LiveSignalCellValue, timestamp: String?)
    case bare(LiveSignalCellValue)
}

/// A named raw entry, the unit the source hands to the adapter (web
/// `Object.keys(signals).map(...)`).
public struct LiveSignalEntry: Equatable, Sendable {
    public let name: String
    public let payload: RawSignalPayload

    public init(name: String, payload: RawSignalPayload) {
        self.name = name
        self.payload = payload
    }
}

// MARK: - Normalized row (web `LiveSignalRow`)

/// A normalized, display-ready row: the signal name, the coerced value string,
/// and the parsed update time (kept alongside the raw ISO string so the cell can
/// render a relative timestamp). `id` is the signal name (the web
/// `keyExtractor`), which is unique within a snapshot.
public struct LiveSignalRow: Identifiable, Equatable, Sendable {
    public let name: String
    public let valueText: String
    public let timestampRaw: String?
    public let timestamp: Date?

    public var id: String {
        name
    }

    public init(name: String, valueText: String, timestampRaw: String?, timestamp: Date?) {
        self.name = name
        self.valueText = valueText
        self.timestampRaw = timestampRaw
        self.timestamp = timestamp
    }
}

// MARK: - Sort model (web `useSortToggle`)

/// The sortable columns (web sortable columns: `name`, `timestamp`). The `value`
/// column is intentionally not sortable, matching the web source.
public enum LiveSignalSortKey: String, Sendable, CaseIterable {
    case name
    case timestamp
}

/// Sort direction, mirroring the web `'asc' | 'desc'`.
public enum LiveSignalSortDirection: String, Sendable {
    case ascending
    case descending

    /// The flipped direction (web header re-click).
    public var toggled: LiveSignalSortDirection {
        self == .ascending ? .descending : .ascending
    }
}

// MARK: - Projection

/// The unfiltered, default-sorted projection produced from a snapshot. The view
/// model applies the live filter + sort on top of `rows` for display, mirroring
/// the web `rows` → `filtered` → `sorted` `useMemo` chain.
public struct LiveSignalsTableProjection: Equatable, Sendable {
    public let rows: [LiveSignalRow]

    public init(rows: [LiveSignalRow]) {
        self.rows = rows
    }

    /// Whether any signal is cached (web `rows.length === 0`).
    public var hasData: Bool {
        !rows.isEmpty
    }

    /// An empty projection (no cached snapshot).
    public static let empty = LiveSignalsTableProjection(rows: [])
}
