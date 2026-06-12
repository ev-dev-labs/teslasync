//
//  WidgetTipCards.Views.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  The presentational pieces of the tip cards — the native peers of the web elements: the tip card (web
//  `<div className="rounded-lg bg-white/[0.03] border …">` — an optional leading glyph, a title row with an
//  optional impact ``TSBadge``, and the body description with the compact line clamp) and the friendly
//  empty leaf (the native peer of the web `<EmptyState>` from `@/components/feedback`, via the shared
//  ``TSEmptyState``). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. The impact badge
//  REUSES the shared ``TSBadge`` (web `Badge`) with the web `impactBadgeMap` tone (high → success,
//  medium → warning, low → neutral). Each card folds into a single VoiceOver element reading
//  "{title}, {impact}. {description}".
//

import SwiftUI

// MARK: - Impact → tone (web `impactBadgeMap`)

extension TipImpact {
    /// The badge tone for this impact level — the native peer of the web
    /// `impactBadgeMap = { high: 'success', medium: 'warning', low: 'neutral' }`.
    var tone: TSTone {
        switch self {
        case .high: .success
        case .medium: .warning
        case .low: .neutral
        }
    }
}

// MARK: - TipCardView (web tip card)

/// A single tip card — the native peer of the web tip `<div>`: an optional leading glyph (web
/// `mt-0.5 shrink-0 text-secondary`), a title row pairing the medium title with an optional trailing impact
/// ``TSBadge`` (web `flex items-start justify-between`), and the muted body description clamped to two lines
/// when compact (web `compact && line-clamp-2`). A pure function of its ``TipRow``, so it composes in every
/// branch for snapshot / preview / test. The card is one combined VoiceOver element; the leading glyph is
/// decorative and hidden.
struct TipCardView: View {
    let row: TipRow

    /// Web `p-3` — the card's interior padding (12pt).
    private let interiorPadding: CGFloat = TSSpacing.md
    /// Web `gap-0.5` — the title-to-description gap (2pt).
    private let titleBodyGap: CGFloat = 2
    /// Web `min-h-[44px]` — the HIG minimum tap/scan height.
    private let minimumHeight: CGFloat = 44

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            if let symbol = row.iconSymbol {
                Image(systemName: symbol)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.top, titleBodyGap)
                    .accessibilityHidden(true)
            }
            content
        }
        .frame(maxWidth: .infinity, minHeight: minimumHeight, alignment: .leading)
        .padding(interiorPadding)
        .background(Color.TS.surfaceGlass, in: shape)
        .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The title row over the description (web `flex-1 min-w-0` column).
    private var content: some View {
        VStack(alignment: .leading, spacing: titleBodyGap) {
            titleRow
            Text(verbatim: row.description)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineSpacing(2)
                .lineLimit(row.descriptionLineLimit)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The title paired with the optional trailing impact badge (web `flex items-start justify-between`).
    private var titleRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Text(verbatim: row.title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let impact = row.impact {
                TSBadge(LocalizedStringKey(badgeText(impact)), tone: impact.tone)
                    .fixedSize()
            }
        }
    }

    /// The resolved badge text (web `tip.impactLabel ?? tip.impact`, raw enum localized).
    private func badgeText(_ impact: TipImpact) -> String {
        WidgetTipCardsStrings.badgeText(override: row.impactLabel, impact: impact)
    }

    /// The combined VoiceOver reading — "{title}, {impact}. {description}" (impact omitted when absent).
    private var accessibilityLabel: String {
        WidgetTipCardsStrings.cardAccessibilityLabel(
            title: row.title,
            impact: row.impact.map(badgeText),
            description: row.description
        )
    }
}

// MARK: - WidgetTipCardsEmptyState (web `<EmptyState>`)

/// The friendly empty leaf — the native peer of the web `<EmptyState icon message />` from
/// `@/components/feedback`, rendered via the shared ``TSEmptyState`` (which wraps
/// `ContentUnavailableView`). The message is the caller's `emptyMessage` override or the localized
/// `No recommendations` default; the glyph is the caller's `emptyIcon` override or the default lightbulb.
/// Never a bare box (native HIG).
struct WidgetTipCardsEmptyState: View {
    let message: String?
    let iconSymbol: String?

    /// The default empty glyph — a lightbulb, the recommendation motif (the web default `emptyIcon`).
    static let defaultSymbol = "lightbulb"

    var body: some View {
        let resolvedMessage = (message?.isEmpty == false ? message : nil) ?? WidgetTipCardsStrings.emptyMessage
        let resolvedSymbol = (iconSymbol?.isEmpty == false ? iconSymbol : nil) ?? Self.defaultSymbol
        return TSEmptyState(
            title: LocalizedStringKey(resolvedMessage),
            message: LocalizedStringKey(WidgetTipCardsStrings.emptyHint),
            systemImage: resolvedSymbol
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}
