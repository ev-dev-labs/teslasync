//
//  SettingsSearch.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The settings find-as-you-type box — the SwiftUI parity of
//  features/settings/components/SettingsSearch.tsx. Binds through `SettingsSearchModel` (P1/S8); no
//  networking lives here. Renders the search field (web `Input` with the lucide `Search` icon +
//  prompt + a native clear affordance) and, below it, the result area switched over the bound
//  model's phase so every prompt-required state renders (idle / loading / content / empty / error)
//  inside the stale / offline freshness envelope — never a blank box.
//

import SwiftUI

/// The settings find-as-you-type box. The host injects `onNavigate` (web `navigate`) to route a selected
/// setting to its deep link; `showsLabel` controls whether the visible header label is shown (the field
/// keeps its VoiceOver label either way).
public struct SettingsSearch: View {
    @State private var model: SettingsSearchModel
    private let showsLabel: Bool

    public init(model: SettingsSearchModel, showsLabel: Bool = true) {
        _model = State(initialValue: model)
        self.showsLabel = showsLabel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            SettingsSearchField(
                text: model.queryBinding,
                accessibilityLabel: model.fieldAccessibilityLabel,
                onClear: { model.clear() }
            )
            if model.connection != .live {
                SettingsSearchConnectivityBanner(connection: model.connection, updatedAt: model.updatedAt)
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
            SettingsSearchFreshnessChip(connection: model.connection)
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
            SettingsSearchIdleHint(catalogCount: model.catalogCount)
        case .loading:
            SettingsSearchLoadingRow()
        case .empty:
            SettingsSearchEmptyState()
        case let .error(message):
            SettingsSearchErrorView(message: message) { model.refresh() }
        case .content:
            SettingsMatchesList(matches: model.projection.matches) { model.commit($0) }
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
