//
//  DrivingCoachWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0043 · DrivingCoachWidget (Apple)
//
//  The presentational subviews composed by `DrivingCoachWidget`: the tinted impact
//  chip, the tip card + tip list (web `WidgetTipCards`), the score header + savings
//  chip, the stale/offline connectivity banner, and the friendly empty states. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Impact chip (web `Badge` in `WidgetTipCards`)

/// The impact-tier capsule chip styled with the shared `TSTone` tokens, resolving its
/// label from the per-surface i18n table. Hidden from VoiceOver — the enclosing tip
/// card's combined label already speaks the impact.
struct DrivingCoachImpactChip: View {
    let impact: CoachImpact

    var body: some View {
        Text(verbatim: DrivingCoachStrings.string(impact.localization.key, impact.localization.fallback))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(impact.tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(impact.tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(impact.tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Savings chip (web success `Badge`)

/// The "Potential savings: N%" success chip shown when the best-vs-current efficiency
/// gap is positive (web `savingsPct > 0`). Speaks its own interpolated label.
struct DrivingCoachSavingsChip: View {
    let pct: Int

    private var label: String {
        DrivingCoachProjection.potentialSavingsLabel(pct: pct, localize: DrivingCoachStrings.string)
    }

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(TSTone.success.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(TSTone.success.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(TSTone.success.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Score header (web score row)

/// The score header — the big `fmtInt(score)` value, the "/ 100" caption, and the
/// trailing savings chip (web standard-layout header row). One VoiceOver element that
/// speaks the score and the savings.
struct DrivingCoachScoreHeader: View {
    let scoreText: String
    let savingsPct: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: scoreText)
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            DrivingCoachStrings.text("widget.drivingCoach.scoreLabel", "/ 100")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            if savingsPct > 0 {
                DrivingCoachSavingsChip(pct: savingsPct)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DrivingCoachAccessibility.scoreSummary(
            scoreText: scoreText,
            savingsPct: savingsPct,
            localize: DrivingCoachStrings.string
        )))
    }
}

// MARK: - Tip card (web `WidgetTipCards` row)

/// A single tip card — the leading lightbulb glyph, the category title with the trailing
/// impact chip, and the recommendation body (web tip card). The whole card is one
/// VoiceOver element speaking the tip and its impact.
struct DrivingCoachTipCard: View {
    let index: Int
    let tip: CoachTip

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "lightbulb.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Text(verbatim: tip.title)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let impact = tip.impact {
                        DrivingCoachImpactChip(impact: impact)
                    }
                }
                Text(verbatim: tip.description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(TSSpacing.md)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass.opacity(0.6),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DrivingCoachAccessibility.tipSummary(
            index: index,
            tip: tip,
            localize: DrivingCoachStrings.string
        )))
    }
}

// MARK: - Tip list (web `WidgetTipCards`)

/// The tip-card list — the native port of the web `WidgetTipCards`. The recommendations
/// are capped at `limit` (web `maxTips = 3`); when there are none the friendly "No tips
/// available" empty state renders in place of a blank panel.
struct DrivingCoachTipList: View {
    let tips: [CoachTip]
    var limit: Int = DrivingCoachProjection.standardTipLimit

    var body: some View {
        let visible = Array(tips.prefix(limit))
        if visible.isEmpty {
            DrivingCoachTipsEmpty()
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, tip in
                    DrivingCoachTipCard(index: index + 1, tip: tip)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live,
/// so the cached coaching is clearly labeled (web freshness-indicator intent).
struct DrivingCoachConnectivityBanner: View {
    let connection: DrivingCoachConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.drivingCoach.offlineBanner" : "widget.drivingCoach.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded coaching"
            : "Refreshing — this coaching may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DrivingCoachStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty states (web `EmptyState` "No tips available")

/// The inline "No tips available" empty state shown in the tip-list area when the coach
/// resolved with no recommendations (web `WidgetTipCards` empty / compact `EmptyState`).
struct DrivingCoachTipsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DrivingCoachStrings.text("widget.drivingCoach.noTips", "No tips available")
            } icon: {
                Image(systemName: "lightbulb")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The full-widget empty state shown when the coach payload itself is absent (the load
/// resolved with no data). Always rendered in place of a blank panel.
struct DrivingCoachEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DrivingCoachStrings.text("widget.drivingCoach.noTips", "No tips available")
            } icon: {
                Image(systemName: "lightbulb")
            }
        } description: {
            DrivingCoachStrings.text(
                "widget.drivingCoach.emptyHint",
                "Personalized coaching appears once we've analyzed a few of your drives."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
