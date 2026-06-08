//
//  DetailCards.Model.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  drivetrain-health slice (no networking in the view — the web component takes
//  `health` / `peakPower` / `avgPowerMax` / `minRegenPower` / `stats` as props;
//  here a source pushes coalesced snapshots), the unit-aware formatting facade
//  (web `useUnits().formatTemperature` / `formatEnergy` + the `numberFormat`
//  helpers `fmtInt` / `fmtNumber`), the P1/S10 i18n facade (`useTranslation`), the
//  P1/S11 telemetry contract, and the `@Observable` view-model that resolves the
//  render phase. Previews/tests drive the model with `InMemoryDetailCardsSource`;
//  production wires a source over the shared drivetrain-health state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated and
/// redacted there.
public protocol DetailCardsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogDetailCardsTelemetry: DetailCardsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (web `useUnits` + numberFormat)

/// The display-boundary formatting the surface needs: the unit-aware temperature
/// and energy formatters (web `useUnits().formatTemperature` / `formatEnergy`,
/// which convert from SI to the user's preferred unit) plus the plain
/// locale-grouped number helpers the component calls (web `fmtInt` / `fmtNumber`).
/// Production injects a settings-backed implementation; previews/tests use
/// `DefaultDetailCardsFormatting`.
public protocol DetailCardsFormatting {
    /// Web `useUnits().formatTemperature(celsius, { precision })` — SI Celsius in,
    /// user-unit string out, em dash for absent input.
    func formatTemperature(_ celsius: Double?, precision: Int?) -> String
    /// Web `useUnits().formatEnergy(wh, { precision })` — SI watt-hours in,
    /// user-unit string out, em dash for absent input.
    func formatEnergy(_ wattHours: Double?, precision: Int?) -> String
    /// Web `fmtInt(value)` — locale-grouped, zero fraction digits.
    func formatInt(_ value: Double) -> String
    /// Web `fmtNumber(value, decimals)` — locale-grouped, fixed fraction digits.
    func formatNumber(_ value: Double, decimals: Int) -> String
}

/// Bundle-free default formatter that reproduces the web SI converters for the
/// metric defaults (`useUnits` falls back to `°C` and `kWh`): temperature renders
/// with no space before the degree unit (web typographic convention), energy
/// converts watt-hours to kilowatt-hours with a spaced unit, and both return the em
/// dash for nullish / non-finite input. Plain numbers group thousands at a fixed
/// decimal count, rounding half away from zero (the `Intl.NumberFormat` default).
/// Stateless and `Sendable`.
public struct DefaultDetailCardsFormatting: DetailCardsFormatting, Sendable {
    private let temperatureUnit: String
    private let energyUnit: String
    private let localeIdentifier: String
    private let settingsPrecision: Int?
    private let emptyDisplay: String

    /// Web `DEFAULT_PRECISION.temperature`.
    private static let temperatureFallbackPrecision = 1
    /// Web `DEFAULT_PRECISION.energy`.
    private static let energyFallbackPrecision = 2

    public init(
        temperatureUnit: String = "°C",
        energyUnit: String = "kWh",
        localeIdentifier: String = "en_US",
        settingsPrecision: Int? = nil,
        emptyDisplay: String = "—"
    ) {
        self.temperatureUnit = temperatureUnit
        self.energyUnit = energyUnit
        self.localeIdentifier = localeIdentifier
        self.settingsPrecision = settingsPrecision
        self.emptyDisplay = emptyDisplay
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

    /// Web `resolvePrecision(pref, override, fallback)`: per-call override wins, then
    /// the settings precision, then the per-quantity default.
    private func resolvePrecision(_ override: Int?, fallback: Int) -> Int {
        if let override, override >= 0 { return override }
        if let settingsPrecision, settingsPrecision >= 0 { return settingsPrecision }
        return fallback
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = DetailCardsNumeric.safe(value)
        let digits = Swift.max(0, decimals)
        return formatter(decimals: digits).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatInt(_ value: Double) -> String {
        formatNumber(value, decimals: 0)
    }

    public func formatTemperature(_ celsius: Double?, precision: Int?) -> String {
        guard let celsius, celsius.isFinite else { return emptyDisplay }
        let digits = resolvePrecision(precision, fallback: Self.temperatureFallbackPrecision)
        let converted = convertTemperature(celsius)
        return "\(formatNumber(converted, decimals: digits))\(temperatureUnit)"
    }

    public func formatEnergy(_ wattHours: Double?, precision: Int?) -> String {
        guard let wattHours, wattHours.isFinite else { return emptyDisplay }
        let digits = resolvePrecision(precision, fallback: Self.energyFallbackPrecision)
        let converted = convertEnergy(wattHours)
        return "\(formatNumber(converted, decimals: digits)) \(energyUnit)"
    }

    /// Web `convertTempFromSI`: identity for `°C`, the Fahrenheit transform for `°F`.
    private func convertTemperature(_ celsius: Double) -> Double {
        temperatureUnit == "°F" ? celsius * 9 / 5 + 32 : celsius
    }

    /// Web `convertEnergyFromSI`: watt-hours for `Wh`, watt-hours / 1000 for `kWh`.
    private func convertEnergy(_ wattHours: Double) -> Double {
        energyUnit == "Wh" ? wattHours : wattHours / 1000
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the drivetrain-health slice, mirroring the shared
/// `LoadableState` cases a production source projects from the `Resource<T>`.
public enum DetailCardsStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`,
/// `stale` (older than the freshness window), `offline` (no connectivity — cached
/// values shown). Drives the freshness banner.
public enum DetailCardsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DetailCardsSource`: the drivetrain-health
/// data, the derived power figures (kilowatts), and the aggregate driving stats,
/// plus its load / connection status. The model turns this into the render phase +
/// the projected card rows. Mirrors the web component's prop set.
public struct DetailCardsUpdate: Sendable, Equatable {
    public var status: DetailCardsStatus
    public var connection: DetailCardsConnection
    public var health: DetailCardsHealth?
    public var peakPower: Double
    public var avgPowerMax: Double
    public var minRegenPower: Double
    public var stats: DetailCardsStats?
    public var updatedAt: Date?

    public init(
        status: DetailCardsStatus = .loading,
        connection: DetailCardsConnection = .live,
        health: DetailCardsHealth? = nil,
        peakPower: Double = 0,
        avgPowerMax: Double = 0,
        minRegenPower: Double = 0,
        stats: DetailCardsStats? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.health = health
        self.peakPower = peakPower
        self.avgPowerMax = avgPowerMax
        self.minRegenPower = minRegenPower
        self.stats = stats
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 drivetrain-health state holder; previews/tests use
/// `InMemoryDetailCardsSource`. The view never talks to the network directly.
@MainActor
public protocol DetailCardsSource: AnyObject {
    var onUpdate: (@MainActor (DetailCardsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DetailCardsSource`, holds
/// the latest health / power / stats + freshness, and exposes a render `Phase` plus
/// the pre-computed card rows for SwiftUI to switch over.
@MainActor
@Observable
public final class DetailCardsModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders the
    /// two cards (which self-fill each row with an em dash when a value is absent,
    /// matching the web, which never hides them); `loading` is the initial fetch
    /// with nothing cached yet; `error` is a hard failure with no cached data.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DetailCardsConnection = .live
    public private(set) var health: DetailCardsHealth?
    public private(set) var peakPower: Double = 0
    public private(set) var avgPowerMax: Double = 0
    public private(set) var minRegenPower: Double = 0
    public private(set) var stats: DetailCardsStats?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DetailCardsSource
    @ObservationIgnored private let telemetry: any DetailCardsTelemetry
    @ObservationIgnored let formatting: any DetailCardsFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any DetailCardsSource,
        telemetry: any DetailCardsTelemetry = OSLogDetailCardsTelemetry(),
        formatting: any DetailCardsFormatting = DefaultDetailCardsFormatting(),
        localize: @escaping (String, String) -> String = DetailCardsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Projections (web card bodies, recomputed from the current snapshot)

    /// The "Temperature Details" card rows (web first `KVList`).
    public var temperatureRows: [DetailCardRow] {
        DetailCardsProjection.temperatureRows(health) { celsius in
            formatting.formatTemperature(celsius, precision: nil)
        }
    }

    /// The "Power Summary" card rows (web second `KVList`).
    public var powerRows: [DetailCardRow] {
        DetailCardsProjection.powerRows(
            figures: DetailCardsPowerFigures(
                peakPowerKw: peakPower,
                avgPowerMaxKw: avgPowerMax,
                minRegenPowerKw: minRegenPower
            ),
            stats: stats,
            formatting: formatting,
            units: DetailCardsUnitLabels(
                power: localize("drivetrain.detailCards.unitKw", "kW"),
                mass: localize("drivetrain.detailCards.unitKg", "kg")
            )
        )
    }

    /// Whether every row would resolve to the em dash (web data all absent).
    public var isEmpty: Bool {
        DetailCardsProjection.isEmpty(
            health: health,
            peakPower: peakPower,
            avgPowerMax: avgPowerMax,
            minRegenPower: minRegenPower,
            stats: stats
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DetailCards.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream drivetrain-health feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached data stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DetailCardsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        health = update.health
        peakPower = update.peakPower
        avgPowerMax = update.avgPowerMax
        minRegenPower = update.minRegenPower
        stats = update.stats
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached data stays visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with nothing cached, and the hard-error state only when a
    /// failure arrives with no content to render.
    public static func resolvePhase(_ update: DetailCardsUpdate) -> Phase {
        let hasContent = update.health != nil
            || update.stats != nil
            || update.peakPower != 0
            || update.avgPowerMax != 0
            || update.minRegenPower != 0
        switch update.status {
        case .loading:
            return hasContent ? .loaded : .loading
        case .loaded, .empty:
            return .loaded
        case let .failed(message):
            return hasContent ? .loaded : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDetailCardsSource: DetailCardsSource {
    public var onUpdate: (@MainActor (DetailCardsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DetailCardsUpdate?

    public init(initial: DetailCardsUpdate? = nil) {
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
    public func push(_ update: DetailCardsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "DetailCards" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; kept per-surface so
/// each parallel prompt owns its own strings without editing the shared catalog.
public enum DetailCardsStrings {
    public static let table = "DetailCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
