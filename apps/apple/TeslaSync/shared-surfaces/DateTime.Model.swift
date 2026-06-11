//
//  DateTime.Model.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  input snapshot for the datetime renderer. The view binds through `DateTimeModel`; no networking
//  lives in the view. The web `DateTime` is a near-pure renderer — its only subscriptions are
//  `useSettings()` + `useTimezone()` (which itself reads `useSelectedVehicle()` + `useSettings()`),
//  used to resolve the IANA zone + locale when `in` / `showTz` is set. The native model keeps the
//  same contract: a source emits the current value + the resolved formatting context (locale, the
//  vehicle's zone, the user's override, the default mode) plus the parent's loading / error /
//  connectivity state, and the projection derives the render phase so the view is a pure function of
//  the resolved state.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DateTimeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDateTimeTelemetry: DateTimeTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound formatting-context feed — the orthogonal connectivity axis rendered as
/// the freshness chip. `live` hides the chip; `stale` / `offline` show it while the last value stays
/// visible.
public enum DateTimeConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web value + useSettings + useTimezone context)

/// One coalesced snapshot of the renderer's inputs — the native mirror of the web `value` + `variant`
/// + `in` + `showTz` props plus the `useSettings()` / `useTimezone()` context (the locale, the active
/// vehicle's IANA zone, the user's override, and the default mode) and the parent's lifecycle
/// (`isLoading`, an error message, connectivity). A value type, so it is `Sendable` & `Equatable`.
public struct DateTimeInput: Sendable, Equatable {
    public var value: DateTimeValue
    public var variant: DateTimeVariant
    public var mode: TimeZoneMode?
    public var showTimeZone: Bool
    public var locale: String
    public var vehicleTimeZone: String?
    public var userTimeZoneOverride: String?
    public var defaultMode: TimeZoneMode
    public var deviceTimeZone: String
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: DateTimeConnection

    public init(
        value: DateTimeValue = .absent,
        variant: DateTimeVariant = .full,
        mode: TimeZoneMode? = nil,
        showTimeZone: Bool = false,
        locale: String = "",
        vehicleTimeZone: String? = nil,
        userTimeZoneOverride: String? = nil,
        defaultMode: TimeZoneMode = .vehicle,
        deviceTimeZone: String = TimeZone.current.identifier,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: DateTimeConnection = .live
    ) {
        self.value = value
        self.variant = variant
        self.mode = mode
        self.showTimeZone = showTimeZone
        self.locale = locale
        self.vehicleTimeZone = vehicleTimeZone
        self.userTimeZoneOverride = userTimeZoneOverride
        self.defaultMode = defaultMode
        self.deviceTimeZone = deviceTimeZone
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `DateTimeSource`, recomputes the resolved
/// projection, exposes a render `phase`, the resolved view-state, and the `connection` axis, emits
/// `view.opened` once, and auto-refreshes once when the context feed transitions to stale.
@MainActor
@Observable
public final class DateTimeModel {
    public private(set) var resolved: DateTimeResolved
    public private(set) var connection: DateTimeConnection = .live

    public var phase: DateTimeResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any DateTimeSource
    @ObservationIgnored private let telemetry: any DateTimeTelemetry
    @ObservationIgnored private var input: DateTimeInput?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DateTimeSource,
        telemetry: any DateTimeTelemetry = OSLogDateTimeTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = DateTimeProjection.resolve(DateTimeInput(isLoading: true))
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DateTime.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream context snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: DateTimeInput) {
        self.input = input
        connection = input.connection
        recompute()
        handleAutoRefresh(for: input.connection)
    }

    private func recompute() {
        guard let input else { return }
        resolved = DateTimeProjection.resolve(input)
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes (the cached value stays shown).
    private func handleAutoRefresh(for connection: DateTimeConnection) {
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

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "DateTime" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum DateTimeStrings {
    public static let table = "DateTime"

    public static let string: DateTimeResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
