//
//  AlertMessageEditor.Autocomplete.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The `{{`-trigger autocomplete panel (web token autocomplete popover): the grouped,
//  keyboard-navigable token suggestions with their loading / no-matches states. Rendered inline
//  below the editor (a token-driven panel rather than a floating popover, for robust iOS + macOS
//  parity). Each row shows the `{{key}}` insertion + the label and inserts on tap; the highlighted
//  row tracks the model's cursor. Copy via the P1/S10 facade; chrome token-driven (P1/S9).
//

import SwiftUI

/// The autocomplete suggestion panel, switched over the model's token phase so every branch renders
/// (loading / no-matches / grouped content) and never a blank box. Hidden when no `{{` trigger is
/// open.
struct TokenAutocompletePanel: View {
    @Bindable var model: AlertMessageEditorModel

    var body: some View {
        Group {
            switch model.tokenPhase {
            case .hidden:
                EmptyView()
            case .loading:
                panel { TokenAutocompleteLoadingRow() }
            case .empty:
                panel { TokenAutocompleteEmptyRow() }
            case .content:
                panel { groupedList }
            }
        }
    }

    private var groupedList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(model.tokenProjection.groups) { group in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: group.name)
                            .font(Font.TS.label)
                            .textCase(.uppercase)
                            .foregroundStyle(Color.TS.textMuted)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(group.tokens) { token in
                            TokenSuggestionRow(
                                suggestion: token,
                                isHighlighted: token.flatIndex == model.autocompleteCursor
                            ) { model.insertToken(token) }
                        }
                    }
                }
            }
            .padding(TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 240)
    }

    private func panel(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .contain)
            .accessibilityLabel(AlertMessageEditorStrings.text("alertEditor.autocompleteLabel", "Suggestions"))
    }
}

/// One tappable suggestion row (web grouped option): the monospace `{{key}}` insertion + the label,
/// highlighted when it is the keyboard cursor's current row.
struct TokenSuggestionRow: View {
    let suggestion: TokenSuggestion
    let isHighlighted: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: suggestion.insertion)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.TS.accent)
                    .lineLimit(1)
                    .layoutPriority(1)
                Text(verbatim: suggestion.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isHighlighted ? Color.TS.accent.opacity(0.15) : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: suggestion.accessibilityLabel))
        .accessibilityAddTraits(isHighlighted ? [.isButton, .isSelected] : .isButton)
    }
}
