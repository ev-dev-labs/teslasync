//
//  SignalCatalogPanel.Models.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  Foundation-only value types for the staleness-aware signal catalog — the
//  SwiftUI parity of features/telemetry/components/SignalCatalogPanel.tsx.
//
//  They mirror the web data contract: `useSignalGaps` returns a
//  `Record<string, { value, timestamp } | scalar>` (the `/signals/{id}/live`
//  snapshot). `SignalCatalogPanelCellValue` models the decoded JSON value space
//  the web coerces with `value != null ? String(value) : '—'`, and
//  `SignalCatalogPanelRawPayload` carries the envelope-vs-bare distinction the web
//  `Object.entries(...).map` branches on. The catalog adds two distinct staleness
//  taxonomies the web keeps separate and this port preserves:
//    • `SignalCatalogPanelCategory` (never / stale / active) — drives the filter
//      modes, the four summary counts, and the category sort.
//    • `SignalCatalogPanelTone` (neverReceived / active / aging / stale) — the
//      four-level row Status badge + Time-Since color (web getCatalogStalenessStyle).
//  Everything here is pure + `Sendable` so the adapter can be exercised by an
//  executed host harness and the XCTest suite without SwiftUI.
//

import Foundation

// MARK: - Decoded signal value (web JSON value space)

/// One decoded live-signal value, mirroring the `unknown` the web coerces via
/// `value != null ? String(value) : '—'`. `compound` holds the pre-computed
/// `String(value)` the web would yield for an object/array; `absent` is the web
/// `undefined`. Both `null` and `absent` render as the em dash.
public enum SignalCatalogPanelCellValue: Equatable, Sendable {
    case null
    case string(String)
    case number(Double)
    case bool(Bool)
    case compound(String)
    case absent
}

// MARK: - Raw entry payload (web `Object.entries` input)

/// A single `signals` entry before normalization. `envelope` is the
/// `{ value, timestamp }` shape (timestamp may be `null`); `bare` is a raw scalar
/// the web wraps as `{ value: entry, timestamp: null }`. Both flow through
/// `SignalCatalogPanelBuilder.row`.
public enum SignalCatalogPanelRawPayload: Equatable, Sendable {
    case envelope(value: SignalCatalogPanelCellValue, timestamp: String?)
    case bare(SignalCatalogPanelCellValue)
}

/// A named raw entry, the unit the source hands to the adapter (web
/// `Object.entries(liveData).map(([name, entry]) => …)`).
public struct SignalCatalogPanelEntry: Equatable, Sendable {
    public let name: String
    public let payload: SignalCatalogPanelRawPayload

    public init(name: String, payload: SignalCatalogPanelRawPayload) {
        self.name = name
        self.payload = payload
    }
}

// MARK: - Staleness taxonomies

/// The three-way bucket used for filtering + the four summary counts + the
/// category sort. Mirrors the web `SignalRow['category']`: `never` (no
/// timestamp), `stale` (staleness > 300 s), else `active`.
public enum SignalCatalogPanelCategory: String, Sendable, CaseIterable {
    case active
    case stale
    case never

    /// The web category sort order (`{ never: 0, stale: 1, active: 2 }`).
    public var sortRank: Int {
        switch self {
        case .never: 0
        case .stale: 1
        case .active: 2
        }
    }
}

/// The four-level row badge tone — the web `getCatalogStalenessStyle`: no
/// timestamp → neverReceived (neutral); < 30 s → active (success); < 300 s →
/// aging (warning); otherwise stale (danger). Kept separate from
/// `SignalCatalogPanelCategory`, which buckets at 300 s only.
public enum SignalCatalogPanelTone: String, Sendable {
    case active
    case aging
    case stale
    case neverReceived
}

// MARK: - Normalized row (web `SignalRow`)

/// A normalized, display-ready row: the signal name, the coerced value string,
/// the raw + parsed update time, the staleness in seconds (`.infinity` when no
/// timestamp), and the three-way category. `id` is the signal name (the web
/// `keyExtractor`), unique within a snapshot.
public struct SignalCatalogPanelRow: Identifiable, Equatable, Sendable {
    public let name: String
    public let value: String
    public let timestampRaw: String?
    public let timestamp: Date?
    public let staleness: Double
    public let category: SignalCatalogPanelCategory

    public var id: String {
        name
    }

    /// Whether the row carries a usable timestamp (web `!!signal.timestamp`).
    public var hasTimestamp: Bool {
        timestampRaw != nil
    }

    public init(
        name: String,
        value: String,
        timestampRaw: String?,
        timestamp: Date?,
        staleness: Double,
        category: SignalCatalogPanelCategory
    ) {
        self.name = name
        self.value = value
        self.timestampRaw = timestampRaw
        self.timestamp = timestamp
        self.staleness = staleness
        self.category = category
    }
}

// MARK: - Filter + sort model (web `useState` filter/sort modes)

/// The three filter modes (web `CatalogFilterMode`). `stale` keeps both the
/// `stale` and `never` categories; `active` keeps only `active`.
public enum SignalCatalogPanelFilterMode: String, Sendable, CaseIterable {
    case all
    case stale
    case active
}

/// The three sort modes (web `CatalogSortMode`). `staleness` is descending
/// (most stale first, never-received `.infinity` ahead of all); `alpha` is name
/// ascending; `category` is the rank order (never → stale → active).
public enum SignalCatalogPanelSortMode: String, Sendable, CaseIterable {
    case staleness
    case alpha
    case category
}

// MARK: - Summary (web StatCard counts)

/// The four summary counts the top StatCards render (web `signals.length`,
/// `activeCount`, `staleCount`, `neverCount`).
public struct SignalCatalogPanelSummary: Equatable, Sendable {
    public let total: Int
    public let active: Int
    public let stale: Int
    public let never: Int

    public init(total: Int, active: Int, stale: Int, never: Int) {
        self.total = total
        self.active = active
        self.stale = stale
        self.never = never
    }

    /// The empty summary (no cached snapshot) — all zeroes.
    public static let zero = SignalCatalogPanelSummary(total: 0, active: 0, stale: 0, never: 0)
}

// MARK: - Projection

/// The unfiltered projection produced from a snapshot: the normalized rows plus
/// the precomputed summary counts. The view model applies the live search +
/// filter mode + sort on top of `rows` for display, mirroring the web
/// `signals` → `filtered` `useMemo` chain.
public struct SignalCatalogPanelProjection: Equatable, Sendable {
    public let rows: [SignalCatalogPanelRow]
    public let summary: SignalCatalogPanelSummary

    public init(rows: [SignalCatalogPanelRow], summary: SignalCatalogPanelSummary) {
        self.rows = rows
        self.summary = summary
    }

    /// Whether any signal is cached (web `signals.length === 0`).
    public var hasData: Bool {
        !rows.isEmpty
    }

    /// An empty projection (no cached snapshot).
    public static let empty = SignalCatalogPanelProjection(rows: [], summary: .zero)
}
