//
//  Combobox.Listbox.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The dropdown half of the combobox — the native peer of the web `<ul role="listbox">` and its
//  conditional children. `ComboboxListbox` switches on the resolved ``ComboboxListState`` to render
//  exactly one branch — the loading row (web empty + loading), the error retry row (the P4 `QueryError`
//  peer for the loader failure the web swallows), the "No results" row (web empty), or the scrollable
//  option list with the active-descendant + selected highlight and the "+N more — refine search" footer
//  (web `visibleOptions` + overflow `<li>`). Every row resolves its copy through the P1/S10 facade and
//  draws from the P1/S9 tokens — no raw hex, no Tailwind ports, no English literals.
//

import SwiftUI

// MARK: - Listbox container (web `<ul role="listbox">`)

/// The inline dropdown beneath the field — a token-driven rounded panel that switches on the resolved
/// listbox state. Labelled as one VoiceOver container with the field's label (web listbox
/// `aria-label`), falling back to "Options" when the field label is empty.
struct ComboboxListbox: View {
    let model: ComboboxModel

    private var containerLabel: String {
        model.config.label.isEmpty ? ComboboxStrings.optionsLabel : model.config.label
    }

    var body: some View {
        content
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: containerLabel))
    }

    @ViewBuilder
    private var content: some View {
        switch model.listState.kind {
        case .loading:
            ComboboxStatusRow(text: ComboboxStrings.loading, showsSpinner: true)
        case let .error(message):
            ComboboxErrorRow(message: message) { model.refresh() }
        case .empty:
            ComboboxStatusRow(text: ComboboxStrings.noResults)
        case .populated:
            optionList
        }
    }

    private var optionList: some View {
        let state = model.listState
        return ScrollView {
            VStack(spacing: 0) {
                ForEach(Array(state.visible.enumerated()), id: \.element.id) { index, item in
                    ComboboxOptionRow(
                        item: item,
                        isActive: index == state.activeIndex,
                        isSelected: item.id == state.selectedID
                    ) { model.select(item) }
                }
                if state.hasHidden {
                    Divider().overlay(Color.TS.border)
                    ComboboxMoreFooter(count: state.hiddenCount)
                }
            }
        }
        .frame(maxHeight: 240)
    }
}

// MARK: - Option row (web `<li role="option">`)

/// One option row — the native peer of the web `<li role="option">`. The active row (web
/// `aria-activedescendant`) takes a tinted background; the selected row (web `aria-selected`) is
/// semibold with a trailing checkmark and the `.isSelected` accessibility trait. The whole row is a
/// button that commits the option (web `commitOption`).
struct ComboboxOptionRow: View {
    let item: ComboboxItem
    let isActive: Bool
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: item.label)
                    .font(Font.TS.body)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isActive ? Color.TS.accent.opacity(0.12) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: item.label))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Status row (web empty "No results" / loading row)

/// A muted single-line row — the native peer of the web empty / loading `<li>`. Carries an optional
/// leading spinner for the loading branch.
struct ComboboxStatusRow: View {
    let text: String
    var showsSpinner = false

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if showsSpinner {
                ProgressView().controlSize(.small)
            }
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error row (P4 `QueryError` peer)

/// The loader-failure row (web `QueryError` peer — the web swallows the loader reject to empty) — an
/// inline error line with the runtime reason and a retry affordance that re-requests the options.
struct ComboboxErrorRow: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: ComboboxStrings.errorTitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
            }
            Button(action: onRetry) {
                Text(verbatim: ComboboxStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: ComboboxStrings.retry))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Overflow footer (web "+N more — refine search")

/// The "+N more — refine search" footer (web overflow `<li>`) shown when the resolved option count
/// exceeds `maxVisibleOptions`. Non-interactive guidance copy.
struct ComboboxMoreFooter: View {
    let count: Int

    var body: some View {
        Text(verbatim: ComboboxStrings.moreHidden(count))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
    }
}
