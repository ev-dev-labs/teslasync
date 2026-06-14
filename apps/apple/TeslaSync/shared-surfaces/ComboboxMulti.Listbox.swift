//
//  ComboboxMulti.Listbox.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The dropdown half of the multi-select combobox — the native peer of the web `<ul role="listbox"
//  aria-multiselectable="true">` and its conditional children. `ComboboxMultiListbox` switches on the
//  resolved ``ComboboxMultiListState`` to render exactly one branch — the loading row (web empty +
//  loading), the error retry row (the P4 `QueryError` peer for the loader failure the web swallows), the
//  empty row whose copy is "Maximum reached" at the cap else "No results" (web empty), or the scrollable
//  option list with the active-descendant highlight and the "+N more — refine search" footer (web
//  `visibleOptions` + overflow `<li>`). At the cap the rows render non-interactive (web `atMax &&
//  pointer-events-none opacity-50`). Every row resolves its copy through the P1/S10 facade and draws
//  from the P1/S9 tokens — no raw hex, no Tailwind ports, no English literals.
//

import SwiftUI

// MARK: - Listbox container (web `<ul role="listbox">`)

/// The inline dropdown beneath the field — a token-driven rounded panel that switches on the resolved
/// listbox state. Labelled as one VoiceOver container with the field's label (web listbox `aria-label`),
/// falling back to "Options" when the field label is empty.
struct ComboboxMultiListbox: View {
    let model: ComboboxMultiModel

    private var containerLabel: String {
        model.config.label.isEmpty ? ComboboxMultiStrings.optionsLabel : model.config.label
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
        let state = model.listState
        switch state.kind {
        case .loading:
            ComboboxMultiStatusRow(text: ComboboxMultiStrings.loading, showsSpinner: true)
        case let .error(message):
            ComboboxMultiErrorRow(message: message) { model.refresh() }
        case .empty:
            ComboboxMultiStatusRow(text: state.atMax ? ComboboxMultiStrings.maxReached : ComboboxMultiStrings.noResults)
        case .populated:
            optionList(state)
        }
    }

    private func optionList(_ state: ComboboxMultiListState) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(Array(state.visible.enumerated()), id: \.element.id) { index, item in
                    ComboboxMultiOptionRow(
                        item: item,
                        isActive: index == state.activeIndex,
                        disabled: state.atMax
                    ) { model.addOption(item) }
                }
                if state.hasHidden {
                    Divider().overlay(Color.TS.border)
                    ComboboxMultiMoreFooter(count: state.hiddenCount)
                }
            }
        }
        .frame(maxHeight: 240)
    }
}

// MARK: - Option row (web `<li role="option">`)

/// One option row — the native peer of the web `<li role="option">`. The active row (web
/// `aria-activedescendant`) takes a tinted background; the whole row is a button that adds the option as
/// a chip (web `addOption`). At the selection cap the row renders dimmed + non-interactive (web `atMax &&
/// pointer-events-none opacity-50`).
struct ComboboxMultiOptionRow: View {
    let item: ComboboxMultiItem
    let isActive: Bool
    var disabled = false
    let onAdd: () -> Void

    var body: some View {
        Button(action: onAdd) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: item.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isActive ? Color.TS.accent.opacity(0.12) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(Text(verbatim: item.label))
    }
}

// MARK: - Status row (web empty "No results" / "Maximum reached" / loading row)

/// A muted single-line row — the native peer of the web empty / loading `<li>`. Carries an optional
/// leading spinner for the loading branch.
struct ComboboxMultiStatusRow: View {
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
struct ComboboxMultiErrorRow: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: ComboboxMultiStrings.errorTitle)
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
                Text(verbatim: ComboboxMultiStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: ComboboxMultiStrings.retry))
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
struct ComboboxMultiMoreFooter: View {
    let count: Int

    var body: some View {
        Text(verbatim: ComboboxMultiStrings.moreHidden(count))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
    }
}
