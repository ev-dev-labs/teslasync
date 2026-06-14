//
//  CommandSearch.Views.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  The presentational chrome for the vehicle-command search: the bordered search field (web `Input`
//  with the lucide `Search` icon + empty state + a native clear affordance), the live-state freshness
//  chip, the stale / offline connectivity banner (web `commands.staleData` / wake-first), one matched
//  command row (web filtered tile — glyph + title + category chip), and the matches list. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). The load-state chrome lives
//  in CommandSearch.States.swift.
//

import SwiftUI

// MARK: - Search field (web `Input` — `Search` icon + placeholder + clear) // parity:allow ui

/// The bordered search field: a leading magnifying glass (web lucide `Search`), the query field bound
/// to the parent's `value` with the web placeholder, and a trailing clear button while non-empty. // parity:allow ui
struct CommandSearchField: View {
    @Binding var text: String
    let accessibilityLabel: String
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            field
            if !text.isEmpty {
                clearButton
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
        TextField(
            text: $text,
            prompt: CommandSearchStrings.text("commands.search.placeholder", "Search commands...") // parity:allow ui
        ) {
            Text(verbatim: accessibilityLabel)
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textPrimary)
        .autocorrectionDisabled(true)
        .submitLabel(.search)
        #if os(iOS)
            .textInputAutocapitalization(.never)
        #endif
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var clearButton: some View {
        Button(action: onClear) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CommandSearchStrings.text("commandSearch.clear", "Clear search"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013).
struct CommandSearchFreshnessChip: View {
    let connection: CommandSearchConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            CommandSearchStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CommandSearchStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: CommandSearchConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "commandSearch.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "commandSearch.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "commandSearch.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the results when the bound source is not live, so the cached
/// command list is clearly labelled. Stale reproduces the web `commands.staleData` "…{{age}} old…"
/// message; offline reproduces the web wake-first treatment.
struct CommandSearchConnectivityBanner: View {
    let connection: CommandSearchConnection
    let updatedAt: Date?

    var body: some View {
        let offline = connection == .offline
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "moon.zzz.fill" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: message(offline: offline))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message(offline: offline)))
    }

    private func message(offline: Bool) -> String {
        if offline {
            return CommandSearchStrings.string(
                "commandSearch.offlineBanner",
                "Vehicle asleep — wake it to send commands"
            )
        }
        let age = CommandSearchAge.compactLabel(since: updatedAt)
        let template = CommandSearchStrings.string(
            "commands.staleData",
            "Vehicle data is %@ old. The vehicle may be asleep or offline."
        )
        return String(format: template, age)
    }
}

// MARK: - Matched command row (web filtered tile — glyph + title + category chip)

/// One tappable command row: a leading glyph, the title with an optional sub-label, and a category
/// chip. Activating it runs the command through the bound model (web tile execute).
struct CommandMatchRow: View {
    let match: CommandMatch
    let onActivate: () -> Void

    var body: some View {
        Button(action: onActivate) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: match.systemImage ?? "command")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: match.title)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    if let subtitle = match.subtitle, !subtitle.isEmpty {
                        Text(verbatim: subtitle)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: TSSpacing.sm)
                CommandCategoryChip(category: match.category)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: match.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}

/// The small category chip on a result row (web category token).
struct CommandCategoryChip: View {
    let category: String

    var body: some View {
        Text(verbatim: category)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.border.opacity(0.5), in: Capsule())
            .accessibilityHidden(true)
    }
}

/// The resolved match list (web filtered grid): the rows separated by hairlines.
struct CommandMatchesList: View {
    let matches: [CommandMatch]
    let onActivate: (CommandMatch) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(matches.enumerated()), id: \.element.id) { index, match in
                CommandMatchRow(match: match) { onActivate(match) }
                if index < matches.count - 1 {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
