//
//  BatteryDelta.Views.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  The presentational pieces of the battery delta: the tone → design-token color projection (the web
//  `text-emerald-300` / `text-amber-300` / `text-[var(--text-muted)]`) and the content row (the
//  native peer of the web `<span>` composition — an optional battery glyph plus the tabular-nums
//  value). All chrome is token-driven (P1/S9); the value uses `.monospacedDigit()` (the web
//  `tabular-nums`); no raw hex, no Tailwind ports.
//
//  Web-parity colour detail, reproduced exactly:
//    • no data  — the WHOLE element is muted: the web outer span carries `text-[var(--text-muted)]`,
//                 so both the icon and the "—" render muted.
//    • populated — only the VALUE is toned: the web outer span carries no color, the icon inherits
//                 the ambient body color, and only the inner value span carries the tone class. The
//                 native peer leaves the icon's `foregroundStyle` unset (so it inherits) and tones
//                 only the value Text.
//

import SwiftUI

// MARK: - BatteryDeltaTone → design tokens (web emerald / amber / muted)

extension BatteryDeltaTone {
    /// The value color — the theme-aware token projection of the web tone classes
    /// (`positive → emerald`, `negative → amber`, `neutral → muted`). Reads from the design system so
    /// it recolors across light / dark / high-contrast, where the web `text-emerald-300` /
    /// `text-amber-300` did not.
    var color: Color {
        switch self {
        case .positive: Color.TS.statusSuccess
        case .negative: Color.TS.statusWarning
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - BatteryDeltaContentView (web `<span>` composition)

/// The battery delta row — the native peer of the web `BatteryDelta` `<span>`: an optional battery
/// glyph (the web Lucide `Battery`, `aria-hidden`) plus the tabular-nums value. VoiceOver reads the
/// whole row as one element with the resolved label (web `aria-label` on the outer span); the icon is
/// decorative. A pure function of its inputs — no networking, no derivation.
struct BatteryDeltaContentView: View {
    let projection: BatteryDeltaProjection
    let showIcon: Bool
    let accessibilityLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if showIcon {
                icon
            }
            Text(verbatim: projection.displayText)
                .font(Font.TS.body)
                .monospacedDigit()
                .foregroundStyle(projection.tone.color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The decorative battery glyph. Web parity: muted with the rest of the element when there is no
    /// data; otherwise left at the inherited ambient color (the web icon is NOT toned — only the
    /// value is), so `foregroundStyle` is intentionally unset in the populated branch.
    @ViewBuilder
    private var icon: some View {
        let glyph = Image(systemName: "battery.100")
            .font(Font.TS.caption)
            .accessibilityHidden(true)
        if projection.hasData {
            glyph
        } else {
            glyph.foregroundStyle(Color.TS.textMuted)
        }
    }
}
