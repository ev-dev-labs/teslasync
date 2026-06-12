//
//  SignalQueryControls.Adapter.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The pure, Foundation-only data layer for the Signal Query Controls surface — the SwiftUI parity
//  of components/SignalQueryControls.tsx. Everything here is view-free + dependency-free so the
//  backend → table-row adapter (the web `adaptSignalHistoryPoint` / `adaptSignalHistoryResp`), the
//  cached snapshots the state-holder coalesces, and the surface identity are all unit tested in
//  isolation (and in the dual-SDK build) without rendering a view or touching the network.
//
//  Parity note: the `/signals/{vid}/{name}/history` endpoint returns the Phase-42 typed shape
//  `{ts, kind, value}` whose `value` is discriminated by `kind`; the rest of the telemetry table was
//  built for `{created_at, value_num/str/bool}` rows. `adaptSignalHistoryPoint` reproduces the web
//  helper exactly so the table never renders an "Invalid Date" axis or an all-"—" column.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). Kept here
/// (SwiftUI-free) so the state-holder can emit telemetry without depending on the view layer.
public enum SignalQueryControlsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "SignalQueryControls"
}

// MARK: - Backend value (web `SignalHistoryPoint['value']` union)

/// The discriminated value carried by one history point — the native mirror of the web
/// `number | boolean | string | null` payload narrowed by `typeof`. The `kind` discriminator rides
/// alongside on ``SignalHistoryPoint``; this models only the value so the adapter switches on it.
public enum SignalHistoryValue: Equatable, Sendable {
    case number(Double)
    case bool(Bool)
    case string(String)
    case null
}

// MARK: - Backend history point + envelope (web `SignalHistoryPoint` / `SignalHistoryResp`)

/// One Phase-42 typed history point — the native mirror of `{ ts, kind, value }`. `ts` is the ISO
/// instant the adapter passes through verbatim into `created_at` (the Invalid-Date regression guard).
public struct SignalHistoryPoint: Equatable, Sendable {
    public let ts: String
    public let kind: String
    public let value: SignalHistoryValue

    public init(ts: String, kind: String, value: SignalHistoryValue) {
        self.ts = ts
        self.kind = kind
        self.value = value
    }
}

/// The `/signals/{vid}/{name}/history` envelope — the native mirror of `SignalHistoryResp`. Every
/// field is optional so a partial / missing response (web `{}`) faithfully adapts to `[]`, and the
/// envelope-level `signal` is stamped onto every produced row (web `resp.signal ?? ''`).
public struct SignalHistoryResp: Equatable, Sendable {
    public var vehicleID: Int64?
    public var signal: String?
    public var expectedKind: String?
    public var from: String?
    public var to: String?
    public var count: Int?
    public var data: [SignalHistoryPoint]?

    public init(
        vehicleID: Int64? = nil,
        signal: String? = nil,
        expectedKind: String? = nil,
        from: String? = nil,
        to: String? = nil,
        count: Int? = nil,
        data: [SignalHistoryPoint]? = nil
    ) {
        self.vehicleID = vehicleID
        self.signal = signal
        self.expectedKind = expectedKind
        self.from = from
        self.to = to
        self.count = count
        self.data = data
    }
}

// MARK: - Table row (web `SignalLogEntry`)

/// One table-renderable signal row — the native mirror of the web `SignalLogEntry`. Exactly one of
/// the three typed values is non-nil for a present reading; an all-nil row is the typed "null" cell.
public struct SignalLogEntry: Equatable, Sendable, Identifiable {
    public let createdAt: String
    public let signal: String
    public let valueNum: Double?
    public let valueStr: String?
    public let valueBool: Bool?

    public init(
        createdAt: String,
        signal: String,
        valueNum: Double? = nil,
        valueStr: String? = nil,
        valueBool: Bool? = nil
    ) {
        self.createdAt = createdAt
        self.signal = signal
        self.valueNum = valueNum
        self.valueStr = valueStr
        self.valueBool = valueBool
    }

    /// Stable identity for `ForEach` / `TSDataTable`: the row's instant + signal name uniquely keys a
    /// reading within a page (the web table keys by its computed row number).
    public var id: String {
        "\(createdAt)#\(signal)"
    }
}

// MARK: - BE → FE adapter (web `adaptSignalHistoryPoint` / `adaptSignalHistoryResp`)

/// The backend → table-row adapter — the native port of the web module's two adapter functions.
public enum SignalQueryHistoryAdapter {
    /// Web `adaptSignalHistoryPoint`: pass `ts` through into `created_at`, then route the discriminated
    /// value into exactly one typed column — a finite number into `value_num` (NaN / ±∞ → nil), a bool
    /// into `value_bool` (including `false`, never collapsed to nil), a string (also the typed Time /
    /// Enum kinds Tesla streams as strings) into `value_str`, and `null` into an all-nil row.
    public static func point(_ point: SignalHistoryPoint, signal: String) -> SignalLogEntry {
        switch point.value {
        case let .number(value):
            SignalLogEntry(
                createdAt: point.ts,
                signal: signal,
                valueNum: value.isFinite ? value : nil
            )
        case let .bool(value):
            SignalLogEntry(createdAt: point.ts, signal: signal, valueBool: value)
        case let .string(value):
            SignalLogEntry(createdAt: point.ts, signal: signal, valueStr: value)
        case .null:
            SignalLogEntry(createdAt: point.ts, signal: signal)
        }
    }

    /// Web `adaptSignalHistoryResp`: `[]` for a nil envelope or a missing `data` array (web
    /// `!Array.isArray`), otherwise every point adapted with the envelope-level `signal`.
    public static func response(_ resp: SignalHistoryResp?) -> [SignalLogEntry] {
        guard let resp, let data = resp.data else { return [] }
        let signal = resp.signal ?? ""
        return data.map { point($0, signal: signal) }
    }
}

// MARK: - Pagination (web `SignalHistoryPagination`)

/// Server-side pagination metadata — the native mirror of the web `SignalHistoryPagination`.
public struct SignalHistoryPagination: Equatable, Sendable {
    public let page: Int
    public let perPage: Int
    public let total: Int
    public let totalPages: Int

    public init(page: Int, perPage: Int, total: Int, totalPages: Int) {
        self.page = page
        self.perPage = perPage
        self.total = total
        self.totalPages = totalPages
    }
}

// MARK: - Connectivity / fetch axes (P4 leaf states)

/// The freshness of the bound available-signals snapshot — the orthogonal connectivity axis rendered
/// as the header chip + banner. `live` hides the banner; `stale` triggers a one-shot auto-refresh.
public enum SignalQueryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

/// The lifecycle of the available-signals fetch (web `useQuery` for `/signals/available`).
public enum SignalQueryAvailableState: Equatable, Sendable {
    case loading
    case loaded
    case error(String)
}

/// The render axis of the results table (web `SignalDataTable` props): the in-flight skeleton, a
/// failed query, a resolved-but-empty result, or the populated rows.
public enum SignalQueryTableState: Equatable, Sendable {
    case loading
    case error(String)
    case empty
    case rows
}

/// The typed value discriminator a cell renders (web `getValueType`).
public enum SignalQueryValueType: String, Sendable, Equatable, CaseIterable {
    case num
    case str
    case bool
    case null
}

// MARK: - Cached snapshots (state-holder inputs)

/// One coalesced snapshot of the available-signals query — the native mirror of the web
/// `useQuery(['signal-available', vehicleId])` result plus the parent surface connectivity.
public struct SignalQueryAvailableSnapshot: Sendable, Equatable {
    public var state: SignalQueryAvailableState
    public var signals: [String]
    public var connection: SignalQueryConnection

    public init(
        state: SignalQueryAvailableState = .loaded,
        signals: [String] = [],
        connection: SignalQueryConnection = .live
    ) {
        self.state = state
        self.signals = signals
        self.connection = connection
    }
}

/// One coalesced snapshot of the executed history query — the rows the parent fetched + adapted and
/// handed to the web `SignalDataTable`, plus its loading flag and server pagination.
public struct SignalQueryResultSnapshot: Sendable, Equatable {
    public var loading: Bool
    public var rows: [SignalLogEntry]
    public var pagination: SignalHistoryPagination
    public var errorMessage: String?

    public init(
        loading: Bool = false,
        rows: [SignalLogEntry] = [],
        pagination: SignalHistoryPagination = SignalHistoryPagination(
            page: 1, perPage: 50, total: 0, totalPages: 0
        ),
        errorMessage: String? = nil
    ) {
        self.loading = loading
        self.rows = rows
        self.pagination = pagination
        self.errorMessage = errorMessage
    }
}

/// The parameters a "Query" submit carries to the source seam — the native mirror of the web parent's
/// `onQuery` closure inputs (the selected signals, the resolved range, and the page size).
public struct SignalQueryRequest: Sendable, Equatable {
    public let signals: [String]
    public let from: Date
    public let to: Date
    public let perPage: Int
    public let page: Int

    public init(signals: [String], from: Date, to: Date, perPage: Int, page: Int) {
        self.signals = signals
        self.from = from
        self.to = to
        self.perPage = perPage
        self.page = page
    }
}
