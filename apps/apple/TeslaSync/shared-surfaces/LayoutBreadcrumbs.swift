//
//  LayoutBreadcrumbs.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  The public API of the global Layout breadcrumb row — the SwiftUI parity of
//  components/layout/LayoutBreadcrumbs.tsx:
//
//      export function LayoutBreadcrumbs({ className }) {
//        const overrides = useBreadcrumbOverrides();   // merged per-page label overrides (env state)
//        const items = useBreadcrumbs(overrides);       // resolve the trail for the current route
//        return <Breadcrumbs items={items} />;          // render (self-suppresses for <= 1 item)
//      }
//
//  The native peer reads the merged overrides from the environment (the sibling P4/0166
//  ``BreadcrumbOverridesState`` — `useBreadcrumbOverrides()`), resolves the trail for the live route held
//  by ``LayoutBreadcrumbsModel`` (`useBreadcrumbs`), and renders the shared
//  ``BreadcrumbOverridesTrailView`` (`<Breadcrumbs>`). Both axes are observable, so the row redraws when a
//  page registers / unregisters a label OR when the route changes — the native parity of the two hooks
//  re-running.
//
//  States — every branch the web composition has, all rendered (no hidden surfaces):
//    • rendered  — a nested / detail route (> 1 trail item) → the breadcrumb trail.
//    • suppressed — a top-level page (single item, web `items.length <= 1 → null`) → the empty slot.
//    • empty     — an unknown / chrome-less route (web `[]`) → the empty slot.
//  The empty slot is the faithful peer of the web returning `null`: the surrounding chrome row keeps its
//  quick-search hint visible, so the slot is a zero-content, accessibility-hidden keeper rather than a
//  panel (a "no breadcrumb" message would drift — top-level pages intentionally show no trail). The DEBUG
//  inspector (LayoutBreadcrumbs.Views.swift) renders a friendly note for the non-drawing branches so
//  previews + tests are never a blank box. There are no loading / error / stale / offline branches: the
//  composition reads no remote data (see LayoutBreadcrumbs.Adapter.swift).
//

import SwiftUI

// MARK: - LayoutBreadcrumbs (the shared surface)

/// The global Layout breadcrumb row — the SwiftUI parity of `LayoutBreadcrumbs.tsx`. Mount one instance
/// in the Layout chrome's content-region header; it resolves + renders the breadcrumb for the active
/// route, reading per-page label overrides from the surrounding ``BreadcrumbOverridesProvider``.
public struct LayoutBreadcrumbs: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LayoutBreadcrumbsSurface.slug
    }

    @Environment(\.breadcrumbOverridesState) private var overridesState
    @State private var model: LayoutBreadcrumbsModel
    private let onSelect: (BreadcrumbOverridesTrailItem) -> Void
    private let onHome: () -> Void

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    public init(
        model: LayoutBreadcrumbsModel,
        onSelect: @escaping (BreadcrumbOverridesTrailItem) -> Void = { _ in },
        onHome: @escaping () -> Void = {}
    ) {
        _model = State(initialValue: model)
        self.onSelect = onSelect
        self.onHome = onHome
    }

    /// Convenience initializer building the model from the route seam — the parity of mounting
    /// `<LayoutBreadcrumbs>` in the Layout chrome with the router location. The host implements `source`
    /// over the shared shell route state and routes `onSelect` / `onHome` to the navigation stack (the
    /// native peer of `<PrefetchLink to>`), so tapping an ancestor crumb (or the leading Home) navigates.
    public init(
        source: any LayoutBreadcrumbsSource,
        table: BreadcrumbOverridesRouteTable = LayoutBreadcrumbsRouteCatalog.table,
        telemetry: any LayoutBreadcrumbsTelemetry = OSLogLayoutBreadcrumbsTelemetry(),
        onSelect: @escaping (BreadcrumbOverridesTrailItem) -> Void = { _ in },
        onHome: @escaping () -> Void = {}
    ) {
        _model = State(
            initialValue: LayoutBreadcrumbsModel(source: source, table: table, telemetry: telemetry)
        )
        self.onSelect = onSelect
        self.onHome = onHome
    }

    /// Convenience initializer anchoring at a fixed pathname — the ergonomic spelling for a host that
    /// already has the active route in hand (the Layout chrome route snapshot). Wraps a
    /// ``LiveLayoutBreadcrumbsSource``.
    public init(
        pathname: String,
        onSelect: @escaping (BreadcrumbOverridesTrailItem) -> Void = { _ in },
        onHome: @escaping () -> Void = {}
    ) {
        self.init(source: LiveLayoutBreadcrumbsSource(pathname: pathname), onSelect: onSelect, onHome: onHome)
    }

    public var body: some View {
        let overrides = overridesState?.overrides ?? [:]
        let resolved = model.resolvedTrail(overrides: overrides)
        Group {
            if resolved.isRendered {
                BreadcrumbOverridesTrailView(items: resolved.items, onSelect: onSelect, onHome: onHome)
            } else {
                LayoutBreadcrumbsEmptySlot()
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LayoutBreadcrumbsStrings.rowA11y))
    }
}
