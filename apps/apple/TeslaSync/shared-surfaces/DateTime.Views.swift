//
//  DateTime.Views.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The presentational subviews composed by `DateTime`: the formatted value label (the web `<span>`),
//  the optional trailing zone abbreviation (the web `showTz` span), the canonical-ISO pointer help +
//  VoiceOver hint (the web hover `title`), and the freshness chip (P4 connectivity axis). All consume
//  the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Value label (web `<span>{display}{abbrev}</span>`)

/// The rendered timestamp — the formatted value (monospaced digits so columns of times align) plus
/// the optional muted zone abbreviation (web `ml-1 text-xs text-[var(--text-muted)]`). The whole
/// group is one VoiceOver element labelled with the spoken value; the canonical ISO instant is the
/// pointer help (web `title`) and the VoiceOver hint, so the precise time is always recoverable.
struct DateTimeValueView: View {
    let resolved: DateTimeResolved

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: resolved.display)
                .font(Font.TS.body)
                .monospacedDigit()
                .foregroundStyle(resolved.isFallback ? Color.TS.textMuted : Color.TS.textPrimary)
            if let abbreviation = resolved.abbreviation {
                Text(verbatim: abbreviation)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
        .dateTimeAccessibilityHint(resolved.accessibilityHint)
        .dateTimeHelp(resolved.isoTitle)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the value when the context feed is not live — a colored dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct DateTimeFreshnessChip: View {
    let connection: DateTimeConnection
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
        case .live: DateTimeStrings.string("format.dateTime.live", "Live")
        case .stale: DateTimeStrings.string("format.dateTime.stale", "Stale")
        case .offline: DateTimeStrings.string("format.dateTime.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            DateTimeStrings.string("format.dateTime.staleA11y", "Stale — tap to refresh")
        case .offline:
            DateTimeStrings.string("format.dateTime.offlineA11y", "Offline — showing the last known time")
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

// MARK: - Accessibility / pointer-help helpers

private extension View {
    /// Applies a VoiceOver hint only when one is present, so a value without a canonical instant
    /// (the fallback case) doesn't carry an empty announcement.
    @ViewBuilder
    func dateTimeAccessibilityHint(_ hint: String?) -> some View {
        if let hint, !hint.isEmpty {
            accessibilityHint(Text(verbatim: hint))
        } else {
            self
        }
    }

    /// Attaches the canonical ISO instant as pointer help (web hover `title`) when present.
    @ViewBuilder
    func dateTimeHelp(_ title: String?) -> some View {
        if let title, !title.isEmpty {
            help(Text(verbatim: title))
        } else {
            self
        }
    }
}
