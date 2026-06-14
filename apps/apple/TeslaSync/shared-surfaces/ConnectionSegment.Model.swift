//
//  ConnectionSegment.Model.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The state-holder (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the footer
//  API-connection segment. The view binds through ``ConnectionSegmentModel``; no networking lives in the
//  view. The web `ConnectionSegment` subscribes to `useApiHealth()` (a `useQuery` polling `/healthz`) and
//  re-renders on every reading. The native model keeps the same contract: it subscribes to a
//  ``ConnectionSegmentSource``, stores the latest snapshot, exposes the pure resolved view-state for a given
//  `iconOnly` flag (the relative clock + the string facade are injected so the freshness branch is
//  deterministic under test), emits the `view.opened` diagnostics event exactly once, forwards `refresh()`,
//  and re-probes on appear when the cached reading has aged out (the native peer of the web hook refetching
//  when its data is stale after a backgrounded pause).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol ConnectionSegmentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogConnectionSegmentTelemetry: ConnectionSegmentTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views and the projection
/// hold no hardcoded user-facing literals. Keys live in the "ConnectionSegment" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns its
/// own strings. In test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the
/// labels deterministic.
public enum ConnectionSegmentStrings {
    public static let table = "ConnectionSegment"

    public static let string: ConnectionSegmentResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a ``ConnectionSegmentSource`` (the native peer of the
/// web `useApiHealth` `useQuery`), stores the latest snapshot, projects it to the resolved view-state for a
/// requested `iconOnly` flag (the relative clock + the string facade are injected so the freshness stamp is
/// deterministic under test), emits `view.opened` once, forwards `refresh()` to the source, and re-probes
/// when the cached reading has aged out.
@MainActor
@Observable
public final class ConnectionSegmentModel {
    public private(set) var snapshot: ConnectionSegmentSnapshot

    @ObservationIgnored private let source: any ConnectionSegmentSource
    @ObservationIgnored private let telemetry: any ConnectionSegmentTelemetry
    @ObservationIgnored private let strings: ConnectionSegmentResolve
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any ConnectionSegmentSource,
        telemetry: any ConnectionSegmentTelemetry = OSLogConnectionSegmentTelemetry(),
        strings: @escaping ConnectionSegmentResolve = ConnectionSegmentStrings.string,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        self.clock = clock
        snapshot = .initial
        source.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    /// The resolved view-state for the segment — a pure function of the current snapshot, the `iconOnly`
    /// flag, and the injected clock / strings. Reading `snapshot` here registers the SwiftUI observation,
    /// so the segment re-renders on every reading (the web re-render).
    public func resolved(iconOnly: Bool) -> ConnectionSegmentResolved {
        ConnectionSegmentProjection.resolve(
            snapshot: snapshot,
            iconOnly: iconOnly,
            now: clock(),
            strings: strings
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent across the
    /// SwiftUI appear / disappear churn — a later `start()` after `stop()` does not re-emit. Also re-probes
    /// when the cached reading is stale, so a foregrounded segment refreshes immediately (the segment always
    /// presents one of the four statuses, so the first appearance is the open moment).
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ConnectionSegmentSurface.slug)
        }
        source.start()
        refreshIfStale()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream probe (host-driven manual refresh / the offline retry affordance).
    public func refresh() {
        source.refresh()
    }

    /// Re-probes only when the cached reading has aged past the staleness window — the native peer of the
    /// web hook refetching stale data. Injectable `now` keeps it deterministic under test; the default
    /// reads the injected clock. Called on appear and safe for a host to drive on a foreground notification.
    public func refreshIfStale(now: Date? = nil) {
        if ConnectionSegmentProjection.isStale(snapshot: snapshot, now: now ?? clock()) {
            source.refresh()
        }
    }
}
