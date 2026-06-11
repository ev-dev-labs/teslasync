//
//  LiveIndicator.Model.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  The state-holder (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  live-pipeline-health indicator. The view binds through `LiveIndicatorModel`; no networking lives
//  in the view. The web `LiveIndicator` subscribes to `useLiveConnection()` (a singleton over
//  `sseManager`) and re-renders on every wire-state change / heartbeat. The native model keeps the
//  same contract: it subscribes to a `LiveIndicatorSource`, stores the latest snapshot, exposes the
//  pure resolved view-state for a given variant, and emits the `view.opened` diagnostics event
//  exactly once when the surface first appears (the indicator always presents one of the four
//  statuses — there is no pre-content gate — so the first appearance is the open moment).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol LiveIndicatorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogLiveIndicatorTelemetry: LiveIndicatorTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves a localized string by key with an English fallback, so the views and the projection hold
/// no hardcoded user-facing literals.
public typealias LiveIndicatorResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the web English fallback. The keys mirror the web
/// `t('live.connected', 'Live')` calls plus the relative-time phrases the web `formatRelativeTime`
/// hard-codes. Keys live in the "LiveIndicator" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum LiveIndicatorStrings {
    public static let table = "LiveIndicator"

    public static let string: LiveIndicatorResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `LiveIndicatorSource`, stores the latest
/// snapshot, projects it to the resolved view-state for a requested variant (the relative clock,
/// locale, and string facade are injected so the freshness stamp is deterministic under test), emits
/// `view.opened` once, and forwards `refresh()` to the source.
@MainActor
@Observable
public final class LiveIndicatorModel {
    public private(set) var snapshot: LiveConnectionSnapshot

    @ObservationIgnored private let source: any LiveIndicatorSource
    @ObservationIgnored private let telemetry: any LiveIndicatorTelemetry
    @ObservationIgnored private let strings: LiveIndicatorResolve
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any LiveIndicatorSource,
        telemetry: any LiveIndicatorTelemetry = OSLogLiveIndicatorTelemetry(),
        strings: @escaping LiveIndicatorResolve = LiveIndicatorStrings.string,
        locale: Locale = .autoupdatingCurrent,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        self.locale = locale
        self.clock = clock
        snapshot = LiveConnectionSnapshot()
        source.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    /// The resolved view-state for a variant — a pure function of the current snapshot and the
    /// injected clock / locale / strings. Reading `snapshot` here registers the SwiftUI observation,
    /// so the indicator re-renders on every wire-state change / heartbeat (the web re-render).
    public func resolved(variant: LiveIndicatorVariant) -> LiveIndicatorResolved {
        LiveIndicatorProjection.resolve(
            snapshot: snapshot,
            variant: variant,
            now: clock(),
            locale: locale,
            strings: strings
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: LiveIndicatorMeta.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (used by hosts that offer a manual reconnect affordance).
    public func refresh() {
        source.refresh()
    }
}
