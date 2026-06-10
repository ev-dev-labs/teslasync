//
//  globalShortcuts.Views.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  The presentational subviews composed by `GlobalShortcuts`: the key chip (web
//  `<kbd>`), the shortcut row (description + chips), the group section (web cheat-sheet
//  block), the scrollable list, and the freshness chip (P4 connectivity axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking,
//  no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Key chip (web `<kbd>`)

/// A single key chip — the native mirror of the web `<kbd>{token}</kbd>`. Reuses the
/// shared `TSCode` mono chip so the glyph matches the design system, with a hairline
/// border so it reads as a physical key. Decorative: the spoken keys live on the row's
/// combined accessibility label.
struct GlobalShortcutsKeycap: View {
    let token: ShortcutKeyToken

    var body: some View {
        TSCode(token.display)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Shortcut row (web cheat-sheet row: description + key chips)

/// One cheat-sheet row — the description on the leading edge and the key chips trailing,
/// the native mirror of the web row. The whole row is one VoiceOver element whose label
/// reads the description then spells out the key combination.
struct GlobalShortcutsRow: View {
    let definition: GlobalShortcutDefinition

    private var tokens: [ShortcutKeyToken] {
        definition.tokens
    }

    private var accessibilityLabelText: String {
        GlobalShortcutsAccessibility.rowLabel(
            description: definition.description,
            shortcutWord: GlobalShortcutsStrings.string("shortcuts.a11y.shortcutWord", "shortcut"),
            tokens: tokens
        )
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: definition.description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            keycaps
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }

    private var keycaps: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(tokens.enumerated()), id: \.offset) { _, token in
                GlobalShortcutsKeycap(token: token)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Group section (web cheat-sheet block)

/// One cheat-sheet group — a header (the localised group title) plus its rows in a
/// shared card, divider-separated. The native mirror of the web cheat-sheet's per-group
/// block. The title keeps its natural case so "Navigation (press g then…)" reads
/// correctly.
struct GlobalShortcutsSection: View {
    let group: GlobalShortcutGroup

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: group.title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)

            TSCard {
                VStack(spacing: 0) {
                    ForEach(Array(group.rows.enumerated()), id: \.element.id) { index, definition in
                        if index > 0 {
                            Divider().overlay(Color.TS.border)
                        }
                        GlobalShortcutsRow(definition: definition)
                            .padding(.vertical, TSSpacing.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - List (the grouped cheat-sheet)

/// The scrollable grouped cheat-sheet — every non-empty group in canonical order,
/// wrapped in the shared fade-in for entrance polish (the feature-leaf `FadeIn` peer).
struct GlobalShortcutsList: View {
    let groups: [GlobalShortcutGroup]

    var body: some View {
        TSFadeIn {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ForEach(groups) { group in
                        GlobalShortcutsSection(group: group)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, TSSpacing.xs)
            }
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the list when the feed is not live — a coloured dot
/// + label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can
/// re-request the registry snapshot, with an explicit label.
struct GlobalShortcutsFreshnessChip: View {
    let connection: GlobalShortcutsConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: GlobalShortcutsStrings.string("shortcuts.live", "Live")
        case .stale: GlobalShortcutsStrings.string("shortcuts.stale", "Stale")
        case .offline: GlobalShortcutsStrings.string("shortcuts.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            GlobalShortcutsStrings.string("shortcuts.staleA11y", "Stale — tap to refresh")
        case .offline:
            GlobalShortcutsStrings.string("shortcuts.offlineA11y", "Offline — showing last known shortcuts")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
