//
//  FormatterPrefsBridge.Views.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The presentational subviews composed by `FormatterPrefsBridge`. The web component renders `null`
//  (it is a side-effect mount), so under the P4 leaf "never a blank box" contract the native surface
//  renders a compact diagnostic of the exact two values the bridge keeps in sync — the active locale
//  and decimal precision — plus the offline decoration and the freshness chip (the P4 connectivity
//  axis). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens; the
//  shared `TSCard` / `TSButton` / `TSIconBox` / `TSFadeIn` primitives are reused. No networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Value row + grid (the two synced prefs)

/// One label → value row — a muted label with the verbatim resolved value (mono digits for the
/// numeric precision, a plain tag for the locale). Caller supplies already-localized strings.
struct FormatterPrefsBridgeValueRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(label) \(value)"))
    }
}

/// The locale + decimal-precision rows the bridge syncs — shared by the applied card and the defaults
/// state so both present the resolved values identically.
struct FormatterPrefsBridgeValueGrid: View {
    let applied: FormatterPrefsBridgeApplied

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            FormatterPrefsBridgeValueRow(
                label: FormatterPrefsBridgeStrings.string("settings.formatter.localeLabel", "Locale"),
                value: applied.locale
            )
            FormatterPrefsBridgeValueRow(
                label: FormatterPrefsBridgeStrings.string("settings.formatter.precisionLabel", "Decimal precision"),
                value: String(applied.precision)
            )
        }
    }
}

// MARK: - Applied card (active formatter prefs)

/// The active-prefs card — the native "never a blank box" rendering of the invisible web bridge: the
/// title + a one-line description of what the prefs drive, the locale + precision rows, and a synced-
/// from-settings note. When the snapshot is offline the note becomes the cached-values note. The whole
/// card is one combined VoiceOver element voicing the title + both values.
struct FormatterPrefsBridgeAppliedView: View {
    let applied: FormatterPrefsBridgeApplied
    let offline: Bool

    private var title: String {
        FormatterPrefsBridgeStrings.string("settings.formatter.title", "Formatting preferences")
    }

    private var description: String {
        FormatterPrefsBridgeStrings.string(
            "settings.formatter.description",
            "Numbers, dates, and units across the app use these preferences."
        )
    }

    private var note: String {
        offline
            ? FormatterPrefsBridgeStrings.string(
                "settings.formatter.offlineNote",
                "Showing the last synced preferences."
            )
            : FormatterPrefsBridgeStrings.string("settings.formatter.syncedNote", "Synced from your settings.")
    }

    private var localeLabel: String {
        FormatterPrefsBridgeStrings.string("settings.formatter.localeLabel", "Locale")
    }

    private var precisionLabel: String {
        FormatterPrefsBridgeStrings.string("settings.formatter.precisionLabel", "Decimal precision")
    }

    var body: some View {
        TSFadeIn {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack(spacing: TSSpacing.sm) {
                        TSIconBox(systemName: "textformat.123", tone: .accent)
                        VStack(alignment: .leading, spacing: TSSpacing.xs) {
                            Text(verbatim: title)
                                .font(Font.TS.panel)
                                .foregroundStyle(Color.TS.textPrimary)
                            Text(verbatim: description)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    FormatterPrefsBridgeValueGrid(applied: applied)
                    Text(verbatim: note)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: 360, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: FormatterPrefsBridgeAccessibility.appliedLabel(
                title: title,
                localeLabel: localeLabel,
                locale: applied.locale,
                precisionLabel: precisionLabel,
                precision: applied.precision
            )))
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the card when the feed is not live — a coloured dot + label
/// (`Stale` / `Offline`). A button so VoiceOver + pointer users can re-request the snapshot, with an
/// explicit label. Hidden entirely when live.
struct FormatterPrefsBridgeFreshnessChip: View {
    let connection: FormatterPrefsBridgeConnection
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
        case .live: FormatterPrefsBridgeStrings.string("settings.formatter.live", "Live")
        case .stale: FormatterPrefsBridgeStrings.string("settings.formatter.stale", "Stale")
        case .offline: FormatterPrefsBridgeStrings.string("settings.formatter.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            FormatterPrefsBridgeStrings.string("settings.formatter.staleA11y", "Stale — tap to refresh")
        case .offline:
            FormatterPrefsBridgeStrings.string(
                "settings.formatter.offlineA11y",
                "Offline — showing the last synced preferences"
            )
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
