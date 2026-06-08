//
//  QuickNav.swift
//  TeslaSync — P4 feature view · 0129 · QuickNav (Apple)
//
//  The composable "Quick Navigation" surface — the SwiftUI parity of
//  features/dashboard/components/QuickNav.tsx. Renders the responsive shortcut grid
//  (web `grid grid-cols-2 sm:grid-cols-4`) where each tile is a glass link, and
//  switches over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content) — never a blank box. Binds
//  through `QuickNavViewModel` (P1/S8); no networking lives here. Navigation is
//  delegated to the host via `onSelect` (web `<Link to>`), matching the dependency-
//  inversion convention used across the feature-view surfaces.
//

import SwiftUI

/// The composable dashboard Quick Navigation grid — the SwiftUI parity of the web
/// `QuickNav`, binding through `QuickNavViewModel` (P1/S8).
public struct QuickNav: View {
    @State private var model: QuickNavViewModel
    private let onSelect: (QuickNavShortcut) -> Void

    public init(
        model: QuickNavViewModel,
        onSelect: @escaping (QuickNavShortcut) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onSelect = onSelect
    }

    /// Zero-config initializer wiring the production `StaticQuickNavCatalogSource`
    /// (the catalog is a module constant, exactly like the web `NAV_ITEMS`).
    public init(onSelect: @escaping (QuickNavShortcut) -> Void = { _ in }) {
        self.init(model: QuickNavViewModel(source: StaticQuickNavCatalogSource()), onSelect: onSelect)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    QuickNavConnectivityChip(connection: model.connection, onRefresh: refreshAction)
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    /// A stale grid offers a manual refresh next to its chip; an offline grid does
    /// not (no network round-trip), so the chip stays informational.
    private var refreshAction: (() -> Void)? {
        model.connection == .stale ? { model.refresh() } : nil
    }

    /// The load envelope around the web's always-populated grid, so no state hides
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuickNavLoadingGrid()
        case let .error(message):
            QuickNavErrorView(message: message) { model.refresh() }
        case .empty:
            QuickNavEmptyView()
        case .content:
            QuickNavContentGrid(items: model.items, onSelect: onSelect)
        }
    }
}
