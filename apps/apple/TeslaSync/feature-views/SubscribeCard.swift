//
//  SubscribeCard.swift
//  TeslaSync — P4 feature view · 0255 · SubscribeCard (Apple)
//
//  The composable "Get notified about incidents" surface — the SwiftUI parity of
//  features/system/components/status/SubscribeCard.tsx. Renders the glass card
//  with its bell header, self-hosted caption, and the responsive channel grid
//  (web `grid grid-cols-1 sm:grid-cols-2`) where each tile is a bordered link,
//  and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank
//  box. Binds through `SubscribeCardViewModel` (P1/S8); no networking lives here.
//  Navigation is delegated to the host via `onSelect` (web `<Link to>`), matching
//  the dependency-inversion convention used across the feature-view surfaces.
//

import SwiftUI

/// The composable system-status alert-channel discoverability card — the SwiftUI
/// parity of the web `SubscribeCard`, binding through `SubscribeCardViewModel`
/// (P1/S8).
public struct SubscribeCard: View {
    @State private var model: SubscribeCardViewModel
    private let onSelect: (SubscribeChannel) -> Void

    public init(
        model: SubscribeCardViewModel,
        onSelect: @escaping (SubscribeChannel) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onSelect = onSelect
    }

    /// Zero-config initializer wiring the production `StaticSubscribeCardChannelSource`
    /// (the catalog is a module constant, exactly like the web inline list).
    public init(onSelect: @escaping (SubscribeChannel) -> Void = { _ in }) {
        self.init(
            model: SubscribeCardViewModel(source: StaticSubscribeCardChannelSource()),
            onSelect: onSelect
        )
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SubscribeCardHeader()
                if model.connection != .live {
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        SubscribeCardConnectivityChip(connection: model.connection, onRefresh: refreshAction)
                    }
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    /// A stale card offers a manual refresh next to its chip; an offline card does
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
            SubscribeCardLoadingGrid()
        case let .error(message):
            SubscribeCardErrorView(message: message) { model.refresh() }
        case .empty:
            SubscribeCardEmptyView()
        case .content:
            SubscribeCardContentGrid(items: model.items, onSelect: onSelect)
        }
    }
}
