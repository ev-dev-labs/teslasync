//
//  BottomTabBar.Model.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  bottom tab bar. The web `<BottomTabBar>` reads two sources — `useLocation` (the current pathname) and
//  `useTranslation` (the labels) — and renders; there is no fetcher, so the native peer needs no data
//  state-holder. What the holder DOES own is the bound props (the current route + the tab list, exposed as the
//  derived ``BottomTabBarProjection``), the page-supplied navigation closure (the web `<PrefetchLink to=>`
//  peer, kept here so the value types stay closure-free + `Equatable`), and the single `view.opened`
//  diagnostics event. No networking lives here.
//
//  The web source's strings ARE i18n keys (`nav.quickNav`, `nav.dashboard`, …) — they are mirrored verbatim in
//  the "BottomTabBar" table so the native bar localizes alongside the rest of the catalog. The only native
//  addition is the empty-catalog leaf copy (the "never a blank box" peer of a tab list with nothing to show).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys mirror the web `nav.*` namespace verbatim; they live in the "BottomTabBar" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. In test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the labels deterministic.
public enum BottomTabBarStrings {
    public static let table = "BottomTabBar"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The surface's i18n closure — routes every lookup through the same facade so it localizes alongside the
    /// rest of the catalog. `@Sendable` for the Foundation-only core under strict concurrency.
    public static let localize: BottomTabBarLocalize = { key, fallback in
        string(key, fallback)
    }

    /// The navigation region's accessibility label (web `t('nav.quickNav', 'Quick navigation')`).
    public static var quickNavigation: String {
        string("nav.quickNav", "Quick navigation")
    }

    /// The Dashboard tab label (web `t('nav.dashboard', 'Home')`).
    public static var dashboard: String {
        string("nav.dashboard", "Home")
    }

    /// The Drives tab label (web `t('nav.drives', 'Drives')`).
    public static var drives: String {
        string("nav.drives", "Drives")
    }

    /// The Charging tab label (web `t('nav.charging', 'Charging')`).
    public static var charging: String {
        string("nav.charging", "Charging")
    }

    /// The Battery tab label (web `t('nav.battery', 'Battery')`).
    public static var battery: String {
        string("nav.battery", "Battery")
    }

    /// The Map tab label (web `t('nav.liveMap', 'Map')`).
    public static var liveMap: String {
        string("nav.liveMap", "Map")
    }

    /// The empty-catalog leaf copy — a native addition (the web `TABS` constant is never empty), shown when a
    /// host passes no tabs so the surface never renders a bare box.
    public static var emptyMessage: String {
        string("bottomTabBar.empty", "No destinations available")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol BottomTabBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBottomTabBarTelemetry: BottomTabBarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - BottomTabBarModel (P1/S8) — props + derivation + navigation routing

/// The surface's observable state-holder — the native peer of the web component's `useLocation` +
/// `useTranslation` reads. It pins the bound ``BottomTabBarInput`` (the current route + the tab list), derives
/// the resolved ``BottomTabBarProjection`` through the pure projector, forwards tab taps to the bound router
/// (the web `<PrefetchLink to=>`), and emits `view.opened` exactly once. Reading `projection` inside a view
/// body registers an observation dependency, so the bar redraws when the route changes — and only then, because
/// `update` skips the write when the resolved projection is unchanged.
@MainActor
@Observable
public final class BottomTabBarModel {
    @ObservationIgnored private var input: BottomTabBarInput
    @ObservationIgnored private let localize: BottomTabBarLocalize
    @ObservationIgnored private let telemetry: any BottomTabBarTelemetry
    @ObservationIgnored private let onNavigate: @MainActor (String) -> Void
    @ObservationIgnored private var didEmitOpen = false

    /// The resolved, view-ready bar (web per-render output). Recomputed on every route change; the view reads
    /// it and draws.
    public private(set) var projection: BottomTabBarProjection

    public init(
        input: BottomTabBarInput,
        telemetry: any BottomTabBarTelemetry = OSLogBottomTabBarTelemetry(),
        localize: @escaping BottomTabBarLocalize = BottomTabBarStrings.localize,
        onNavigate: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.input = input
        self.localize = localize
        self.telemetry = telemetry
        self.onNavigate = onNavigate
        projection = BottomTabBarProjector.resolve(input: input, localize: localize)
    }

    /// The bound props this model renders — exposed so the view + tests can read them.
    public var boundInput: BottomTabBarInput {
        input
    }

    /// The active tab's route (web the matched tab's `path`), `nil` when the route matches no tab.
    public var activePath: String? {
        projection.activeIndex.map { projection.tabs[$0].path }
    }

    /// The localized empty-catalog leaf copy, routed through the bound facade.
    public var localizedEmptyMessage: String {
        localize("bottomTabBar.empty", "No destinations available")
    }

    /// Forwards a tab selection to the bound router — the native peer of the web `<PrefetchLink to=>`
    /// navigation. Re-tapping the active tab still forwards, matching the web link.
    public func select(_ path: String) {
        onNavigate(path)
    }

    /// Re-binds the props — the native peer of the parent re-rendering with a new `useLocation()` pathname (or
    /// a new tab list). A no-op when the props are unchanged; otherwise re-derives, and publishes only when the
    /// resolved projection actually changed so an unrelated re-render invalidates no observer.
    public func update(_ newInput: BottomTabBarInput) {
        guard newInput != input else { return }
        input = newInput
        let next = BottomTabBarProjector.resolve(input: newInput, localize: localize)
        guard next != projection else { return }
        projection = next
    }

    /// Emits `view.opened` once (P1/S11). Idempotent across the SwiftUI appear / disappear churn — the event
    /// fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: BottomTabBarSurface.slug)
    }
}
