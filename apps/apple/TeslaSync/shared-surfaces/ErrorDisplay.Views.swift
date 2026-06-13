//
//  ErrorDisplay.Views.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  The presentational subviews composed by `ErrorDisplay`: the rose-tinted failure card (the native
//  parity of the web `_ErrorState` chrome that `ErrorDisplay` renders through), its recovery CTA, and
//  the freshness chip (P4 connectivity axis). The card is reproduced as scoped subviews rather than
//  reusing the atomic `TSErrorDisplay` for two parity reasons: (a) the web `_ErrorState` tints the
//  whole tile — icon box, title, AND message — with the rose danger colour and switches its padding /
//  gap / icon size on the `compact` prop, where `TSErrorDisplay` is a single fixed-density neutral
//  tile; and (b) the P1/S10 facade resolves to `String`, incompatible with the atomic components'
//  `LocalizedStringKey` API. All colour comes from the shared P1/S9 tokens — no Tailwind ports, no raw
//  hex.
//
//  Accessibility note: the icon + title + message form one combined VoiceOver element with a spoken
//  label built by `ErrorDisplayAccessibility`; the recovery CTA stays a separate, individually
//  focusable button with its own label and the web disabled semantics (offline `Retry when online`).
//

import SwiftUI

// MARK: - Failure card (web `_ErrorState` chrome)

/// The rose-tinted failure tile — the data render of the surface. Reproduces the web `_ErrorState`
/// exactly: the danger-tinted leading icon in its rounded tint box, the emphasised title line, the
/// muted message line (web `text-rose-300/70`), and the optional trailing recovery CTA, over a danger-
/// tinted, bordered, material-backed rounded box (web `bg-rose-500/5` + `border-rose-500/20` +
/// `backdrop-blur-sm`). The `density` reproduces the web `compact` prop (tighter padding / gap / icon
/// + a smaller title) for inline mutation errors.
struct ErrorDisplayCard: View {
    let content: ErrorDisplayContent
    let density: ErrorDisplayDensity
    let onAction: (ErrorDisplayAction) -> Void

    private var titleText: String {
        content.title.resolve(ErrorDisplayStrings.string)
    }

    private var messageText: String {
        content.message.resolve(ErrorDisplayStrings.string)
    }

    private var accessibilityText: String {
        ErrorDisplayAccessibility.label(title: titleText, message: messageText)
    }

    private var titleFont: Font {
        density == .compact ? Font.TS.bodySm : Font.TS.body
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    private var tone: Color {
        Color.TS.statusDanger
    }

    var body: some View {
        TSFadeIn {
            HStack(alignment: .top, spacing: density.rowSpacing) {
                summary
                Spacer(minLength: TSSpacing.sm)
                if let action = content.action {
                    ErrorDisplayActionButton(action: action) { onAction(action) }
                }
            }
            .padding(density.containerPadding)
            .background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(tone.opacity(0.06))
                }
            }
            .overlay {
                shape.strokeBorder(tone.opacity(0.2), lineWidth: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var summary: some View {
        HStack(alignment: .top, spacing: density.rowSpacing) {
            iconBox
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: titleText)
                    .font(titleFont)
                    .fontWeight(.medium)
                    .foregroundStyle(tone)
                Text(verbatim: messageText)
                    .font(Font.TS.caption)
                    .foregroundStyle(tone.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var iconBox: some View {
        Image(systemName: content.symbolName)
            .font(.system(size: density.iconPointSize, weight: .semibold))
            .foregroundStyle(tone)
            .padding(density.iconBoxPadding)
            .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Recovery CTA (web ghost `Button`)

/// The recovery CTA — the native parity of the web rose-tinted ghost `Button` (`bg-rose-500/10
/// text-rose-300 hover:bg-rose-500/20`). Carries its own VoiceOver label and honours the web disabled
/// semantics: the offline `Retry when online` is rendered dimmed and non-interactive until the
/// connection returns.
struct ErrorDisplayActionButton: View {
    let action: ErrorDisplayAction
    let onTap: () -> Void

    private var tone: Color {
        Color.TS.statusDanger
    }

    private var labelText: String {
        action.label.resolve(ErrorDisplayStrings.string)
    }

    var body: some View {
        Button(action: onTap) {
            Text(verbatim: labelText)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(tone)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .frame(minHeight: 28)
                .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!action.isEnabled)
        .opacity(action.isEnabled ? 1 : 0.5)
        .accessibilityLabel(Text(verbatim: labelText))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the failure when the connection is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct ErrorDisplayFreshnessChip: View {
    let connection: ErrorDisplayConnection
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
        case .live: ErrorDisplayStrings.string("error.freshness.live", "Live")
        case .stale: ErrorDisplayStrings.string("error.freshness.stale", "Stale")
        case .offline: ErrorDisplayStrings.string("error.freshness.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            ErrorDisplayStrings.string("error.freshness.staleA11y", "Stale — tap to refresh")
        case .offline:
            ErrorDisplayStrings.string("error.freshness.offlineA11y", "Offline — showing the last known status")
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
