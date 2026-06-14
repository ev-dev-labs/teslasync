//
//  Breadcrumbs.Model.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the state-holder (P1/S8) for the breadcrumb
//  trail. The web `Breadcrumbs` is a pure function of its props plus `useTranslation`: it renders the
//  passed `items` and resolves two accessibility strings (`a11y.breadcrumb`, `a11y.breadcrumbHome`). This
//  surface mirrors that exactly — the only "data source" is translation, so the model simply holds the
//  host-supplied items + the optional Home accessibility-label override and projects them through the pure
//  ``BreadcrumbsProjection`` for the active size class. It emits `view.opened` once. No networking lives in
//  the view; the items arrive as props just as they do on the web.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no hardcoded
/// prose — the native peer of the web `t(key, default)`. `Breadcrumbs.tsx` renders no body copy of its own;
/// its only user-facing strings are the two accessibility labels (`a11y.breadcrumb` for the `<nav>` and
/// `a11y.breadcrumbHome` for the leading Home link), kept here under this surface's table with the same
/// keys + English fallbacks the web uses. The remaining "sample" entries back the DEBUG inspector the
/// previews + view-composition tests render; they are never shipped. Entries fold into the app
/// `Localizable.xcstrings` master catalog at integration time; in test / preview bundles
/// `NSLocalizedString` returns the `value:` fallback, keeping the resolution deterministic.
public enum BreadcrumbsStrings {
    public static let table = "Breadcrumbs"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `Text`-friendly overload for SwiftUI call sites.
    public static func text(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }

    /// Accessibility label for the breadcrumb container — the peer of the web `<nav aria-label>` resolving
    /// `t('a11y.breadcrumb', 'Breadcrumb')`.
    public static var navLabel: String {
        string("a11y.breadcrumb", "Breadcrumb")
    }

    /// Default accessibility label for the leading Home link — the peer of the web `homeAriaLabel ??
    /// t('a11y.breadcrumbHome', 'Dashboard')`. A caller-supplied override wins (web `homeAriaLabel`).
    public static var homeLabel: String {
        string("a11y.breadcrumbHome", "Dashboard")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol BreadcrumbsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBreadcrumbsTelemetry: BreadcrumbsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - BreadcrumbsModel (P1/S8) — web Breadcrumbs `items` prop

/// The state-holder bound by ``Breadcrumbs`` — it owns the input the web component reads through its
/// `items` prop. It stores the host-supplied items + the optional Home accessibility-label override (web
/// `homeAriaLabel`), projects them into the resolved crumbs for a supplied size class, and emits
/// `view.opened` once. Reading ``items`` (via ``resolved(isCompact:)``) inside a view body registers an
/// observation dependency, so the row redraws when the host pushes new items — the native parity of the
/// web component re-rendering on a prop change.
@MainActor
@Observable
public final class BreadcrumbsModel {
    /// The current breadcrumb input items (web `items`). Re-projected whenever the host pushes new items.
    public private(set) var items: [BreadcrumbsItem]

    /// The optional Home-link accessibility override (web `homeAriaLabel`); `nil` falls back to the
    /// localized ``BreadcrumbsStrings/homeLabel``.
    public let homeAccessibilityLabel: String?

    @ObservationIgnored private let telemetry: any BreadcrumbsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        items: [BreadcrumbsItem] = [],
        homeAccessibilityLabel: String? = nil,
        telemetry: any BreadcrumbsTelemetry = OSLogBreadcrumbsTelemetry()
    ) {
        self.items = items
        self.homeAccessibilityLabel = homeAccessibilityLabel
        self.telemetry = telemetry
    }

    /// Pushes a new set of items — the native peer of the web component receiving a new `items` prop. A
    /// consumer reading ``resolved(isCompact:)`` redraws on the change.
    public func update(items: [BreadcrumbsItem]) {
        self.items = items
    }

    /// The resolved render decision for the current items + the active horizontal size class — the native
    /// peer of `<Breadcrumbs>` deciding what to draw (suppression, current leaf, compact collapse).
    public func resolved(isCompact: Bool) -> BreadcrumbsResolved {
        BreadcrumbsProjection.resolve(items: items, isCompact: isCompact)
    }

    /// Emits `view.opened` once. Idempotent across the SwiftUI appear / disappear churn — the event fires a
    /// single time per model instance, never again on a re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: BreadcrumbsSurface.slug)
        }
    }

    /// Marks the model inactive. Keeps the last items so a transient disappear leaves the trail stable when
    /// the row re-appears.
    public func stop() {
        started = false
    }
}
