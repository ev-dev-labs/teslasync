//
//  EmptyStateThreshold.Views.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  The presentational subviews composed by `EmptyStateThreshold`: the threshold card (the native
//  parity of the web `<EmptyStateThreshold>` body) and the freshness chip (P4 connectivity axis). The
//  card reproduces the web composition: the leading healthy-green check, the section title with a
//  small info glyph, the optional description line, the count message, and the optional trailing CTA,
//  over a glass-bordered, material-backed rounded box. All colour comes from the shared P1/S9 tokens —
//  no Tailwind ports, no raw hex.
//
//  Accessibility note: the icon + title + description + message form one combined VoiceOver element
//  with a spoken label built by `EmptyStateThresholdAccessibility` (the web `role="status"` live
//  region); the optional CTA stays a separate, individually focusable button with its own label.
//

import SwiftUI

// MARK: - Threshold card (web `<EmptyStateThreshold>` body)

/// The threshold card — the data render of the surface. Reproduces the web body exactly: the leading
/// emerald `CheckCircle2`, the semibold section title with the small muted `Info` glyph, the optional
/// secondary description line, the required muted message line (the custom override or the
/// auto-generated count copy), and the optional CTA (web `action`), over a glass-bordered,
/// material-backed rounded box (web `rounded-2xl border-glass bg-surface-1/40`).
struct EmptyStateThresholdCard: View {
    let content: EmptyStateThresholdContent
    let onAction: () -> Void

    private let resolver = EmptyStateThresholdStrings.string

    private var sectionText: String {
        content.sectionLabel.resolve(resolver)
    }

    private var descriptionText: String? {
        content.description?.resolve(resolver)
    }

    private var messageText: String {
        content.message.resolve(resolver)
    }

    private var actionText: String? {
        content.actionLabel?.resolve(resolver)
    }

    private var accessibilityText: String {
        EmptyStateThresholdAccessibility.label(
            sectionLabel: sectionText,
            description: descriptionText,
            message: messageText
        )
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        TSFadeIn {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: EmptyStateThresholdSymbols.status)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    summary
                    if content.showAction, let actionText {
                        actionButton(actionText)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(TSSpacing.lg)
            .background(Color.TS.surfaceGlass, in: shape)
            .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: sectionText)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Image(systemName: EmptyStateThresholdSymbols.info)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            if let descriptionText {
                Text(verbatim: descriptionText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(verbatim: messageText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private func actionButton(_ title: String) -> some View {
        TSButton(variant: .secondary, size: .small, action: onAction) {
            Text(verbatim: title)
        }
        .padding(.top, TSSpacing.xs)
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the card when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the counts,
/// with an explicit label.
struct EmptyStateThresholdFreshnessChip: View {
    let connection: EmptyStateThresholdConnection
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
        case .live: EmptyStateThresholdStrings.string("emptyStateThreshold.live", "Live")
        case .stale: EmptyStateThresholdStrings.string("emptyStateThreshold.stale", "Stale")
        case .offline: EmptyStateThresholdStrings.string("emptyStateThreshold.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            EmptyStateThresholdStrings.string("emptyStateThreshold.staleA11y", "Stale — tap to refresh")
        case .offline:
            EmptyStateThresholdStrings.string(
                "emptyStateThreshold.offlineA11y", "Offline — showing the last known counts"
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
