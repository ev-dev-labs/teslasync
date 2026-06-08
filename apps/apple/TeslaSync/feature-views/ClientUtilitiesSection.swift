//
//  ClientUtilitiesSection.swift
//  TeslaSync — P4 feature view · 0003 · ClientUtilitiesSection (Apple)
//
//  The composable developer-utilities catalog surface — SwiftUI parity of
//  features/admin/components/devtools/ClientUtilitiesSection.tsx. A searchable grid
//  of expandable tool cards (single-open accordion) with the web search-empty
//  state, bound through `ClientUtilitiesModel` (P1/S8); no networking lives here.
//  The individual tools are their own surfaces — the section hosts them through an
//  injected `toolContent` provider, defaulting to a polished descriptor panel.
//

import SwiftUI

// MARK: - ClientUtilitiesSection (the feature surface)

/// The developer-utilities catalog section — the SwiftUI parity of the web
/// `ClientUtilitiesSection`. Renders the search field, the responsive card grid,
/// and every state (loading / content / search-empty / catalog-empty / error /
/// stale / offline), binding through `ClientUtilitiesModel`. The expanded card body
/// is supplied by `toolContent` (production wires each tool's own surface); the
/// default is a self-contained descriptor panel so the section is complete on its
/// own.
public struct ClientUtilitiesSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ClientUtilitiesSection"

    @State private var model: ClientUtilitiesModel
    private let toolContent: ((ToolDescriptor) -> AnyView)?

    /// - Parameters:
    ///   - model: the bound view-model (built over a `ToolCatalogSource`).
    ///   - toolContent: optional provider for a tool's expanded body. When `nil`,
    ///     the section renders its built-in `ToolDetailPanel` descriptor.
    public init(model: ClientUtilitiesModel, toolContent: ((ToolDescriptor) -> AnyView)? = nil) {
        _model = State(initialValue: model)
        self.toolContent = toolContent
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ClientUtilitiesStrings.text("devtools.clientUtilities.a11y", "Client utilities"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ToolCatalogSkeleton()
        case .empty:
            catalogEmpty
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }
}

extension ClientUtilitiesSection {
    // MARK: Content (web body)

    private var loadedContent: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ToolSearchField(
                prompt: ClientUtilitiesStrings.string("devtools.searchTools", "Search tools..."),
                text: $model.searchText
            )
            .frame(maxWidth: 420, alignment: .leading)

            if model.connection != .live {
                ClientUtilitiesConnectivityBanner(connection: model.connection) { model.refresh() }
            }

            if model.filteredTools.isEmpty {
                ToolSearchEmpty()
            } else {
                ToolGrid(
                    tools: model.filteredTools,
                    expandedID: model.expandedID,
                    onToggle: { model.toggle($0) },
                    toolContent: toolContent
                )
            }
        }
    }

    // MARK: Catalog-empty (no tools available at all)

    private var catalogEmpty: some View {
        ContentUnavailableView {
            Label {
                ClientUtilitiesStrings.text("devtools.clientUtilities.noTools", "No tools available")
            } icon: {
                Image(systemName: "wrench.and.screwdriver")
            }
        } description: {
            ClientUtilitiesStrings.text(
                "devtools.clientUtilities.noToolsHint",
                "Developer utilities will appear here once they are enabled."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    // MARK: Error (failed to resolve the catalog)

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ClientUtilitiesStrings.text("devtools.clientUtilities.errorTitle", "Couldn't load tools")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                ClientUtilitiesStrings.text("devtools.clientUtilities.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ClientUtilitiesStrings.text("devtools.clientUtilities.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}
