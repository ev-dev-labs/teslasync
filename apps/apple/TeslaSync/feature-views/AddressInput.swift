//
//  AddressInput.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  The geocoded "Address" autocomplete — the SwiftUI parity of
//  features/driving/components/AddressInput.tsx. Binds through `AddressInputModel` (P1/S8); no
//  networking lives here. Renders the labelled query field (web `Combobox` with the lucide `MapPin`,
//  `allowFreeText`, `hideLabel={!label}`) and, below it, the suggestion area switched over the bound
//  model's phase so every prompt-required state renders (idle / loading / content / empty / error)
//  with the stale / offline freshness envelope — never a blank box.
//

import SwiftUI

/// The geocoded Address autocomplete. The parent owns the raw text + the resolved coordinates via
/// the model's injected `onChange` / `onSelect` callbacks (web `value` / `onChange` / `onSelect`);
/// `showsLabel` reproduces the web `hideLabel={!label}` (the field keeps its VoiceOver label either
/// way).
public struct AddressInput: View {
    @State private var model: AddressInputModel
    private let showsLabel: Bool

    public init(model: AddressInputModel, showsLabel: Bool = true) {
        _model = State(initialValue: model)
        self.showsLabel = showsLabel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            AddressInputField(
                text: model.queryBinding,
                isBusy: model.phase == .loading,
                accessibilityLabel: model.fieldAccessibilityLabel
            )
            if model.connection != .live {
                AddressInputConnectivityBanner(connection: model.connection)
            }
            suggestionArea
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The optional visible label (web `hideLabel={!label}`) plus the freshness chip.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            if showsLabel {
                Text(verbatim: model.fieldAccessibilityLabel)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            AddressInputFreshnessChip(connection: model.connection)
        }
    }

    /// The suggestion menu envelope: the post-select confirmation, or the phase-driven body.
    private var suggestionArea: some View {
        panel {
            if let selected = model.selected {
                AddressInputSelectedConfirmation(location: selected)
            } else {
                phaseBody
            }
        }
        .accessibilityLabel(Text(verbatim: areaAccessibilityLabel))
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.phase {
        case .idle:
            AddressInputIdleHint()
        case .loading:
            AddressInputLoadingRow()
        case .empty:
            AddressInputEmptyState()
        case let .error(message):
            AddressInputErrorView(message: message) { model.refresh() }
        case .content:
            AddressSuggestionsList(suggestions: model.projection.suggestions) { model.select($0) }
        }
    }

    private var areaAccessibilityLabel: String {
        if let selected = model.selected {
            let prefix = AddressInputStrings.string("addressInput.selected", "Selected address")
            return "\(prefix): \(selected.name)"
        }
        return model.resultsAccessibilitySummary
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
