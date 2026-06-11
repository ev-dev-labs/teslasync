//
//  ChargingTab.Model.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + formatting seam
//  (web `useFormatting`) + i18n facade (P1/S10). The view binds through `ChargingTabModel`;
//  no networking lives in the view. SwiftUI parity of
//  features/analytics/components/analytics/ChargingTab.tsx — the analytics "Charging" tab that
//  shows six summary cards (sessions / energy / cost / avg power / avg duration / charge
//  efficiency) and three charts (charger-types donut / start-battery distribution / hourly
//  pattern). The web component takes `data: FleetAnalytics` as a prop and reads `useTranslation`
//  + `useFormatting`; the native surface is fed coalesced snapshots by a `ChargingTabSource` and
//  formats currency / numbers through the injected `ChargingTabFormatting`, so every load state
//  is rendered and the cards/charts read off a single projection.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol ChargingTabTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogChargingTabTelemetry: ChargingTabTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (P1/S8 — web `useFormatting` + numberFormat.ts)

/// The display-boundary formatting the surface needs: locale-grouped numbers (web `fmtNumber`),
/// integers (web `fmtInt`), and currency (web `formatCurrency(amount, 2)` — `currencySymbol +
/// fmtNumber`). Production injects a settings-backed implementation (currency symbol + precision
/// + locale from `useSettings`); previews/tests use `DefaultChargingTabFormatting`.
public protocol ChargingTabFormatting {
    func formatNumber(_ value: Double, decimals: Int) -> String
    func formatInt(_ value: Double) -> String
    func formatCurrency(_ amount: Double, decimals: Int) -> String
}

public extension ChargingTabFormatting {
    /// Currency at the web default precision (2), matching the card call site.
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: locale-grouped thousands, fixed decimals, rounding half-up
/// (`Intl.NumberFormat` parity), with a `"$"` currency symbol prefix — the parity of the web
/// `${currencySymbol}${fmtNumber(...)}` with the `$` / precision defaults. Stateless + `Sendable`.
public struct DefaultChargingTabFormatting: ChargingTabFormatting, Sendable {
    private let currencySymbol: String
    private let localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
    }

    private func formatter(decimals: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = Swift.max(0, decimals)
        formatter.maximumFractionDigits = Swift.max(0, decimals)
        formatter.roundingMode = .halfUp
        return formatter
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = ChargingTabNumeric.safe(value)
        return formatter(decimals: decimals).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatInt(_ value: Double) -> String {
        formatNumber(value, decimals: 0)
    }

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(amount, decimals: decimals)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the charging-analytics query, mirroring the shared `LoadableState`
/// cases the web page projects from the analytics hook (web `isLoading` skeleton / resolved
/// payload / empty / failure).
public enum ChargingTabLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached cards/charts are clearly labeled while reconnecting / offline.
public enum ChargingTabConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargingTabSource`: the query's load status + payload + the
/// (shared) connection freshness.
public struct ChargingTabUpdate: Sendable, Equatable {
    public var status: ChargingTabLoadStatus
    public var analytics: ChargingTabAnalyticsInput?
    public var refreshing: Bool
    public var connection: ChargingTabConnection
    public var updatedAt: Date?

    public init(
        status: ChargingTabLoadStatus = .loading,
        analytics: ChargingTabAnalyticsInput? = nil,
        refreshing: Bool = false,
        connection: ChargingTabConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.analytics = analytics
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — projecting the fleet analytics query (web `useFleetAnalytics().data`) into the
/// charging slice. Previews + tests use `InMemoryChargingTabSource`. The view never talks to the
/// network directly.
@MainActor
public protocol ChargingTabSource: AnyObject {
    var onUpdate: (@MainActor (ChargingTabUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-queries the analytics source (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ChargingTabSource`, projects the payload
/// into the view-ready `ChargingTabProjection`, and exposes a single render `ChargingTabPhase` plus
/// freshness for SwiftUI to switch over. Currency / number formatting + the i18n facade are held
/// here so the view stays declarative.
@MainActor
@Observable
public final class ChargingTabModel {
    public private(set) var phase: ChargingTabPhase = .loading
    public private(set) var projection: ChargingTabProjection = .empty
    public private(set) var connection: ChargingTabConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored let formatting: any ChargingTabFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let source: any ChargingTabSource
    @ObservationIgnored private let telemetry: any ChargingTabTelemetry
    @ObservationIgnored private var lastAnalytics: ChargingTabAnalyticsInput?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ChargingTabSource,
        telemetry: any ChargingTabTelemetry = OSLogChargingTabTelemetry(),
        formatting: any ChargingTabFormatting = DefaultChargingTabFormatting(),
        localize: @escaping (String, String) -> String = ChargingTabStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether any payload has arrived (drives skeleton vs. content + cached-stays-visible).
    public var hasLoaded: Bool {
        lastAnalytics != nil
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingTab.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-queries the analytics source (web `refetch()` / retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargingTabUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        if let analytics = update.analytics {
            lastAnalytics = analytics
        }
        projection = ChargingTabProjection.make(from: lastAnalytics)
        phase = ChargingTabProjection.resolvePhase(update.status, hasLoaded: hasLoaded)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: ChargingTabConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargingTabSource: ChargingTabSource {
    public var onUpdate: (@MainActor (ChargingTabUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingTabUpdate?

    public init(initial: ChargingTabUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: ChargingTabUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension ChargingTab {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "ChargingTab"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "ChargingTab" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings without editing the shared catalog.
public enum ChargingTabStrings {
    public static let table = "ChargingTab"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
