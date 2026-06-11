//
//  Delta.Views.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  The presentational pieces of the change indicator: the tone / arrow / size → design-token
//  projections and the content row (the native peer of the web `<Delta>` `<span>` composition — the
//  skeleton / em-dash / sign-decorated arms). All chrome is token-driven (P1/S9); the value text is
//  weighted medium like the web (`font-medium`); no raw hex, no Tailwind ports.
//
//  Web-parity detail, reproduced exactly:
//    • loading  — just the skeleton; it is decorative, so the whole arm is hidden from VoiceOver (the
//                 web renders a bare `<Skeleton/>` with no `title`).
//    • empty    — the WHOLE element is muted ("—" + optional `comparedTo`), spoken as the
//                 "No comparison data" label (web outer span `text-[var(--text-muted)]` + `title`).
//    • value    — the arrow (decorative, `aria-hidden`) + the toned value + the muted, normal-weight
//                 `comparedTo`, spoken as the "{current} vs {previous}" title (web `title`).
//

import SwiftUI

// MARK: - DeltaTone → design tokens (web `colorForDelta` classes)

extension DeltaTone {
    /// The value color — the theme-aware token projection of the web `colorForDelta` classes
    /// (`emerald` / `rose` / `var(--text-secondary)` / `var(--text-muted)`). Reads from the design
    /// system so it recolors across light / dark / high-contrast, where the web shades did not.
    var color: Color {
        switch self {
        case .muted: Color.TS.textMuted
        case .secondary: Color.TS.textSecondary
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - DeltaArrow → SF Symbol (web lucide Arrow{Up,Down,Right})

extension DeltaArrow {
    /// The SF Symbol for the arrow — the native peer of the web lucide `Arrow{Up,Down,Right}`. `nil`
    /// when hidden (web `hideArrow`).
    var systemName: String? {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .right: "arrow.right"
        case .hidden: nil
        }
    }
}

// MARK: - DeltaSize → font + skeleton metrics (web `text-sm`/`text-xs`, Skeleton height)

extension DeltaSize {
    /// The indicator text font — web `text-sm` (md) / `text-xs` (sm). Images in the row inherit it, so
    /// the arrow scales with the text (web `h-3.5` / `h-3`).
    var font: Font {
        self == .md ? Font.TS.body : Font.TS.caption
    }

    /// The loading skeleton height — web `Skeleton height={size === 'md' ? 16 : 14}`.
    var skeletonHeight: CGFloat {
        self == .md ? 16 : 14
    }
}

// MARK: - DeltaContentView (web `<Delta>` `<span>` composition)

/// The change-indicator row — the native peer of the web `<Delta>` `<span>`: a forced skeleton while
/// loading, a muted "—" (plus any `comparedTo`) when the comparison is missing, or the sign-/tone-
/// decorated value with its arrow and trailing label. A pure function of the resolved projection — no
/// networking, no derivation — so it composes in every branch for snapshot / preview / test.
struct DeltaContentView: View {
    let projection: DeltaProjection
    let inline: Bool

    var body: some View {
        switch projection {
        case let .loading(size):
            TSSkeleton(width: 60, height: size.skeletonHeight)
        case let .empty(comparedTo, size):
            emptyRow(comparedTo: comparedTo, size: size)
        case let .value(value):
            valueRow(value)
        }
    }

    /// Inline chips hug tighter (web `gap-1`); stat rows breathe a little (web `gap-1.5`).
    private var spacing: CGFloat {
        inline ? TSSpacing.xs : TSSpacing.sm
    }

    private func emptyRow(comparedTo: String?, size: DeltaSize) -> some View {
        HStack(spacing: spacing) {
            Text(verbatim: DeltaGlyph.dash)
            if let comparedTo, !comparedTo.isEmpty {
                Text(verbatim: comparedTo)
            }
        }
        .font(size.font)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DeltaStrings.noComparison))
    }

    private func valueRow(_ value: DeltaValue) -> some View {
        HStack(spacing: spacing) {
            if let symbol = value.arrow.systemName {
                Image(systemName: symbol).accessibilityHidden(true)
            }
            Text(verbatim: value.text)
            if let comparedTo = value.comparedTo, !comparedTo.isEmpty {
                Text(verbatim: comparedTo)
                    .fontWeight(.regular)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .font(value.size.font.weight(.medium))
        .foregroundStyle(value.tone.color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: valueAccessibilityLabel(value)))
    }

    /// The populated spoken title — web `title="{current} vs {previous}"`, resolved through P1/S10.
    private func valueAccessibilityLabel(_ value: DeltaValue) -> String {
        DeltaStrings.title(current: value.currentText, previous: value.previousText)
    }
}
