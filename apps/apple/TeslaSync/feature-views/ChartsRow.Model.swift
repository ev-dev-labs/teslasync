//
//  ChartsRow.Model.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the charging
//  charts slice (no networking in the view — the web `ChartsRow` takes the three
//  arrays as props; here a source pushes coalesced snapshots), the P1/S10 i18n facade
//  (`useTranslation`), the display-boundary formatting facade (web `fmtNumber` /
//  `fmtWithUnit` + the literal `$` currency), the P1/S11 telemetry contract, and the
//  `@Observable` view-model that resolves the render phase. Previews/tests drive the
//  model with `InMemoryChartsRowSource`; production wires a source over the shared
//  charging state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default logs
/// via `os.Logger`; production injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), consent-gated + redacted there.
public protocol ChartsRowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChartsRowTelemetry: ChartsRowTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (display boundary — web `fmtNumber` / `fmtWithUnit`)

/// The display-boundary formatting the surface needs: locale-grouped fixed-decimal
/// numbers (web `fmtNumber(v)` — precision 2 by default) and a `$`-prefixed currency
/// (web `${fmtNumber(v)}`). Production injects a settings-backed implementation
/// (precision + locale from `useSettings`); previews/tests use the default.
public protocol ChartsRowFormatting {
    func formatNumber(_ value: Double, decimals: Int) -> String
    func formatCurrency(_ value: Double, decimals: Int) -> String
}

public extension ChartsRowFormatting {
    /// Number at the web default precision (2), matching the surface's call sites.
    func formatNumber(_ value: Double) -> String {
        formatNumber(value, decimals: 2)
    }

    /// Currency at the web default precision (2).
    func formatCurrency(_ value: Double) -> String {
        formatCurrency(value, decimals: 2)
    }

    /// "<number> <unit>" (web `fmtWithUnit(v, unit)` — `${fmtNumber(v)} ${unit}`).
    func formatWithUnit(_ value: Double, unit: String, decimals: Int = 2) -> String {
        "\(formatNumber(value, decimals: decimals)) \(unit)"
    }
}

/// Bundle-free default formatter: locale-grouped thousands, fixed decimals, rounding
/// half-up, with a `"$"` currency prefix — the parity of the web `fmtNumber` /
/// `${currencySymbol}${fmtNumber(...)}` with the `en-US` / precision-2 / `$` defaults.
/// Stateless and `Sendable`.
public struct DefaultChartsRowFormatting: ChartsRowFormatting, Sendable {
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
        let safe = ChartsRowNumeric.safe(value)
        let number = formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: safe))
        return number ?? "0"
    }

    public func formatCurrency(_ value: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(value, decimals: decimals)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the charts slice, mirroring the shared `LoadableState` cases
/// a production source projects from the charging `Resource<T>`.
public enum ChartsRowStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`, `stale`
/// (older than the freshness window), `offline` (no connectivity — cached values
/// shown). Drives the freshness banner.
public enum ChartsRowConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChartsRowSource`: the resolved charts data plus
/// its load/connection status. The model turns this into the render phase.
public struct ChartsRowUpdate: Sendable, Equatable {
    public var status: ChartsRowStatus
    public var connection: ChartsRowConnection
    public var data: ChartsRowData?
    public var updatedAt: Date?

    public init(
        status: ChartsRowStatus = .loading,
        connection: ChartsRowConnection = .live,
        data: ChartsRowData? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// charging state holder; previews/tests use `InMemoryChartsRowSource`. The view never
/// talks to the network directly.
@MainActor
public protocol ChartsRowSource: AnyObject {
    var onUpdate: (@MainActor (ChartsRowUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ChartsRowSource`, holds the
/// latest charts data + freshness, and exposes a render `Phase` plus the pre-computed
/// projections (trend scale, donut) for SwiftUI to switch over.
@MainActor
@Observable
public final class ChartsRowModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders both
    /// panels (each owns its own empty state, matching the web, which never hides a
    /// panel); `loading` is the initial fetch; `error` is a hard failure with no cached
    /// data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChartsRowConnection = .live
    public private(set) var data = ChartsRowData()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChartsRowSource
    @ObservationIgnored private let telemetry: any ChartsRowTelemetry
    @ObservationIgnored let formatting: any ChartsRowFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any ChartsRowSource,
        telemetry: any ChartsRowTelemetry = OSLogChartsRowTelemetry(),
        formatting: any ChartsRowFormatting = DefaultChartsRowFormatting(),
        localize: @escaping (String, String) -> String = ChartsRowStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Panel projections (web memos, recomputed from the current data)

    /// The energy & cost trend points (web `energyTrend` prop).
    public var energyTrend: [ChartsRowEnergyPoint] {
        data.energyTrend
    }

    /// The shared y-domain scale for the trend chart (web single `<YAxis/>`).
    public var energyScale: ChartsRowEnergyScale {
        ChartsRowProjection.energyScale(data.energyTrend)
    }

    /// The projected donut shares (web `chargerBreakdown` prop → `<Pie/>`).
    public var donut: ChartsRowDonut {
        ChartsRowProjection.donut(data.chargerBreakdown)
    }

    /// The cost-by-type legend rows (web `costByType` prop).
    public var costByType: [ChartsRowCostRow] {
        data.costByType
    }

    /// Whether the resolved data has nothing to render in either panel.
    public var isEmpty: Bool {
        data.isEmpty
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChartsRow.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream charts feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached data stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChartsRowUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let payload = update.data {
            data = payload
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached data stays visible behind a refresh / failure
    /// (freshness reflected by the banner); the skeleton shows only on the initial fetch
    /// with nothing yet, and the hard-error state only when a failure arrives with
    /// nothing cached to render.
    public static func resolvePhase(_ update: ChartsRowUpdate) -> Phase {
        let hasData = (update.data?.isEmpty == false)
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
public final class InMemoryChartsRowSource: ChartsRowSource {
    public var onUpdate: (@MainActor (ChartsRowUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChartsRowUpdate?

    public init(initial: ChartsRowUpdate? = nil) {
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
    public func push(_ update: ChartsRowUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ChartsRow" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings without editing the shared catalog.
public enum ChartsRowStrings {
    public static let table = "ChartsRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
