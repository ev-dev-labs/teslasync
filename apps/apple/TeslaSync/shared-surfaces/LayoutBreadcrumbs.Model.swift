//
//  LayoutBreadcrumbs.Model.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11) and the state-holder (P1/S8) for the global
//  Layout breadcrumb row. The web `LayoutBreadcrumbs` is a function of two inputs: the merged override map
//  (`useBreadcrumbOverrides()`, owned by the sibling `BreadcrumbOverridesState`) and the current route
//  (`useBreadcrumbs` reading `useLocation().pathname`). This surface owns the second input: the
//  ``LayoutBreadcrumbsModel`` binds a ``LayoutBreadcrumbsSource``, stores the live pathname, and projects
//  the trail through the catalog — the native peer of the route subscription that re-runs the web hook.
//  It emits `view.opened` once. No networking lives in the view; the only seam is the in-process route
//  source (the web route also comes from the in-memory router, never the wire).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The web composition is anonymous (it renders no copy of its own), so the shipped
/// entries here back the breadcrumb-row container's accessibility label (the native peer of the web
/// `<nav aria-label>` at the composition level — the trail renderer carries its own a11y wording in the
/// sibling table) and the DEBUG inspector copy the previews + view-composition tests render. The route
/// labels themselves resolve through ``routeLabel`` against the APP catalog (web `t(meta.i18nKey,
/// meta.defaultLabel)`), since `routes.*` keys live in the app's master catalog, not this surface's table.
public enum LayoutBreadcrumbsStrings {
    public static let table = "LayoutBreadcrumbs"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `Text`-friendly overload for SwiftUI call sites.
    public static func text(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }

    /// Accessibility label for the breadcrumb-row container — the composition-level peer of the web
    /// `<nav aria-label="Breadcrumb">`.
    public static var rowA11y: String {
        string("layoutBreadcrumbs.a11y.row", "Breadcrumb")
    }

    /// Resolves a route's label from its i18n key + English fallback — web `t(meta.i18nKey,
    /// meta.defaultLabel)`. It targets the app's default catalog (`tableName: nil`) because route keys
    /// (`routes.*`) are owned by the app's master catalog, not this surface's table; in test / preview
    /// bundles `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
    public static let routeLabel: BreadcrumbOverridesLocalize = { key, fallback in
        NSLocalizedString(key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol LayoutBreadcrumbsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogLayoutBreadcrumbsTelemetry: LayoutBreadcrumbsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - LayoutBreadcrumbsModel (P1/S8) — web LayoutBreadcrumbs route input

/// The state-holder bound by ``LayoutBreadcrumbs`` — it owns the live route input the web composition
/// reads through `useBreadcrumbs(useLocation())`. It binds a ``LayoutBreadcrumbsSource``, stores the
/// latest pathname, projects the resolved trail for a supplied override map, and emits `view.opened`
/// once. Reading ``pathname`` (via ``resolvedTrail(overrides:)``) inside a view body registers an
/// observation dependency, so the row redraws when the route changes — the native parity of the web hook
/// re-running on a `location.pathname` change.
@MainActor
@Observable
public final class LayoutBreadcrumbsModel {
    @ObservationIgnored private let source: any LayoutBreadcrumbsSource
    @ObservationIgnored private let table: BreadcrumbOverridesRouteTable
    @ObservationIgnored private let localize: BreadcrumbOverridesLocalize
    @ObservationIgnored private let telemetry: any LayoutBreadcrumbsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// The current route pathname (web `useLocation().pathname`). Re-projected whenever the source emits.
    public private(set) var pathname: String

    public init(
        source: any LayoutBreadcrumbsSource,
        table: BreadcrumbOverridesRouteTable = LayoutBreadcrumbsRouteCatalog.table,
        localize: @escaping BreadcrumbOverridesLocalize = LayoutBreadcrumbsStrings.routeLabel,
        telemetry: any LayoutBreadcrumbsTelemetry = OSLogLayoutBreadcrumbsTelemetry(),
        initialPath: String = "/"
    ) {
        self.source = source
        self.table = table
        self.localize = localize
        self.telemetry = telemetry
        pathname = initialPath
    }

    /// The resolved trail for the current route + supplied merged overrides — web
    /// `useBreadcrumbs(useBreadcrumbOverrides())`. The view passes the merged overrides it reads from the
    /// environment (the sibling ``BreadcrumbOverridesState``), so the override and route axes compose
    /// exactly as the two web hooks do.
    public func resolvedTrail(overrides: BreadcrumbOverrideMap) -> BreadcrumbOverridesTrailResolved {
        LayoutBreadcrumbsProjection.resolve(table: table, path: pathname, overrides: overrides, localize: localize)
    }

    /// Begins observing the route and emits `view.opened` once. Idempotent across the SwiftUI appear /
    /// disappear churn — the event fires a single time per model instance, never again on a re-appear.
    public func start() {
        guard !started else { return }
        started = true
        source.onUpdate = { [weak self] path in self?.pathname = path }
        source.start()
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: LayoutBreadcrumbsSurface.slug)
        }
    }

    /// Stops observing the route. Keeps the last known pathname so a transient disappear leaves the
    /// breadcrumb stable when the row re-appears.
    public func stop() {
        source.onUpdate = nil
        source.stop()
        started = false
    }
}
