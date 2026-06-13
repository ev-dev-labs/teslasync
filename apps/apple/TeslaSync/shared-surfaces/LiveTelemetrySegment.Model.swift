//
//  LiveTelemetrySegment.Model.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  The state-holder (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the footer
//  live-telemetry segment. The view binds through ``LiveTelemetrySegmentModel``; no networking lives in
//  the view. The web `LiveTelemetrySegment` subscribes to `useLiveConnection()` (a singleton over
//  `sseManager`) and re-renders on every wire-state change / heartbeat. The native model keeps the same
//  contract: it subscribes to a ``LiveTelemetrySegmentSource``, stores the latest snapshot, exposes the
//  pure resolved view-state for a given `iconOnly` flag, and emits the `view.opened` diagnostics event
//  exactly once when the surface first appears (the segment always presents one of the four statuses —
//  there is no pre-content gate — so the first appearance is the open moment).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated
/// + redacted there). The slug is a static, non-identifying constant.
public protocol LiveTelemetrySegmentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogLiveTelemetrySegmentTelemetry: LiveTelemetrySegmentTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves a localized string by key with an English fallback, so the views and the projection hold no
/// hardcoded user-facing literals.
public typealias LiveTelemetrySegmentResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the web English fallback. The keys mirror the web
/// `t('statusBar.live.*', …)` calls plus the compact age unit forms the web `ageSecondsLabel` hard-codes.
/// Keys live in the "LiveTelemetrySegment" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum LiveTelemetrySegmentStrings {
    public static let table = "LiveTelemetrySegment"

    public static let string: LiveTelemetrySegmentResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a ``LiveTelemetrySegmentSource``, stores the latest
/// snapshot, projects it to the resolved view-state for a requested `iconOnly` flag (the relative clock,
/// locale, and string facade are injected so the freshness stamp is deterministic under test), emits
/// `view.opened` once, and forwards `refresh()` to the source.
@MainActor
@Observable
public final class LiveTelemetrySegmentModel {
    public private(set) var snapshot: LiveConnectionSnapshot

    @ObservationIgnored private let source: any LiveTelemetrySegmentSource
    @ObservationIgnored private let telemetry: any LiveTelemetrySegmentTelemetry
    @ObservationIgnored private let strings: LiveTelemetrySegmentResolve
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any LiveTelemetrySegmentSource,
        telemetry: any LiveTelemetrySegmentTelemetry = OSLogLiveTelemetrySegmentTelemetry(),
        strings: @escaping LiveTelemetrySegmentResolve = LiveTelemetrySegmentStrings.string,
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

    /// The resolved view-state for the segment — a pure function of the current snapshot, the `iconOnly`
    /// flag, and the injected clock / locale / strings. Reading `snapshot` here registers the SwiftUI
    /// observation, so the segment re-renders on every wire-state change / heartbeat (the web re-render).
    public func resolved(iconOnly: Bool) -> LiveTelemetrySegmentResolved {
        LiveTelemetrySegmentProjection.resolve(
            snapshot: snapshot,
            iconOnly: iconOnly,
            now: clock(),
            locale: locale,
            strings: strings
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent across the
    /// SwiftUI appear / disappear churn — a later `start()` after `stop()` does not re-emit.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: LiveTelemetrySegmentMeta.surfaceSlug)
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
