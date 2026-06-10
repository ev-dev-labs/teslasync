//
//  QuickLinksSection.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  The composable vehicle-detail "Quick Links" surface — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/QuickLinksSection.tsx. Renders the web
//  source's outer glass panel, the chevron + "Quick Links" header, and the responsive
//  shortcut grid (web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`) where each
//  tile is a glass link. It switches over the bound model's phase so every
//  prompt-required state renders (loading / empty / error / stale / offline / content)
//  — never a blank box. Binds through `QuickLinksViewModel` (P1/S8); no networking
//  lives here. Navigation is delegated to the host via `onSelect` (web `<Link to>`),
//  matching the dependency-inversion convention used across the feature-view surfaces.
//

import SwiftUI

/// The composable vehicle-detail Quick Links panel — the SwiftUI parity of the web
/// `QuickLinksSection`, binding through `QuickLinksViewModel` (P1/S8).
public struct QuickLinksSection: View {
    @State private var model: QuickLinksViewModel
    private let onSelect: (QuickLinksDestination) -> Void

    public init(
        model: QuickLinksViewModel,
        onSelect: @escaping (QuickLinksDestination) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onSelect = onSelect
    }

    /// Zero-config initializer wiring the production `StaticQuickLinksCatalogSource`
    /// (the catalog is a module constant, exactly like the web `quickLinks` array).
    public init(onSelect: @escaping (QuickLinksDestination) -> Void = { _ in }) {
        self.init(model: QuickLinksViewModel(source: StaticQuickLinksCatalogSource()), onSelect: onSelect)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.x2xl)
        .tsGlassPanel()
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    /// The web header row (`<ChevronRight/> <span>Quick Links</span>`), with the
    /// freshness chip trailing it when the surface is not live so a cached grid stays
    /// clearly labeled.
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            QuickLinksHeader()
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                QuickLinksConnectivityChip(connection: model.connection, onRefresh: refreshAction)
            }
        }
    }

    /// A stale grid offers a manual refresh next to its chip; an offline grid does not
    /// (no network round-trip), so the chip stays informational.
    private var refreshAction: (() -> Void)? {
        model.connection == .stale ? { model.refresh() } : nil
    }

    /// The load envelope around the web's always-populated grid, so no state hides
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuickLinksLoadingGrid()
        case let .error(message):
            QuickLinksErrorView(message: message) { model.refresh() }
        case .empty:
            QuickLinksEmptyView()
        case .content:
            QuickLinksContentGrid(items: model.items, onSelect: onSelect)
        }
    }
}
