//
//  SettingsSearch.Views.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The presentational chrome for the settings find-as-you-type box: the bordered search field (web
//  `Input` with the lucide `Search` icon + prompt + a native clear affordance), the live-state
//  freshness chip, the stale / offline connectivity banner, one matched setting row (web ranked listbox
//  `<li><button>` — glyph + title + description + section chip), and the matches list. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). The load-state chrome lives in
//  SettingsSearch.States.swift.
//

import SwiftUI

// MARK: - Search field (web `Input` — `Search` icon + prompt + clear)

/// The bordered search field: a leading magnifying glass (web lucide `Search`), the query field bound to
/// the model with the web prompt text, and a trailing clear button while non-empty.
struct SettingsSearchField: View {
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
            prompt: SettingsSearchStrings.text("settings.search.placeholder", "Search settings…") // parity:allow ui
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
        .accessibilityLabel(SettingsSearchStrings.text("settingsSearch.clear", "Clear search"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013).
struct SettingsSearchFreshnessChip: View {
    let connection: SettingsSearchConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SettingsSearchStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SettingsSearchStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SettingsSearchConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "settingsSearch.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "settingsSearch.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "settingsSearch.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the results when the bound source is not live, so the cached
/// index is clearly labelled. Stale shows the cached-data age; offline notes the surface is offline.
struct SettingsSearchConnectivityBanner: View {
    let connection: SettingsSearchConnection
    let updatedAt: Date?

    var body: some View {
        let offline = connection == .offline
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
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
            return SettingsSearchStrings.string(
                "settingsSearch.offlineBanner",
                "Offline — showing the cached settings index"
            )
        }
        let age = SettingsSearchAge.compactLabel(since: updatedAt)
        let template = SettingsSearchStrings.string(
            "settingsSearch.staleBanner",
            "Settings index is %@ old — reconnecting."
        )
        return String(format: template, age)
    }
}

// MARK: - Matched setting row (web ranked listbox button — glyph + title + description + section chip)

/// One tappable setting row: a leading glyph, the title with an optional description, and a section
/// chip + a deep-link chevron. Selecting it routes through the bound model (web `commit(entry)`).
struct SettingsMatchRow: View {
    let match: SettingsMatch
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: match.systemImage ?? "gearshape.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: match.title)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    if let description = match.description, !description.isEmpty {
                        Text(verbatim: description)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: TSSpacing.sm)
                SettingsSectionChip(section: match.section)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
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

/// The small section chip on a result row (web `entry.section`).
struct SettingsSectionChip: View {
    let section: String

    var body: some View {
        Text(verbatim: section)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.border.opacity(0.5), in: Capsule())
            .accessibilityHidden(true)
    }
}

/// The resolved match list (web ranked listbox): the rows separated by hairlines.
struct SettingsMatchesList: View {
    let matches: [SettingsMatch]
    let onSelect: (SettingsMatch) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(matches.enumerated()), id: \.element.id) { index, match in
                SettingsMatchRow(match: match) { onSelect(match) }
                if index < matches.count - 1 {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
