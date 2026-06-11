//
//  SectionErrorBoundary.Views.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  The presentational subviews composed by `SectionErrorBoundary`: the danger-tinted alert fallback
//  (the native parity of the underlying web `ErrorBoundary` inline UI AND the custom `fallbackTitle`
//  alert — they share the same chrome and differ only by the Retry affordance + the secondary line's
//  wrapping) and the freshness chip (P4 connectivity axis). The fallback is reproduced as scoped
//  subviews rather than reusing the atomic `TSSectionErrorBoundary` for two parity reasons: (a) the
//  web fallback tints the icon + box with the danger colour and renders TWO text lines (a headline +
//  a muted secondary), where the atomic renders a single message; and (b) the P1/S10 facade resolves
//  to `String`, incompatible with the atomic's `LocalizedStringKey` API. All colour comes from the
//  shared P1/S9 tokens — no Tailwind ports, no raw hex.
//
//  Accessibility note: the icon + headline + detail form one combined VoiceOver element with a
//  spoken label built by `SectionBoundaryAccessibility`; the Retry control stays a separate,
//  individually focusable button with its own label.
//

import SwiftUI

// MARK: - Alert fallback (web `ErrorBoundary` inline UI + `fallbackTitle` alert)

/// The danger-tinted fallback — the recovery render of the surface. Reproduces the web fallbacks
/// exactly: the danger leading icon, the emphasised headline line (web `text-[var(--text-secondary)]`
/// medium), the muted secondary line (the truncated `error.message` for the inline default, or the
/// wrapping `errors.section.subtitle` for the `fallbackTitle` mode), over a danger-tinted, bordered,
/// material-backed rounded box (web `bg-tesla-red/5` + `border-tesla-red/20`). Retry is offered only
/// for the inline default (`content.showsRetry`), exactly as the web `fallbackTitle` branch omits it.
struct SectionBoundaryAlertFallback: View {
    let content: SectionBoundaryFallbackContent
    let onRetry: () -> Void

    private var headlineText: String? {
        content.headline?.resolve(SectionErrorBoundaryStrings.string)
    }

    private var detailText: String? {
        content.detail?.resolve(SectionErrorBoundaryStrings.string)
    }

    private var accessibilityText: String {
        SectionBoundaryAccessibility.label(headline: headlineText, detail: detailText)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        TSFadeIn {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                Image(systemName: content.symbolName)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                summary
                Spacer(minLength: TSSpacing.sm)
                if content.showsRetry {
                    retryButton
                }
            }
            .padding(TSSpacing.lg)
            .background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(Color.TS.statusDanger.opacity(0.06))
                }
            }
            .overlay {
                shape.strokeBorder(Color.TS.statusDanger.opacity(0.2), lineWidth: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let headlineText {
                Text(verbatim: headlineText)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            if let detailText, !detailText.isEmpty {
                Text(verbatim: detailText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(content.showsRetry ? 1 : nil)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: !content.showsRetry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .accessibilityAddTraits(.isStaticText)
    }

    private var retryButton: some View {
        TSButton(variant: .secondary, size: .small, action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: SectionErrorBoundaryStrings.string("errors.section.retry", "Retry"))
            }
        }
        .accessibilityLabel(Text(verbatim: SectionErrorBoundaryStrings.string("errors.section.retry", "Retry")))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the guarded section when the live pipe is not live — a coloured
/// dot + a label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request
/// the snapshot, with an explicit label.
struct SectionBoundaryFreshnessChip: View {
    let connection: SectionBoundaryConnection
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
        case .live: SectionErrorBoundaryStrings.string("errors.section.live", "Live")
        case .stale: SectionErrorBoundaryStrings.string("errors.section.stale", "Stale")
        case .offline: SectionErrorBoundaryStrings.string("errors.section.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            SectionErrorBoundaryStrings.string("errors.section.staleA11y", "Stale — tap to refresh")
        case .offline:
            SectionErrorBoundaryStrings.string("errors.section.offlineA11y", "Offline — showing the last known data")
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
