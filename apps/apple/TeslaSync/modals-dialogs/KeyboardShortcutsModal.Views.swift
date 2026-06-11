//
//  KeyboardShortcutsModal.Views.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  The populated content for `KeyboardShortcutsModal`: the modal header (keyboard glyph + title +
//  freshness chip + close), the controls row (the search field + the All / Global / This page filter),
//  and the grouped shortcut list (a section per group, each row a description + its key-cap chips). All
//  copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind classes
//  are ported here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the keyboard glyph, the title + freshness chip, and the trailing close button (web
/// `Modal` title bar with its `onClose` "×").
struct KBShortcutHeader: View {
    let title: String
    let connection: KBShortcutsConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                KBShortcutFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "keyboard")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: closeLabel))
    }
}

// MARK: - Controls (web SearchInput + filter tablist)

/// The controls row: the search field and the All / Global / This page filter. Adapts to a single column
/// on compact widths (web `flex-col sm:flex-row`).
struct KBShortcutControls: View {
    @Bindable var model: KBShortcutsModel

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                searchField
                filterControl
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                searchField
                filterControl
            }
        }
    }

    private var searchField: some View {
        KBShortcutSearchField(
            prompt: model.searchPrompt,
            text: Binding(get: { model.search }, set: { model.updateSearch($0) })
        )
        .frame(maxWidth: .infinity)
    }

    private var filterControl: some View {
        KBShortcutFilterControl(
            options: model.filterOptions,
            selection: model.filter,
            accessibilityLabel: model.filterAccessibilityLabel,
            onSelect: { model.setFilter($0) }
        )
    }
}

// MARK: - Search field (web `SearchInput`)

/// The cheat-sheet search box — the native parity of the web `SearchInput`: a magnifier glyph, a plain
/// `TextField` with a verbatim prompt (the per-surface i18n table can't resolve through the shared
/// field's `LocalizedStringKey`), and a clear button shown while non-empty.
struct KBShortcutSearchField: View {
    let prompt: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(verbatim: prompt))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .autocorrectionDisabled()
                .accessibilityLabel(Text(verbatim: prompt))
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: prompt))
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
}

// MARK: - Filter control (web `role="tablist"`)

/// The All / Global / This page segmented filter — the native parity of the web `role="tablist"` button
/// group: a capsule of selectable chips, each carrying `.isSelected` for VoiceOver. Built in-surface so
/// the per-surface i18n strings resolve verbatim.
struct KBShortcutFilterControl: View {
    let options: [(mode: KBShortcutsFilter, label: String)]
    let selection: KBShortcutsFilter
    let accessibilityLabel: String
    let onSelect: (KBShortcutsFilter) -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(options, id: \.mode) { option in
                chip(option.mode, label: option.label)
            }
        }
        .padding(2)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    @ViewBuilder
    private func chip(_ mode: KBShortcutsFilter, label: String) -> some View {
        let isSelected = mode == selection
        Button { onSelect(mode) } label: {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .fontWeight(isSelected ? .semibold : .regular)
                .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(isSelected ? Color.TS.accent : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Grouped list (web scroll container of sections)

/// The grouped shortcut list (web `max-h-[60vh] overflow-y-auto` container): a titled section per group,
/// each a stack of description + key-cap rows. Bounded so the sheet stays a fixed height and scrolls.
struct KBShortcutList: View {
    @Bindable var model: KBShortcutsModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                ForEach(model.groups) { group in
                    section(group)
                }
            }
            .padding(.trailing, TSSpacing.xs)
        }
        .frame(maxHeight: 420)
    }

    private func section(_ group: KBShortcutGroup) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: group.title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: TSSpacing.xs) {
                ForEach(group.shortcuts) { entry in
                    KBShortcutRow(entry: entry, accessibilityLabel: model.rowAccessibilityLabel(entry))
                }
            }
        }
    }
}

// MARK: - Row + key cap (web shortcut row + `<kbd>`)

/// One shortcut row: the description on the leading edge and its key-cap chips trailing (web
/// description + `<kbd>` chips joined by "+").
struct KBShortcutRow: View {
    let entry: KBShortcutEntry
    let accessibilityLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: entry.description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            keys
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var keys: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(entry.keys.enumerated()), id: \.offset) { index, key in
                if index > 0 {
                    Text(verbatim: "+")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                KBShortcutKeyCap(key: key)
            }
        }
        .accessibilityHidden(true)
    }
}

/// One key chip — the native parity of the web `<kbd>`: a monospaced token on a bordered surface with a
/// minimum tap-friendly width.
struct KBShortcutKeyCap: View {
    let key: String

    var body: some View {
        Text(verbatim: key)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .frame(minWidth: 24)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Localization Text helper

extension KBShortcutsStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
