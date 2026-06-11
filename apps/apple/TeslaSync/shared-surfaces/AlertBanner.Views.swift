//
//  AlertBanner.Views.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  The presentational subviews composed by `AlertBanner`: the tinted banner card (the native parity
//  of the web `<AlertBanner>` body) and the freshness chip (P4 connectivity axis). The card is
//  reproduced as scoped subviews rather than reusing the atomic `TSAlertBanner` for two parity
//  reasons: (a) the web banner tints BOTH the title and the message with the variant colour, where
//  `TSAlertBanner` uses neutral text; and (b) the P1/S10 facade resolves to `String`, incompatible
//  with `TSAlertBanner`'s `LocalizedStringKey` API. All colour comes from the shared P1/S9 tokens —
//  no Tailwind ports, no raw hex.
//
//  Accessibility note: the icon + title + message form one combined VoiceOver element with a spoken
//  label built by `AlertBannerAccessibility`; the dismiss control stays a separate, individually
//  focusable button with its own label.
//

import SwiftUI

// MARK: - Variant → tone (P1/S9 tokens)

extension AlertBannerVariant {
    /// The shared tone token for the variant — the native mirror of the web `alertVariantMap`
    /// colour (info → cyan/info, success → green, warning → amber, danger → red).
    var tone: TSTone {
        switch self {
        case .info: .info
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        }
    }
}

// MARK: - Banner card (web `<AlertBanner>` body)

/// The tinted banner — the data render of the surface. Reproduces the web banner exactly: the
/// variant-tinted leading icon, the optional emphasised title line, the required message line (the
/// web `text-X/80` muted-tint), and the optional trailing dismiss (web `onClose`), over a
/// variant-tinted, bordered, material-backed rounded box (web `bg-X/5` + `border-X/20` +
/// `backdrop-blur-sm`).
struct AlertBannerCard: View {
    let content: AlertBannerContent
    let onDismiss: () -> Void

    private var titleText: String? {
        content.title?.resolve(AlertBannerStrings.string)
    }

    private var messageText: String {
        content.message.resolve(AlertBannerStrings.string)
    }

    private var accessibilityText: String {
        AlertBannerAccessibility.label(title: titleText, message: messageText)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        TSFadeIn {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                summary
                Spacer(minLength: TSSpacing.sm)
                if content.showDismiss {
                    dismissButton
                }
            }
            .padding(TSSpacing.lg)
            .background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(content.variant.tone.color.opacity(0.06))
                }
            }
            .overlay {
                shape.strokeBorder(content.variant.tone.color.opacity(0.2), lineWidth: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var summary: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: content.symbolName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(content.variant.tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let titleText {
                    Text(verbatim: titleText)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(content.variant.tone.color)
                }
                Text(verbatim: messageText)
                    .font(Font.TS.caption)
                    .foregroundStyle(content.variant.tone.color.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var dismissButton: some View {
        Button(action: onDismiss) {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(content.variant.tone.color.opacity(0.85))
                .padding(TSSpacing.xs)
                .background(Color.TS.surface.opacity(0.001), in: RoundedRectangle(cornerRadius: TSRadius.sm))
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: AlertBannerStrings.string("alertBanner.dismiss", "Dismiss")))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the live pipe is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct AlertBannerFreshnessChip: View {
    let connection: AlertBannerConnection
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
        case .live: AlertBannerStrings.string("alertBanner.live", "Live")
        case .stale: AlertBannerStrings.string("alertBanner.stale", "Stale")
        case .offline: AlertBannerStrings.string("alertBanner.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AlertBannerStrings.string("alertBanner.staleA11y", "Stale — tap to refresh")
        case .offline:
            AlertBannerStrings.string("alertBanner.offlineA11y", "Offline — showing the last known data")
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
