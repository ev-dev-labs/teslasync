//
//  ScoreBadge.Views.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  The presentational subviews composed by `ScoreBadge`: the colored grade glyph (the native parity
//  of the web `<span class="font-bold leading-none tabular-nums …" style={{ color }}>` — the letter
//  IS the badge, no fill), the stale + offline markers (P4 freshness/connectivity decorations), the
//  resolved readout row, the neutral loading skeleton, and the neutral unavailable / retry chip. All
//  copy resolves through the P1/S10 facade; all color comes from the P1/S9 tokens; the shared
//  `TSSkeleton` / `TSButton` primitives are reused. No networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Grade → tint mapping (web shared grade palette)

extension ScoreBadgeGrade {
    /// The grade glyph color — the native port of the web `GRADE_PALETTE` mapped onto the P1/S9
    /// semantic tokens so the palette stays theme-aware (no raw hex): A+ / A wash success (web
    /// `#10b981`), B washes info (web `#00f0ff`), C washes warning (web `#f59e0b`), and D / F wash
    /// danger (the web `#ef4444` / `#b91c1c` shade distinction collapses to the single semantic danger
    /// token — the glyph itself differentiates the two grades). The ``unrated`` "—" uses the muted
    /// text token (web `#6b7280` neutral gray).
    var tintColor: Color {
        switch self {
        case .aPlus, .aGrade: Color.TS.statusSuccess
        case .bGrade: Color.TS.statusInfo
        case .cGrade: Color.TS.statusWarning
        case .dGrade, .fGrade: Color.TS.statusDanger
        case .unrated: Color.TS.textMuted
        }
    }
}

// MARK: - Grade glyph (web `<span … font-bold tabular-nums>` colored letter)

/// The colored grade glyph — the native parity of the web badge span. Rendered bold at the size's
/// point size with tabular figures and tight leading (the web `font-bold leading-none tabular-nums`),
/// tinted by the grade's semantic token. Non-interactive like the web span; the readout row owns the
/// VoiceOver label, so the bare glyph is hidden from the accessibility tree.
struct ScoreBadgeGlyph: View {
    let readout: ScoreBadgeReadout

    var body: some View {
        Text(verbatim: readout.label)
            .font(.system(size: readout.size.pointSize, weight: .bold))
            .monospacedDigit()
            .lineSpacing(0)
            .foregroundStyle(readout.grade.tintColor)
            .fixedSize()
            .accessibilityHidden(true)
    }
}

// MARK: - Decorations (P4 freshness / connectivity markers)

/// The stale marker shown beside the badge when the snapshot is past the freshness window — a small
/// warning-tinted dot. Decorative; the stale note is folded into the readout's VoiceOver label, so the
/// marker is hidden from VoiceOver to avoid a duplicate announcement.
struct ScoreBadgeStaleMarker: View {
    var body: some View {
        Circle()
            .fill(Color.TS.statusWarning)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}

/// The offline marker shown beside the badge when the snapshot is offline — a small neutral dot that
/// signals the score is the last-known value. Decorative; the offline note is folded into the
/// readout's VoiceOver label, so the marker is hidden from VoiceOver.
struct ScoreBadgeOfflineMarker: View {
    var body: some View {
        Circle()
            .fill(Color.TS.textMuted)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}

// MARK: - Resolved readout (web rendered badge)

/// The resolved readout row — the colored grade glyph plus the stale / offline markers when those P4
/// leaf decorations apply, the native parity of the web rendered `<ScoreBadge>`. The row is one
/// VoiceOver element voicing the aria label suffixed with the stale / offline notes.
struct ScoreBadgeReadyView: View {
    let readout: ScoreBadgeReadout
    let stale: Bool
    let offline: Bool

    private var staleNote: String? {
        stale ? ScoreBadgeStrings.string("score.staleA11y", "Score may be out of date") : nil
    }

    private var offlineNote: String? {
        offline ? ScoreBadgeStrings.string("score.offlineA11y", "Offline — showing the last known score") : nil
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ScoreBadgeGlyph(readout: readout)
            if stale {
                ScoreBadgeStaleMarker()
            }
            if offline {
                ScoreBadgeOfflineMarker()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ScoreBadgeAccessibility.label(
            base: readout.accessibilityLabel,
            staleNote: staleNote,
            offlineNote: offlineNote
        )))
    }
}

// MARK: - Loading (feed resolving → neutral skeleton)

/// The neutral skeleton shown while the score feed resolves — a shimmer sized to the badge's glyph
/// footprint (following the display size) so the layout does not jump when the readout lands. Shimmer
/// respects Reduce Motion via the shared `TSSkeleton`.
struct ScoreBadgeLoadingSkeleton: View {
    let size: ScoreBadgeSize

    var body: some View {
        TSSkeleton(
            width: size.skeletonSize.width,
            height: size.skeletonSize.height,
            cornerRadius: TSRadius.sm
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ScoreBadgeStrings.string("score.loadingA11y", "Loading score")))
    }
}

// MARK: - Unavailable (feed failed → neutral retry chip)

/// The neutral retry chip shown when the score feed fails — a `QueryError` peer scaled to the badge's
/// footprint. Re-requests the snapshot on tap.
struct ScoreBadgeUnavailableChip: View {
    let onRetry: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption2)
                Text(verbatim: ScoreBadgeStrings.string("score.unavailable", "Score unavailable"))
                    .font(Font.TS.caption)
            }
        }
        .accessibilityLabel(Text(verbatim: ScoreBadgeStrings.string(
            "score.unavailableA11y",
            "Score unavailable — tap to retry"
        )))
    }
}
