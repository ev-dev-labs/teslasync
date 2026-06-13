//
//  LayoutBreadcrumbs.Adapter.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  The testable, dependency-light core for the global Layout breadcrumb row — the SwiftUI parity of
//  components/layout/LayoutBreadcrumbs.tsx. The web source is a five-line composition: it reads the
//  merged per-page label overrides (`useBreadcrumbOverrides()`), resolves the trail for the current
//  route (`useBreadcrumbs(overrides)`), and renders `<Breadcrumbs>`. The breadcrumb machinery itself —
//  the override store/context value, the route-table type, the `:param` matcher, the trail builder, the
//  projection and the renderer — already ships in the sibling surface P4/0166 `BreadcrumbOverridesContext`;
//  this surface is the COMPOSITION that wires those pieces to the live route, so it reuses them rather
//  than duplicating (DRY) and contributes only what the web `LayoutBreadcrumbs` adds on top:
//
//    • the diagnostics slug (P1/S11),
//    • the current-route seam ``LayoutBreadcrumbsSource`` — the native peer of the web `useLocation()`
//      subscription `useBreadcrumbs` reads; the host feeds the active pathname through it and the model
//      re-projects the trail, exactly as a route change re-runs the web hook,
//    • the route catalog (the ROUTE_META port) lives in LayoutBreadcrumbs.Routes.swift, the projection in
//      LayoutBreadcrumbs.Projection.swift, and the i18n facade + telemetry + `@Observable` model in
//      LayoutBreadcrumbs.Model.swift.
//
//  Faithful-parity note (documented, not a shortcut): the web composition performs NO fetch and reads NO
//  remote data — the overrides live in React state and the route comes from the in-memory router — so it
//  has no loading / error / stale / offline branches. Its REAL branches are the ones `<Breadcrumbs>`
//  draws: a rendered multi-item trail (a nested / detail route), a suppressed single-item trail (a
//  top-level page, web `items.length <= 1 → null`), and an empty trail (an unknown / chrome-less route,
//  web `[]`). This surface reproduces exactly those; inventing freshness chrome would contradict the
//  source. No SwiftUI and no networking live here, so every seam is unit testable in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web source is anonymous (it has no slug of its own); the prompt assigns this surface the
/// canonical slug `LayoutBreadcrumbs`, kept here (SwiftUI-free) so the state-holder can emit telemetry
/// without depending on the view layer.
public enum LayoutBreadcrumbsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "LayoutBreadcrumbs"
}

// MARK: - LayoutBreadcrumbsSource (web `useLocation()` subscription)

/// The current-route seam — the native peer of the `useLocation()` subscription `useBreadcrumbs` reads.
/// The web hook recomputes the trail whenever `location.pathname` changes; the native model binds this
/// source, stores the latest pathname, and re-projects. The production host implements it over the same
/// shared shell route state that drives navigation (the native peer of the React Router location), so the
/// breadcrumb always reflects the route on screen; previews + tests drive ``LiveLayoutBreadcrumbsSource``
/// with a fixed path. `start()` emits the current path immediately (web's initial render reads the
/// current location); `stop()` releases the subscription.
@MainActor
public protocol LayoutBreadcrumbsSource: AnyObject {
    /// Invoked with the current route pathname on `start()` and on every subsequent route change — the
    /// native peer of `useBreadcrumbs` re-running when `location.pathname` changes.
    var onUpdate: (@MainActor (String) -> Void)? { get set }
    /// Begins observing the route and emits the current pathname once.
    func start()
    /// Releases the subscription.
    func stop()
}

/// The production / preview route source — holds the host's current pathname and re-emits it whenever
/// the host pushes a new route. The production app builds this over the shared shell route state (the
/// native peer of the router location); previews + tests construct it with a fixed path and, when they
/// exercise a route change, call ``update(pathname:)``.
@MainActor
public final class LiveLayoutBreadcrumbsSource: LayoutBreadcrumbsSource {
    public var onUpdate: (@MainActor (String) -> Void)?
    private var pathname: String

    /// Builds a source anchored at `pathname` (web initial `location.pathname`, default the root `/`).
    public init(pathname: String = "/") {
        self.pathname = pathname
    }

    /// Emits the current pathname (web initial render reads the current location).
    public func start() {
        emit()
    }

    public func stop() {}

    /// Pushes a new route and re-emits it — the native peer of a router navigation that re-runs
    /// `useBreadcrumbs` with the new `location.pathname`.
    public func update(pathname: String) {
        self.pathname = pathname
        emit()
    }

    private func emit() {
        onUpdate?(pathname)
    }
}
