//
//  WidgetMapView.Model.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  map primitive. The web `<WidgetMapView>` is purely presentational: it takes its data as plain props
//  and renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own
//  is the current ``WidgetMapInput`` (the props, observed so a rebind re-renders), the derived
//  ``WidgetMapProjection`` as an observed read (SwiftUI observation replaces the React re-render), and the
//  single `view.opened` diagnostics event. No networking, no SwiftUI, and no MapKit live here.
//
//  The web source renders exactly one copy string of its own — the empty-leaf default
//  `emptyMessage = 'No location data available'` (a literal, not a `t()` call). It is resolved here
//  through the P1/S10 facade with that English fallback, alongside the native a11y / HIG additions (the
//  empty-leaf supporting hint and the map's VoiceOver label), so the Swift sources hold no hardcoded
//  prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetMapView" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum WidgetMapViewStrings {
    public static let table = "WidgetMapView"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-leaf headline — the web default `emptyMessage = 'No location data available'` (the
    /// surface's only own copy). The host may override it via the view's `emptyMessage` prop.
    public static var emptyMessage: String {
        string("widgetMapView.empty", "No location data available")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG; the web
    /// renders a single `<EmptyState>` line).
    public static var emptyHint: String {
        string("widgetMapView.emptyHint", "Location appears here once a position is available.")
    }

    /// VoiceOver label for the map canvas (native a11y addition; the web map element is unlabeled).
    public static var accessibilityLabel: String {
        string("widgetMapView.accessibilityLabel", "Map showing the selected location")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant — never PII such as
/// the map center.
public protocol WidgetMapViewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event
/// carrying only the public surface slug.
public struct OSLogWidgetMapViewTelemetry: WidgetMapViewTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetMapViewModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetMapInput`` (the web props), derives
/// the pure ``WidgetMapProjection`` as an observed read (SwiftUI observation replaces the React
/// re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher, so
/// neither does this holder — the map content slot lives at the view layer, not here.
@MainActor
@Observable
public final class WidgetMapViewModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetMapInput

    @ObservationIgnored private let telemetry: any WidgetMapViewTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetMapInput,
        telemetry: any WidgetMapViewTelemetry = OSLogWidgetMapViewTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetMapProjection {
        WidgetMapViewProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetMapInput) {
        if input != self.input {
            self.input = input
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: WidgetMapViewSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
