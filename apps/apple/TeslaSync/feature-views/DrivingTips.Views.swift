//
//  DrivingTips.Views.swift
//  TeslaSync — P4 feature view · 0168 · DrivingTips (Apple)
//
//  The presentational subviews composed by `DrivingTips`: the recommendation list, one
//  recommendation row (leading icon + wrapped text on a tinted card), and the loading /
//  error states. All consume the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web row icons use Tailwind
//  semantic tints — `ShieldCheck text-green-400` (the conservative, reassuring style)
//  and `AlertTriangle text-yellow-400` (everything else). These map to the brand
//  status tokens via `TSTone` (success / warning). The header `Lightbulb` is decorative
//  (web `text-yellow-400`) and maps to the warning token.
//

import SwiftUI

// MARK: - Row icon → SF Symbol + semantic tone (web `ShieldCheck` / `AlertTriangle`)

extension DrivingTipIcon {
    /// Web `<ShieldCheck/>` / `<AlertTriangle/>` → the closest HIG SF Symbols.
    var systemImage: String {
        switch self {
        case .reassuring: "checkmark.shield.fill"
        case .caution: "exclamationmark.triangle.fill"
        }
    }

    /// Web `text-green-400` (conservative) / `text-yellow-400` (otherwise).
    var tone: TSTone {
        switch self {
        case .reassuring: .success
        case .caution: .warning
        }
    }

    /// VoiceOver trait describing the icon, so the row's combined label is meaningful
    /// without leaking a decorative glyph name.
    var accessibilityFallback: String {
        switch self {
        case .reassuring: "Recommendation"
        case .caution: "Suggestion"
        }
    }
}

// MARK: - Recommendation row (web `flex items-start gap-3 rounded-lg p-3` card)

/// One recommendation: a leading tinted icon and the wrapped, localized tip text on a
/// subtle translucent card. The web row is `bg-white/[0.03] border border-white/[0.06]`
/// → the design `surfaceGlass` fill + `border` stroke (both theme-aware).
struct DrivingTipRow: View {
    let tip: DrivingTip
    let icon: DrivingTipIcon

    private var text: String {
        DrivingTipsStrings.string(tip.key, tip.fallback)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: icon.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(icon.tone.color)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Recommendation list (web `space-y-3` stack of rows)

/// The vertical stack of recommendation rows (web `div.space-y-3`). Carries a combined
/// VoiceOver label so the list reads as one summarized element on request while each
/// row stays individually focusable.
struct DrivingTipsList: View {
    let tips: [DrivingTip]
    let icon: DrivingTipIcon

    private var summary: String {
        DrivingTipsAccessibility.join(tips.map { DrivingTipsStrings.string($0.key, $0.fallback) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(tips, id: \.self) { tip in
                DrivingTipRow(tip: tip, icon: icon)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: summary))
    }
}

// MARK: - Loading chrome (P4 leaf state)

/// The initial-fetch chrome: a few card-shaped skeleton rows so the panel keeps its
/// shape (mirroring the populated recommendation cards) while the parent query
/// resolves. Never a blank box.
struct DrivingTipsLoadingList: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 16, height: 16)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(height: 12)
                        TSSkeleton(width: 180, height: 12)
                    }
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: DrivingTipsStrings.string(
            "drivingTips.loadingA11y", "Loading driving recommendations"
        )))
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The fetch-failure state (web `QueryError` peer) with a retry affordance, rendered
/// inside the surface panel so the chrome never collapses to an empty box.
struct DrivingTipsErrorContent: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: DrivingTipsStrings.string(
                "drivingTips.errorTitle", "Couldn't load driving recommendations"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: DrivingTipsStrings.string("drivingTips.retry", "Retry"))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
