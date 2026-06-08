//
//  WebhookChannelsSection.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The composed Settings "Webhook channels" feature view — the SwiftUI parity of
//  features/settings/components/WebhookChannelsSection.tsx. Renders inside a
//  GlassPanel-equivalent card fading in on appear (web `<FadeIn>`), and switches over
//  the bound model's phase so every prompt-required state renders (loading / empty /
//  error / stale / offline / content) — never a blank box. Binds through
//  `WebhookChannelsSectionModel` (P1/S8); no networking lives here. Owns the add/edit
//  form sheet (web `WebhookFormModal`) and the destructive delete confirmation
//  (web `ConfirmDialog`).
//

import SwiftUI

/// The composable Settings "Webhook channels" section — the SwiftUI parity of the
/// web `WebhookChannelsSection`, binding through `WebhookChannelsSectionModel`.
public struct WebhookChannelsSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        WebhookChannelsSurface.slug
    }

    @State private var model: WebhookChannelsSectionModel

    public init(model: WebhookChannelsSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                WebhookHeader(
                    connection: model.connection,
                    refreshing: model.refreshing,
                    updatedAt: model.updatedAt,
                    onAdd: { model.presentAdd() },
                    onRefresh: { model.refresh() }
                )
                if model.connection != .live {
                    WebhookConnectivityBanner(connection: model.connection)
                }
                content
                WebhookDocsPanel()
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
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
        .sheet(isPresented: formPresented) {
            if let seed = model.editingForm {
                WebhookFormSheet(model: model, seed: seed)
            }
        }
        .alert(
            Text(verbatim: WebhookStrings.string("webhookChannels.delete.title", "Delete webhook?")),
            isPresented: deletePresented
        ) {
            Button(role: .destructive) {
                model.confirmDelete()
            } label: {
                WebhookStrings.text("webhookChannels.delete.confirm", "Delete webhook")
            }
            Button(role: .cancel) {
                model.cancelDelete()
            } label: {
                WebhookStrings.text("webhookChannels.delete.cancel", "Cancel")
            }
        } message: {
            WebhookStrings.text(
                "webhookChannels.delete.message",
                "This will permanently remove the webhook. TeslaSync will stop sending "
                    + "notifications to it immediately."
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    // MARK: - Content states (web isLoading / error / empty / list)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WebhookLoadingChrome()
        case let .error(message):
            WebhookErrorState(message: message) { model.refresh() }
        case .empty:
            WebhookEmptyState { model.presentAdd() }
        case .content:
            channelList
        }
    }

    private var channelList: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(model.channels) { channel in
                WebhookRow(
                    channel: channel,
                    testResult: model.testResults[channel.id],
                    toggling: model.isToggling(channel.id),
                    testing: model.isTesting(channel.id),
                    onToggle: { model.toggle(channel.id) },
                    onTest: { model.test(channel.id) },
                    onEdit: { model.presentEdit(channel) },
                    onDelete: { model.requestDelete(channel.id) }
                )
            }
        }
    }

    // MARK: - Presentation bindings

    private var formPresented: Binding<Bool> {
        Binding(
            get: { model.isFormPresented },
            set: { presented in if !presented { model.dismissForm() } }
        )
    }

    private var deletePresented: Binding<Bool> {
        Binding(
            get: { model.confirmDeleteID != nil },
            set: { presented in if !presented { model.cancelDelete() } }
        )
    }
}
