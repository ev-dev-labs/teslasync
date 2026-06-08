//
//  LiveSignalSparklinesWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
//
//  Foundation-only value types ported from the web source
//  (features/dashboard/widgets/LiveSignalSparklinesWidget.tsx): the cached DTO
//  inputs (live values + per-signal history), the row/list projection the view
//  renders, the load/connection/freshness/phase enums, and the i18n string
//  resolver. Kept transport- and SwiftUI-free so the adapter (Builder) and these
//  types compile + run headless in the executed unit harness.
//

import Foundation

// MARK: - Cached DTO inputs (port of the web hook payloads)

/// A single live signal value as delivered by `useSignalGaps`
/// (`signals[name].value`, an `unknown`). The wire value is numeric, string, or
/// boolean; the adapter coerces it to a display number the same way the web
/// `extractNumericValue` does.
public enum LiveSignalValue: Sendable, Equatable {
    case number(Double)
    case text(String)
    case bool(Bool)
}

/// One point from `useSignalHistory(...).data`. Only `valueNum` is needed for the
/// sparkline; it is optional/non-finite-tolerant, mirroring the web
/// `p.valueNum != null && isFinite(v)` filter.
public struct SignalHistorySample: Sendable, Equatable {
    public var valueNum: Double?

    public init(valueNum: Double?) {
        self.valueNum = valueNum
    }
}

// MARK: - Projection (what the SwiftUI rows render)

/// Sparkline trend, derived by comparing the first- and last-quarter averages of
/// the history window (port of the web `trend` memo).
public enum SignalTrend: String, Sendable, Equatable {
    case up
    case down
    case flat
}

/// The projected state of one signal row: display name, current value, the
/// numeric sparkline series, whether a sparkline can be drawn (≥ 2 points), the
/// trend, and the palette color index. A 1:1 port of the web `SignalSparklineRow`
/// derived state.
public struct SignalRowProjection: Sendable, Equatable, Identifiable {
    public var signal: String
    public var displayName: String
    public var currentValue: Double?
    public var points: [Double]
    public var hasSparkline: Bool
    public var trend: SignalTrend
    public var colorIndex: Int

    public var id: String {
        signal
    }

    public init(
        signal: String,
        displayName: String,
        currentValue: Double?,
        points: [Double],
        hasSparkline: Bool,
        trend: SignalTrend,
        colorIndex: Int
    ) {
        self.signal = signal
        self.displayName = displayName
        self.currentValue = currentValue
        self.points = points
        self.hasSparkline = hasSparkline
        self.trend = trend
        self.colorIndex = colorIndex
    }
}

// MARK: - Load lifecycle / freshness / phase

/// The data load lifecycle, mirroring the shared `LoadableState` the production
/// source projects from `Resource<T>` (signals + live gaps combined).
public enum SignalLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness band (ADR-013). The web has no explicit offline state;
/// `offline` is the native addition required by the surface's state matrix and is
/// reflected in the freshness chip + a cached banner.
public enum SignalConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status, a port of the web `DataFreshness` four-state model
/// (`fresh`/`fetching`/`stale`/`error`) extended with `offline`.
public enum SignalFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The mutually-exclusive render branches of the widget shell: the web shows the
/// skeleton on the initial fetch, the empty state when no signals resolve, and the
/// row list otherwise (errors/staleness ride along in the chip).
public enum SignalRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by a `LiveSignalSparklinesSource`: the cached inputs plus
/// their load/connection status. The adapter turns this into `[SignalRowProjection]`.
public struct LiveSignalSparklinesUpdate: Sendable, Equatable {
    public var status: SignalLoadStatus
    public var connection: SignalConnection
    public var isFetching: Bool
    public var isError: Bool
    public var vehicleID: Int?
    public var availableSignals: [String]
    public var configuredSignals: [String]?
    public var liveValues: [String: LiveSignalValue]
    public var histories: [String: [SignalHistorySample]]
    public var updatedAt: Date?

    public init(
        status: SignalLoadStatus = .loading,
        connection: SignalConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        vehicleID: Int? = nil,
        availableSignals: [String] = [],
        configuredSignals: [String]? = nil,
        liveValues: [String: LiveSignalValue] = [:],
        histories: [String: [SignalHistorySample]] = [:],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.vehicleID = vehicleID
        self.availableSignals = availableSignals
        self.configuredSignals = configuredSignals
        self.liveValues = liveValues
        self.histories = histories
        self.updatedAt = updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web `t(key, default)` English
/// fallback, so neither the adapter nor the view holds hardcoded literals. Keys
/// live in the "LiveSignalSparklinesWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The SwiftUI `text(_:_:)`
/// convenience lives in the Model file so this half stays Foundation-only (and the
/// adapter harness can resolve a11y/label copy headless).
public enum LiveSignalSparklinesStrings {
    public static let table = "LiveSignalSparklinesWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
