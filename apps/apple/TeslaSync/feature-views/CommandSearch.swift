//
//  CommandSearch.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  The vehicle-command search box — the SwiftUI parity of
//  features/system/components/CommandSearch.tsx as it is driven inside
//  features/system/components/VehicleCommandCenter.tsx. Binds through `CommandSearchModel` (P1/S8); no
//  networking lives here. Renders the search field (web `Input` with the lucide `Search` icon +
//  placeholder + a native clear affordance) and, below it, the result area switched over the bound // parity:allow ui
//  model's phase so every prompt-required state renders (idle / loading / content / empty / error)
//  inside the stale / offline freshness envelope — never a blank box.
//

import SwiftUI

/// The vehicle-command search box. The parent owns the raw query via the model's injected `onChange`
/// (web `value` / `onChange`) and receives an activated command via `onActivate`; `showsLabel`
/// controls whether the visible header label is shown (the field keeps its VoiceOver label either way).
public struct CommandSearch: View {
    @State private var model: CommandSearchModel
    private let showsLabel: Bool

    public init(model: CommandSearchModel, showsLabel: Bool = true) {
        _model = State(initialValue: model)
        self.showsLabel = showsLabel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            CommandSearchField(
                text: model.queryBinding,
                accessibilityLabel: model.fieldAccessibilityLabel,
                onClear: { model.clear() }
            )
            if model.connection != .live {
                CommandSearchConnectivityBanner(connection: model.connection, updatedAt: model.updatedAt)
            }
            resultArea
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The optional visible label plus the freshness chip.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            if showsLabel {
                Text(verbatim: model.fieldAccessibilityLabel)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            CommandSearchFreshnessChip(connection: model.connection)
        }
    }

    /// The result-area envelope: the phase-driven body inside the bordered panel.
    private var resultArea: some View {
        panel {
            phaseBody
        }
        .accessibilityLabel(Text(verbatim: model.resultsAccessibilitySummary))
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.phase {
        case .idle:
            CommandSearchIdleHint(catalogCount: model.catalogCount)
        case .loading:
            CommandSearchLoadingRow()
        case .empty:
            CommandSearchEmptyState()
        case let .error(message):
            CommandSearchErrorView(message: message) { model.refresh() }
        case .content:
            CommandMatchesList(matches: model.projection.matches) { model.activate($0) }
        }
    }

    private func panel(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        content()
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
