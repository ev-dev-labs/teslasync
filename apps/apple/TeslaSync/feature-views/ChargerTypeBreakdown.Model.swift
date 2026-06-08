//
//  ChargerTypeBreakdown.Model.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  charging cost-analysis slice (no networking in the view — the web component
//  takes `data` + `totalCost` as props; here a source pushes coalesced snapshots),
//  the P1/S10 i18n facade (`useTranslation`), the formatting facade
//  (`useFormatting` — currency, integer, number, unit), the P1/S11 telemetry
//  contract, and the `@Observable` view-model that resolves the render phase.
//  Previews/tests drive the model with `InMemoryChargerTypeSource`; production
//  wires a source over the shared cost-analysis state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), consent-gated and
/// redacted there.
public protocol ChargerTypeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChargerTypeTelemetry: ChargerTypeTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (P1/S8 — web `useFormatting` + numberFormat)

/// The display-boundary formatting the surface needs, the parity of the web
/// `useFormatting().formatCurrency` plus the `numberFormat` helpers the component
/// calls (`fmtInt`, `fmtNumber`, `fmtWithUnit`). Production injects a
/// settings-backed implementation (currency symbol + precision + locale from
/// `useSettings`); previews/tests use `DefaultChargerTypeFormatting`.
public protocol ChargerTypeFormatting {
    /// Web `formatCurrency(amount, decimals)` — `currencySymbol + fmtNumber(amount, decimals)`.
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    /// Web `fmtInt(value)` — locale-grouped, zero fraction digits.
    func formatInt(_ value: Double) -> String
    /// Web `fmtNumber(value, decimals)` — locale-grouped, fixed fraction digits.
    func formatNumber(_ value: Double, decimals: Int) -> String
    /// Web `fmtWithUnit(value, unit, decimals)` — `fmtNumber(value, decimals) + " " + unit`.
    func formatWithUnit(_ value: Double, unit: String, decimals: Int) -> String
}

public extension ChargerTypeFormatting {
    /// Currency at the web default precision (2), matching the component's call site.
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: `"$"` symbol, grouped thousands, fixed decimals,
/// rounding half-up — the parity of the web `${currencySymbol}${fmtNumber(...)}`
/// with the `$` / precision defaults. Stateless and `Sendable`.
public struct DefaultChargerTypeFormatting: ChargerTypeFormatting, Sendable {
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
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = ChargerTypeNumeric.safe(value)
        let digits = Swift.max(0, decimals)
        return formatter(decimals: digits).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(amount, decimals: decimals)
    }

    public func formatInt(_ value: Double) -> String {
        formatNumber(value, decimals: 0)
    }

    public func formatWithUnit(_ value: Double, unit: String, decimals: Int) -> String {
        "\(formatNumber(value, decimals: decimals)) \(unit)"
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the cost-analysis slice, mirroring the shared
/// `LoadableState` cases a production source projects from the `Resource<T>`.
public enum ChargerTypeStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`,
/// `stale` (older than the freshness window), `offline` (no connectivity — cached
/// values shown). Drives the freshness banner.
public enum ChargerTypeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargerTypeSource`: the resolved breakdown
/// data + total cost plus its load/connection status. The model turns this into
/// the render phase + the projected rows.
public struct ChargerTypeUpdate: Sendable, Equatable {
    public var status: ChargerTypeStatus
    public var connection: ChargerTypeConnection
    public var data: [ChargerTypeDatum]
    public var totalCost: Double
    public var updatedAt: Date?

    public init(
        status: ChargerTypeStatus = .loading,
        connection: ChargerTypeConnection = .live,
        data: [ChargerTypeDatum] = [],
        totalCost: Double = 0,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.totalCost = totalCost
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 cost-analysis state holder; previews/tests use `InMemoryChargerTypeSource`.
/// The view never talks to the network directly.
@MainActor
public protocol ChargerTypeSource: AnyObject {
    var onUpdate: (@MainActor (ChargerTypeUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ChargerTypeSource`, holds
/// the latest data + total cost + freshness, and exposes a render `Phase` plus the
/// pre-computed breakdown rows for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargerTypeModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders
    /// the panel (which owns its own "Not enough data" empty state, matching the
    /// web, which never hides the panel); `loading` is the initial fetch; `error`
    /// is a hard failure with no cached data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargerTypeConnection = .live
    public private(set) var data: [ChargerTypeDatum] = []
    public private(set) var totalCost: Double = 0
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargerTypeSource
    @ObservationIgnored private let telemetry: any ChargerTypeTelemetry
    @ObservationIgnored let formatting: any ChargerTypeFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any ChargerTypeSource,
        telemetry: any ChargerTypeTelemetry = OSLogChargerTypeTelemetry(),
        formatting: any ChargerTypeFormatting = DefaultChargerTypeFormatting(),
        localize: @escaping (String, String) -> String = ChargerTypeBreakdownStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Projections (web memos, recomputed from the current data)

    /// The per-type breakdown rows (web `data.map`).
    public var rows: [ChargerTypeRow] {
        ChargerTypeProjection.rows(data, totalCost: totalCost)
    }

    /// Whether the resolved slice has no rows (web `data.length > 0 ? … : noData`).
    public var isEmpty: Bool {
        data.isEmpty
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargerTypeBreakdown.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream cost-analysis feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached data stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargerTypeUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        data = update.data
        totalCost = update.totalCost
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached data stays visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with no data yet, and the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(_ update: ChargerTypeUpdate) -> Phase {
        let hasData = !update.data.isEmpty
        switch update.status {
        case .loading:
            return hasData ? .loaded : .loading
        case .loaded, .empty:
            return .loaded
        case let .failed(message):
            return hasData ? .loaded : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargerTypeSource: ChargerTypeSource {
    public var onUpdate: (@MainActor (ChargerTypeUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargerTypeUpdate?

    public init(initial: ChargerTypeUpdate? = nil) {
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
    public func push(_ update: ChargerTypeUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargerTypeBreakdown"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings without editing
/// the shared catalog.
public enum ChargerTypeBreakdownStrings {
    public static let table = "ChargerTypeBreakdown"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
