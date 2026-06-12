//
//  PageHeaderSticky.Model.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  page-header sticky bar.
//
//    • PageHeaderStickyStrings — resolves the surface's accessibility wording by key with the English
//      fallback so the Swift sources hold no hardcoded prose. The web component is anonymous (each page
//      passes its own `ariaLabel`); the shipped entries back the localized " — scroll to top" suffix the
//      button label composes and the DEBUG inspector copy.
//
//    • PageHeaderStickyTelemetry — the `view.opened` diagnostics seam; the default logs via `os.Logger`
//      and the production app injects the shared-core sink.
//
//    • PageHeaderStickyModel — the @MainActor @Observable state-holder (the native peer of the web
//      component's `useState(visible)` + the `IntersectionObserver` effect). It pins one config, takes
//      the latest scroll geometry the SwiftUI scroll reader feeds it, derives the resolved
//      ``PageHeaderStickyPresentation`` through the pure projection (so visibility lives in one tested
//      place, not the view), and emits `view.opened` once. SwiftUI observation replaces React's
//      re-render: a view reading `presentation` redraws when the geometry crosses the visibility
//      threshold — and the model skips the write when the resolved value is unchanged, so a scroll tick
//      that does not flip visibility invalidates no observer (the parity of React only re-rendering when
//      `visible` actually changes). No networking lives in the view; the model is purely in-process
//      (the web bar reads no remote data — it only observes a scroll position).
//

import CoreGraphics
import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "PageHeaderSticky" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the projection deterministic.
public enum PageHeaderStickyStrings {
    public static let table = "PageHeaderSticky"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The surface's i18n closure — routes the label lookups through the same facade so they localize
    /// alongside the rest of the catalog. `@Sendable` for the Foundation-only core under strict
    /// concurrency.
    public static let localize: PageHeaderStickyLocalize = { key, fallback in
        string(key, fallback)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PageHeaderStickyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPageHeaderStickyTelemetry: PageHeaderStickyTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - PageHeaderStickyModel (P1/S8) — web `useState(visible)` + IntersectionObserver effect

/// The sticky bar's state-holder — the native peer of the web component's `visible` state plus the
/// `IntersectionObserver` effect that drives it. It pins one ``PageHeaderStickyConfig``, accepts the
/// latest scroll geometry from the SwiftUI scroll reader, derives the resolved
/// ``PageHeaderStickyPresentation`` through the pure projection, and emits `view.opened` once. Reading
/// `presentation` inside a view body registers an observation dependency, so the bar redraws when
/// visibility flips — and only then, because ``updateGeometry(_:)`` skips the write when the resolved
/// presentation is unchanged (no spurious invalidation, the parity of React re-rendering only when
/// `visible` changes).
@MainActor
@Observable
public final class PageHeaderStickyModel {
    @ObservationIgnored private let config: PageHeaderStickyConfig
    @ObservationIgnored private let telemetry: any PageHeaderStickyTelemetry
    @ObservationIgnored private let localize: PageHeaderStickyLocalize
    @ObservationIgnored private var didEmitOpen = false

    /// The resolved, view-ready presentation (web per-tick render decision). Starts hidden — the bar is
    /// `null` until the hero scrolls above the viewport (web `useState(false)`).
    public private(set) var presentation: PageHeaderStickyPresentation

    public init(
        config: PageHeaderStickyConfig,
        telemetry: any PageHeaderStickyTelemetry = OSLogPageHeaderStickyTelemetry(),
        localize: @escaping PageHeaderStickyLocalize = PageHeaderStickyStrings.localize
    ) {
        self.config = config
        self.telemetry = telemetry
        self.localize = localize
        presentation = PageHeaderStickyProjection.resolve(
            config: config,
            geometry: .initial,
            localize: localize
        )
    }

    /// The config this model renders — exposed so the view + tests can read the bound props.
    public var configuration: PageHeaderStickyConfig {
        config
    }

    /// Feeds the latest scroll geometry from the SwiftUI scroll reader — the native peer of one
    /// `IntersectionObserver` callback tick. Recomputes the resolved presentation and publishes it only
    /// when it actually changed, so a scroll update that does not flip visibility invalidates no observer.
    public func updateGeometry(_ geometry: PageHeaderStickyGeometry) {
        let next = PageHeaderStickyProjection.resolve(
            config: config,
            geometry: geometry,
            localize: localize
        )
        guard next != presentation else { return }
        presentation = next
    }

    /// `true` when the bar currently renders — web `visible`.
    public var isVisible: Bool {
        presentation.isVisible
    }

    /// Emits `view.opened` once (P1/S11). Idempotent across the SwiftUI appear / disappear churn — the
    /// event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: PageHeaderStickySurface.slug)
    }
}
