//
//  QuickNavWidget.swift
//  TeslaSync — P4 dashboard widget · 0075 · QuickNavWidget (Apple)
//
//  The composable Quick Navigation dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/QuickNavWidget.tsx, which renders the static `QuickNav`
//  shortcut grid inside a header-less `WidgetShell noPadding`. Binds through
//  `QuickNavModel` (no item building / navigation in the view); renders every state.
//

import SwiftUI

// MARK: - QuickNavWidget (the dashboard surface)

/// The composable Quick Navigation dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/QuickNavWidget.tsx`. Renders the responsive shortcut
/// grid (web `QuickNav`) inside a glass widget card, switching across the
/// loading / empty / error / content states, and binding through `QuickNavModel`
/// (P1/S8). Navigation is delegated to the host via `onNavigate` (web `<Link to>`).
public struct QuickNavWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "QuickNavWidget"

    /// Canonical registry metadata (registry/system.ts → "quick-nav").
    public static let registration = DashboardWidgetRegistration(
        id: "quick-nav",
        nameKey: "widget.quickNav",
        descriptionKey: "widget.quickNav.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 4, rows: 2),
        minSize: DashboardWidgetSize(cols: 2, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: QuickNavModel
    private let size: DashboardWidgetSize
    private let onNavigate: ((QuickNavDestination) -> Void)?

    public init(
        model: QuickNavModel,
        size: DashboardWidgetSize = QuickNavWidget.registration.defaultSize,
        onNavigate: ((QuickNavDestination) -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = QuickNavWidget.registration.clamp(size)
        self.onNavigate = onNavigate
    }

    /// Zero-config initializer wiring the production `StaticQuickNavSource` (the
    /// catalog is a module constant, exactly like the web `NAV_ITEMS`).
    public init(
        size: DashboardWidgetSize = QuickNavWidget.registration.defaultSize,
        onNavigate: ((QuickNavDestination) -> Void)? = nil
    ) {
        self.init(model: QuickNavModel(source: StaticQuickNavSource()), size: size, onNavigate: onNavigate)
    }

    /// Web `grid-cols-2 sm:grid-cols-4` → 2 columns for a narrow widget, 4 for a
    /// full-width one.
    private var columns: Int {
        QuickNavLayout.columns(forCols: size.cols)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(TSSpacing.md)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuickNavSkeletonGrid(columns: columns)
        case .empty:
            QuickNavEmptyState()
        case let .error(message):
            QuickNavErrorState(message: message) { model.refresh() }
        case .content:
            QuickNavGrid(items: model.items, columns: columns) { destination in
                onNavigate?(destination)
            }
        }
    }
}
