//
//  StickyCompactHero.Model.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  collapsed-on-scroll hero bar.
//
//    • StickyCompactHeroStrings — resolves the surface's copy + accessibility wording by key with the web
//      English fallback so the Swift sources hold no hardcoded prose. The shipped entries back the five
//      status headlines (web `SHORT_HEADLINE`) and the three `aria-label`s the web inlines (region,
//      scroll-to-top, refresh) plus the spoken "Refreshing" value.
//
//    • StickyCompactHeroTelemetry — the `view.opened` diagnostics seam; the default logs via `os.Logger`
//      and the production app injects the shared-core sink.
//
//    • StickyCompactHeroModel — the @MainActor @Observable state-holder (the native peer of the web
//      component's `useState(visible)` + the `IntersectionObserver` effect). It owns one
//      ``StickyCompactHeroConfig`` (the props, which a live page rebinds as the status / last-checked label
//      / refreshing flag change), takes the latest scroll geometry the SwiftUI scroll reader feeds it,
//      derives the resolved ``StickyCompactHeroPresentation`` through the pure projection (so visibility +
//      copy live in one tested place, not the view), routes the refresh tap out through the page-supplied
//      `onRefresh` (ignored while a refresh is in flight, the native peer of the web `disabled={refreshing}`
//      guard), and emits `view.opened` once. SwiftUI observation replaces React's re-render: a view reading
//      `presentation` redraws when the geometry crosses the visibility threshold or a prop changes — and
//      the model skips the write when the resolved value is unchanged, so a scroll tick that does not flip
//      visibility invalidates no observer. No networking lives in the view; the model is purely in-process
//      (the web bar reads no remote data — it only observes a scroll position and renders its props).
//

import CoreGraphics
import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "StickyCompactHero" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the projection deterministic.
public enum StickyCompactHeroStrings {
    public static let table = "StickyCompactHero"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The surface's i18n closure — routes the headline + `aria-label` lookups through the same facade so
    /// they localize alongside the rest of the catalog. `@Sendable` for the Foundation-only core under
    /// strict concurrency.
    public static let localize: StickyCompactHeroLocalize = { key, fallback in
        string(key, fallback)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol StickyCompactHeroTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogStickyCompactHeroTelemetry: StickyCompactHeroTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - StickyCompactHeroModel (P1/S8) — web `useState(visible)` + IntersectionObserver effect

/// The compact hero bar's state-holder — the native peer of the web component's `visible` state plus the
/// `IntersectionObserver` effect that drives it, the bound props, and the `onRefresh` handler. It owns the
/// current ``StickyCompactHeroConfig``, accepts the latest scroll geometry from the SwiftUI scroll reader,
/// derives the resolved ``StickyCompactHeroPresentation`` through the pure projection, routes the refresh
/// tap out through the page closure, and emits `view.opened` once. Reading `presentation` inside a view
/// body registers an observation dependency, so the bar redraws when visibility flips or a prop changes —
/// and only then, because ``updateGeometry(_:)`` / ``update(_:onRefresh:)`` skip the write when the
/// resolved presentation is unchanged (no spurious invalidation, the parity of React re-rendering only
/// when the output changes).
@MainActor
@Observable
public final class StickyCompactHeroModel {
    /// The resolved, view-ready presentation (web per-tick render decision). Starts hidden — the bar is
    /// `null` until the hero scrolls above the viewport (web `useState(false)`).
    public private(set) var presentation: StickyCompactHeroPresentation

    @ObservationIgnored private var config: StickyCompactHeroConfig
    @ObservationIgnored private var geometry: StickyCompactHeroGeometry
    @ObservationIgnored private var onRefresh: (@MainActor () -> Void)?
    @ObservationIgnored private let telemetry: any StickyCompactHeroTelemetry
    @ObservationIgnored private let localize: StickyCompactHeroLocalize
    @ObservationIgnored private var didEmitOpen = false

    public init(
        config: StickyCompactHeroConfig,
        onRefresh: (@MainActor () -> Void)? = nil,
        telemetry: any StickyCompactHeroTelemetry = OSLogStickyCompactHeroTelemetry(),
        localize: @escaping StickyCompactHeroLocalize = StickyCompactHeroStrings.localize
    ) {
        self.config = config
        geometry = .initial
        self.onRefresh = onRefresh
        self.telemetry = telemetry
        self.localize = localize
        presentation = StickyCompactHeroProjection.resolve(
            config: config,
            geometry: .initial,
            localize: localize
        )
    }

    /// The config this model renders — exposed so the view + tests can read the bound props.
    public var configuration: StickyCompactHeroConfig {
        config
    }

    /// `true` when the bar currently renders — web `visible`.
    public var isVisible: Bool {
        presentation.isVisible
    }

    /// Feeds the latest scroll geometry from the SwiftUI scroll reader — the native peer of one
    /// `IntersectionObserver` callback tick. Recomputes the resolved presentation and publishes it only
    /// when it actually changed, so a scroll update that does not flip visibility invalidates no observer.
    public func updateGeometry(_ geometry: StickyCompactHeroGeometry) {
        self.geometry = geometry
        republish()
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props (a live
    /// page rebinds the status, the last-checked label, or the refreshing flag). The closure is always
    /// refreshed (it is recreated each parent render); the resolved presentation re-derives over the new
    /// config + the latest geometry and publishes only when it changed.
    public func update(_ config: StickyCompactHeroConfig, onRefresh: (@MainActor () -> Void)?) {
        self.config = config
        self.onRefresh = onRefresh
        republish()
    }

    /// Routes a refresh tap out through the page-supplied `onRefresh` — the web `onClick={onRefresh}`.
    /// Ignored while a refresh is in flight, the native peer of the web `disabled={refreshing}` guard, so a
    /// double-tap never fires a second in-flight refresh.
    public func refresh() {
        guard config.hasRefresh, !config.refreshing else { return }
        onRefresh?()
    }

    /// Emits `view.opened` once (P1/S11). Idempotent across the SwiftUI appear / disappear churn — the
    /// event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: StickyCompactHeroSurface.slug)
    }

    /// Re-derives the resolved presentation over the current config + geometry and publishes it only when
    /// it changed (the parity of React re-rendering only when the output differs).
    private func republish() {
        let next = StickyCompactHeroProjection.resolve(
            config: config,
            geometry: geometry,
            localize: localize
        )
        guard next != presentation else { return }
        presentation = next
    }
}
