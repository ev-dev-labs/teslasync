//
//  EntryDrawer.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  The DLQ-inspector entry drawer — the SwiftUI parity of
//  features/admin/components/dlq-inspector/EntryDrawer.tsx. The web source is a slide-in side panel
//  that lazy-loads the FULL DLQ entry (summary + base64 raw + inner payloads) with a Replay CTA in
//  the footer. The native surface presents the same capability as an Apple modal: it fades in inside
//  a solid card, pins the title header (envelope glyph + freshness chip + close) and the footer
//  (Close + Replay), surfaces a cached-data banner when the bound live-state is not fresh, and
//  switches over the model's resolved phase so every prompt-required state renders (loading / empty
//  / error / content) — never a blank box. Binds through `EntryDrawerModel` (P1/S8); no persistence
//  access or replay mutation lives here.
//

import SwiftUI

/// The DLQ-inspector entry drawer surface, binding through `EntryDrawerModel` (P1/S8). `onClose` is
/// the host dismissal (the header close + the footer Close button); the presenting sheet dismisses
/// around it.
public struct EntryDrawer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = EntryDrawerSurface.slug

    @State private var model: EntryDrawerModel
    private let onClose: () -> Void

    public init(model: EntryDrawerModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: 0) {
                EntryDrawerHeader(
                    title: model.title,
                    connection: model.connection,
                    closeLabel: model.closeAccessibilityLabel,
                    onClose: onClose
                )
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.md)

                Divider().overlay(Color.TS.border)

                if model.connection != .live {
                    EntryDrawerConnectivityBanner(connection: model.connection)
                        .padding(.horizontal, TSSpacing.lg)
                        .padding(.top, TSSpacing.sm)
                }

                ScrollView {
                    body(for: model.phase)
                        .padding(TSSpacing.lg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Divider().overlay(Color.TS.border)

                EntryDrawerFooter(model: model, onClose: onClose)
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.vertical, TSSpacing.md)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
        .accessibilityAddTraits(.isModal)
    }

    /// The body under the header: the resolved phase rendered as real chrome (loading / empty /
    /// error / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: EntryDrawerPhase) -> some View {
        switch phase {
        case .loading:
            EntryDrawerLoadingState()
        case let .error(message):
            EntryDrawerErrorState(message: message) { model.refresh() }
        case .empty:
            EntryDrawerEmptyState()
        case .content:
            EntryDrawerContent(model: model)
        }
    }
}
