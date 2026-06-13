//
//  TimeStamp.Model.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  input snapshot for the timestamp renderer. The view binds through `TimeStampModel`; no networking
//  lives in the view. The web `TimeStamp` is a near-pure renderer — its only subscriptions are
//  `useTimeFormatPreference()` (the `time_format_default` preference) + `useDateFormat(mode)` (which
//  reads `useSettings()` + `useTimezone()` to resolve the locale + IANA zone). The native model keeps
//  the same contract: a source emits the current value + the resolved formatting context (the
//  preference, the locale, the vehicle's zone, the user's override, the default mode) plus the
//  parent's loading / error / connectivity state, and the projection derives the render phase so the
//  view is a pure function of the resolved state.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TimeStampTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTimeStampTelemetry: TimeStampTelemetry {
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
public enum TimeStampConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web value + preference + useDateFormat context)

/// One coalesced snapshot of the renderer's inputs — the native mirror of the web `value` + `format`
/// + `in` props plus the `useTimeFormatPreference()` / `useDateFormat()` context (the preference, the
/// locale, the active vehicle's IANA zone, the user's override, and the default mode) and the
/// parent's lifecycle (`isLoading`, an error message, connectivity). A value type, so it is
/// `Sendable` & `Equatable`.
public struct TimeStampInput: Sendable, Equatable {
    public var value: TimeStampValue
    public var format: TimeStampFormat
    public var mode: TimeStampTzMode?
    public var preference: TimeStampPreference
    public var locale: String
    public var vehicleTimeZone: String?
    public var userTimeZoneOverride: String?
    public var defaultMode: TimeStampTzMode
    public var deviceTimeZone: String
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TimeStampConnection

    public init(
        value: TimeStampValue = .absent,
        format: TimeStampFormat = .auto,
        mode: TimeStampTzMode? = nil,
        preference: TimeStampPreference = .relative,
        locale: String = "",
        vehicleTimeZone: String? = nil,
        userTimeZoneOverride: String? = nil,
        defaultMode: TimeStampTzMode = .vehicle,
        deviceTimeZone: String = TimeZone.current.identifier,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TimeStampConnection = .live
    ) {
        self.value = value
        self.format = format
        self.mode = mode
        self.preference = preference
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

/// The surface's observable view-model. Subscribes to a `TimeStampSource`, recomputes the resolved
/// projection, exposes a render `phase`, the resolved view-state, and the `connection` axis, emits
/// `view.opened` once, and auto-refreshes once when the context feed transitions to stale.
@MainActor
@Observable
public final class TimeStampModel {
    public private(set) var resolved: TimeStampResolved
    public private(set) var connection: TimeStampConnection = .live

    public var phase: TimeStampResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any TimeStampSource
    @ObservationIgnored private let telemetry: any TimeStampTelemetry
    @ObservationIgnored private var input: TimeStampInput?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TimeStampSource,
        telemetry: any TimeStampTelemetry = OSLogTimeStampTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = TimeStampProjection.resolve(TimeStampInput(isLoading: true))
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: TimeStamp.surfaceSlug)
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

    private func apply(_ input: TimeStampInput) {
        self.input = input
        connection = input.connection
        recompute()
        handleAutoRefresh(for: input.connection)
    }

    private func recompute() {
        guard let input else { return }
        resolved = TimeStampProjection.resolve(input)
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes (the cached value stays shown).
    private func handleAutoRefresh(for connection: TimeStampConnection) {
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
/// hardcoded literals. Keys live in the "TimeStamp" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum TimeStampStrings {
    public static let table = "TimeStamp"

    public static let string: TimeStampResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
