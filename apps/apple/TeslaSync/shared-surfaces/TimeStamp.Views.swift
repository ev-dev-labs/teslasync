//
//  TimeStamp.Views.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  The presentational subviews composed by `TimeStamp`: the visible body label (the web `<span>`),
//  the hover tooltip carrying the alternate format (the web `<Tooltip content={secondary}>`), the
//  VoiceOver hint announcing that alternate, and the freshness chip (P4 connectivity axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw
//  hex.
//

import SwiftUI

// MARK: - Value label (web `<Tooltip content={secondary}><span>{primary}</span></Tooltip>`)

/// The rendered timestamp — the visible body (monospaced digits so columns of times align). The
/// alternate format (web `secondary`) is attached as the native hover tooltip (the web `Tooltip`,
/// mapped to the macOS pointer-help affordance) and as the VoiceOver hint, so power users can flip
/// perspectives exactly as the web tooltip lets them. A nullish value renders the muted "—" with no
/// tooltip — the web behavior.
struct TimeStampValueView: View {
    let resolved: TimeStampResolved

    var body: some View {
        Text(verbatim: resolved.primary)
            .font(Font.TS.body)
            .monospacedDigit()
            .foregroundStyle(resolved.isFallback ? Color.TS.textMuted : Color.TS.textPrimary)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
            .timeStampAccessibilityHint(resolved.accessibilityHint)
            .timeStampHelp(resolved.secondary)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the value when the context feed is not live — a colored dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct TimeStampFreshnessChip: View {
    let connection: TimeStampConnection
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
        case .live: TimeStampStrings.string("format.timeStamp.live", "Live")
        case .stale: TimeStampStrings.string("format.timeStamp.stale", "Stale")
        case .offline: TimeStampStrings.string("format.timeStamp.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            TimeStampStrings.string("format.timeStamp.staleA11y", "Stale — tap to refresh")
        case .offline:
            TimeStampStrings.string("format.timeStamp.offlineA11y", "Offline — showing the last known time")
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

// MARK: - Accessibility / tooltip helpers

private extension View {
    /// Applies a VoiceOver hint only when one is present, so a value without an alternate (the
    /// fallback case) doesn't carry an empty announcement.
    @ViewBuilder
    func timeStampAccessibilityHint(_ hint: String?) -> some View {
        if let hint, !hint.isEmpty {
            accessibilityHint(Text(verbatim: hint))
        } else {
            self
        }
    }

    /// Attaches the alternate format as the hover tooltip (web `Tooltip`, mapped to macOS pointer
    /// help) when present.
    @ViewBuilder
    func timeStampHelp(_ secondary: String?) -> some View {
        if let secondary, !secondary.isEmpty {
            help(Text(verbatim: secondary))
        } else {
            self
        }
    }
}
