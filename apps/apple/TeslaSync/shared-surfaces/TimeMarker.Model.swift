//
//  TimeMarker.Model.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  alert time-marker. One observable holder lives here:
//
//    • AlertContextModel — the native peer of the web `useAlertContext()` hook. Where the web hook
//      reads `useSearchParams()` and memoizes a derived `AlertContext`, the native holder owns the
//      current drill-through ``TimeMarkerParams`` (handed in by the router seam) and exposes the
//      derived ``TimeMarkerAlertContext`` + the resolved ``TimeMarkerResolved`` marker as observed
//      reads — SwiftUI observation replaces the `useMemo` recompute. It carries no networking; the
//      derivation is the pure ``AlertContextReducer`` / ``TimeMarkerProjection``, so the holder is a
//      thin, testable shell that also emits the surface's single `view.opened` diagnostics event.
//
//  The web `TimeMarker` carries one piece of user-facing copy — the default label "Alert" — which
//  resolves here through the P1/S10 facade; the remaining entries back the DEBUG sample chart used by
//  the previews + view-composition tests.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "TimeMarker" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the projection deterministic.
public enum TimeMarkerStrings {
    public static let table = "TimeMarker"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The default marker label — the web `label = 'Alert'` default, resolved through the facade.
    public static var defaultLabel: String {
        string("timeMarker.label.default", "Alert")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TimeMarkerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTimeMarkerTelemetry: TimeMarkerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - AlertContextModel (P1/S8) — web `useAlertContext()`

/// The drill-through context holder — the native peer of `useAlertContext()`. It owns the current
/// ``TimeMarkerParams`` (the URL the page landed on, handed in by the router seam), derives the
/// ``TimeMarkerAlertContext`` via the pure reducer, projects the resolved marker via the pure
/// projection, and emits `view.opened` once. No networking lives here; the derivation is synchronous,
/// faithfully matching the web hook (`useSearchParams` + `useMemo`, no fetch).
@MainActor
@Observable
public final class AlertContextModel {
    /// The current drill-through params (web `useSearchParams()` snapshot). Updated by the router
    /// seam through ``update(params:)``; reading it (or anything derived from it) registers an
    /// observation dependency, so the chart redraws when the URL changes.
    public private(set) var params: TimeMarkerParams

    @ObservationIgnored private let windowHalfWidth: TimeInterval
    @ObservationIgnored private let telemetry: any TimeMarkerTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        params: TimeMarkerParams = .none,
        windowHalfWidth: TimeInterval = AlertContextReducer.windowHalfWidth,
        telemetry: any TimeMarkerTelemetry = OSLogTimeMarkerTelemetry()
    ) {
        self.params = params
        self.windowHalfWidth = windowHalfWidth
        self.telemetry = telemetry
    }

    /// The derived drill-through context (web `useAlertContext()` return value).
    public var context: TimeMarkerAlertContext {
        AlertContextReducer.resolve(params, windowHalfWidth: windowHalfWidth)
    }

    /// `true` when at least one drill-through param is present (web `hasContext`) — the convenience
    /// flag pages use to show a "viewing alert context" affordance.
    public var hasContext: Bool {
        context.hasContext
    }

    /// The localized default marker label (web `label = 'Alert'`).
    public var defaultLabel: String {
        TimeMarkerStrings.defaultLabel
    }

    /// The resolved marker for the current context — derives the x from the context's parsed
    /// timestamp and applies the alert's `severity` (default `.warn`) + label (default the localized
    /// "Alert"). The result is ``TimeMarkerResolved/hidden`` when no parseable timestamp is present.
    public func resolvedMarker(
        severity: MarkerSeverity = .markerDefault,
        label: String? = nil,
        strokeWidth: Double = 2,
        dashPattern: [Double]? = nil
    ) -> TimeMarkerResolved {
        TimeMarkerProjection.resolve(
            context: context,
            severity: severity,
            label: label ?? defaultLabel,
            strokeWidth: strokeWidth,
            dashPattern: dashPattern
        )
    }

    /// Replaces the drill-through params — the native peer of the URL changing under
    /// `useSearchParams()` (e.g. the user opening a different alert). Reassigns only when the params
    /// actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(params: TimeMarkerParams) {
        guard params != self.params else { return }
        self.params = params
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per model instance, never again on a
    /// later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: TimeMarkerSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear
    /// lifecycle; the once-only `view.opened` contract is preserved (a later ``start()`` does not
    /// re-emit).
    public func stop() {
        started = false
    }
}
