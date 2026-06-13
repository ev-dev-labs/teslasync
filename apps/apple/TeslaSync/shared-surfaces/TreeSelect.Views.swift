//
//  TreeSelect.Views.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The presentational pieces of the tri-state tree multi-select — the native peers of the web elements:
//  the production announcer (the web sr-only `aria-live` summary region), the tri-state checkbox glyph
//  (web `Checkbox` none / partial / all), the search field (web `Input` with the magnifier + clear suffix),
//  the top header (web select-all + counts + clear), the group header row (web chevron + group checkbox +
//  label + `selected/total` count + right slot), the leaf row (web indented leaf with its decorative
//  checkbox + label + right slot, including the disabled-but-visible branch), the scrollable body (web
//  bordered scroll area dispatching empty / no-results / tree), the composed ready view, and the freshness
//  chip (P4 connectivity axis). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//  Decorative glyphs are hidden from VoiceOver; every interactive control carries an explicit label.
//

import SwiftUI

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the selection summary to the assistive technology via SwiftUI's `AccessibilityNotification`
/// `.Announcement` at `.default` (polite) speech priority — the native parity of the web hidden
/// `aria-live="polite"` summary region the tree updates as the selection changes.
@MainActor
public struct LiveTreeSelectAnnouncer: TreeSelectAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}

// MARK: - Tri-state checkbox glyph (web Checkbox none / partial / all)

/// The native tri-state checkbox glyph — the filled box (`all`), the dash (`partial`, web
/// `indeterminate`), or the empty box (`none`). Purely visual: the enclosing button carries the label +
/// traits. Tinted to the accent when checked, muted when empty or disabled.
struct TreeSelectCheckGlyph: View {
    let state: TreeSelectCheckState
    var compact = false
    var isDisabled = false

    private var symbolName: String {
        switch state {
        case .all: "checkmark.square.fill"
        case .partial: "minus.square.fill"
        case .none: "square"
        }
    }

    private var tint: Color {
        if isDisabled { return Color.TS.textMuted }
        return state == .none ? Color.TS.textMuted : Color.TS.accent
    }

    var body: some View {
        Image(systemName: symbolName)
            .foregroundStyle(tint)
            .imageScale(compact ? .medium : .large)
    }
}

// MARK: - Right-slot detail badge (web renderLeafRight / renderGroupRight)

/// The trailing accessory chip — the native peer of the web `renderLeafRight` / `renderGroupRight` slot
/// (a badge / summary). Decorative for VoiceOver (the row label already conveys the meaning).
struct TreeSelectDetailBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs / 2)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Search field (web Input + magnifier + clear suffix)

/// The search row — the magnifier glyph, the typing field bound to the controlled search value, and a
/// clear button shown only when there is text (web `Input` with the `Search` icon + `X` suffix). Wrapped
/// in the token-driven field chrome.
struct TreeSelectSearchField: View {
    let model: TreeSelectModel
    let prompt: String

    private var textBinding: Binding<String> {
        Binding(get: { model.searchText }, set: { model.updateSearch($0) })
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            field
            if !model.searchText.isEmpty {
                Button { model.clearSearch() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: TreeSelectStrings.clearSearch))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private var field: some View {
        let editor = TextField(text: textBinding, prompt: Text(verbatim: prompt)) {
            Text(verbatim: TreeSelectStrings.filterA11y)
        }
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .labelsHidden()
        .accessibilityLabel(Text(verbatim: TreeSelectStrings.filterA11y))

        #if os(iOS)
            return editor
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
        #else
            return editor
        #endif
    }
}

// MARK: - Top header (web select-all + counts + clear)

/// The header strip — the tri-state "select all visible" control (its label flips between Select /
/// Clear and All / N visible by the search + aggregate state), the selected counter (with the "of total"
/// suffix while searching), and the "Clear all selected" button shown only when something is selected.
struct TreeSelectHeader: View {
    let model: TreeSelectModel

    private var selectAllLabel: String {
        let resolved = model.resolved
        if resolved.isSearching {
            return resolved.aggregateState == .all
                ? TreeSelectStrings.clearVisible(resolved.visibleLeafCount)
                : TreeSelectStrings.selectVisible(resolved.visibleLeafCount)
        }
        return resolved.aggregateState == .all ? TreeSelectStrings.clearAll : TreeSelectStrings.selectAll
    }

    private var countLabel: String {
        let resolved = model.resolved
        if resolved.isSearching, resolved.totalLeafCount > 0 {
            return TreeSelectStrings.selectedOfTotal(resolved.selectedTotal, total: resolved.totalLeafCount)
        }
        return TreeSelectStrings.selectedCount(resolved.selectedTotal)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            selectAllButton
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: countLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                if model.resolved.hasSelection {
                    clearButton
                }
            }
        }
        .padding(.horizontal, TSSpacing.xs)
    }

    private var selectAllButton: some View {
        Button { model.toggleAllVisible() } label: {
            HStack(spacing: TSSpacing.sm) {
                TreeSelectCheckGlyph(
                    state: model.resolved.aggregateState,
                    isDisabled: model.resolved.selectAllDisabled
                )
                Text(verbatim: selectAllLabel)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .disabled(model.resolved.selectAllDisabled)
        .accessibilityLabel(Text(verbatim: selectAllLabel))
        .accessibilityAddTraits(model.resolved.aggregateState == .all ? [.isButton, .isSelected] : .isButton)
    }

    private var clearButton: some View {
        Button { model.clearAll() } label: {
            Text(verbatim: TreeSelectStrings.clearSelected)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TreeSelectStrings.clearSelected))
    }
}
