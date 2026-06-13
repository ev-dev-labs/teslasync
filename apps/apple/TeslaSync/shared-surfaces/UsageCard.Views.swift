//
//  UsageCard.Views.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The presentational pieces of the usage card (part 1 of 2): the intent → design-token projection, the
//  assembled container, the friendly empty leaf, the budget progress bar, and the at-a-glance bands grid.
//  The detail grid, the top-list breakdowns, the callout banner, and the footer link row live in
//  UsageCard.Sections.swift (split to keep each file within the SwiftLint file-length budget). All chrome
//  is token-driven (P1/S9); no raw hex, no Tailwind ports. Decorative glyphs are hidden from VoiceOver;
//  every metric cell is spoken as one combined element and the budget bar carries its own label + value.
//

import SwiftUI

// MARK: - Intent → design tokens (web `intent*` Tailwind maps)

extension UsageCardIntent {
    /// The accent color — the theme-aware projection of the web `cyan-500` / `amber-500` / `red-500`.
    /// Reads from the design system so it recolors across light / dark / high-contrast.
    var tint: Color {
        switch self {
        case .normal: Color.TS.accent
        case .warn: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }

    /// The band / block fill — a faint neutral wash for `normal` (web `bg-white/[0.03]`) and a tinted wash
    /// for `warn` / `danger` (web `bg-{c}-500/10`).
    var bandFill: Color {
        self == .normal ? Color.TS.textPrimary.opacity(0.04) : tint.opacity(0.1)
    }

    /// The band ring — none for `normal`, a tinted hairline for `warn` / `danger` (web `ring-{c}-500/30`).
    var bandRing: Color? {
        self == .normal ? nil : tint.opacity(0.3)
    }

    /// The detail value-text color — neutral for `normal` (web `var(--text-primary)`), tinted otherwise
    /// (web `text-amber-300` / `text-red-400`).
    var valueTextColor: Color {
        self == .normal ? Color.TS.textPrimary : tint
    }
}

// MARK: - UsageCardContentView (the assembled card)

/// The assembled usage card — the native peer of the web `UsageCard` root `<div className="space-y-4">`.
/// Renders the present sections top to bottom, or the muted empty leaf when nothing is present (web
/// `!hasAnything`). A pure function of the model's projection (no networking, no derivation), so it
/// composes in every branch for snapshot / preview / test.
struct UsageCardContentView: View {
    let model: UsageCardModel

    var body: some View {
        let projection = model.projection
        Group {
            if projection.hasAnything {
                sections(projection)
            } else {
                UsageCardEmptyView(message: model.resolvedEmptyMessage)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sections(_ projection: UsageCardProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let budget = projection.budget {
                UsageCardBudgetView(budget: budget, accessibilityValue: model.budgetAccessibilityValue(budget))
            }
            if !projection.bands.isEmpty {
                UsageCardBandsView(bands: projection.bands)
            }
            if !projection.details.isEmpty {
                UsageCardDetailsView(details: projection.details)
            }
            if !projection.topLists.isEmpty {
                UsageCardTopListsView(topLists: projection.topLists)
            }
            if let banner = projection.banner {
                UsageCardBannerView(banner: banner, accessibilityLabel: model.bannerAccessibilityLabel(banner))
            }
            if !projection.footer.isEmpty {
                UsageCardFooterView(links: projection.footer, onSelect: { model.navigate(to: $0) })
            }
        }
    }
}

// MARK: - Empty leaf (web `<p>{emptyMessage}</p>`)

/// The muted empty leaf shown when no section is present — the native peer of the web
/// `<p class="text-sm text-[var(--text-muted)]">{emptyMessage}</p>`, rendered as a friendly centered card
/// rather than a bare line so the surface never collapses to an unexplained empty space (native HIG).
struct UsageCardEmptyView: View {
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Budget section (web `BudgetSection`)

/// The budget progress section — the headline row (the "spent of total" headline + the optional right
/// caption, danger-colored when over), the clamped bar, and the optional caption under it. The bar carries
/// its own VoiceOver label + value (web `role="progressbar" aria-valuenow aria-label`); the unclamped
/// rounded value is announced even when the visual fill clamps to 100%.
struct UsageCardBudgetView: View {
    let budget: UsageCardBudgetProjection
    let accessibilityValue: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            headlineRow
            UsageCardProgressBar(fraction: budget.barWidthFraction, tint: budget.intent.tint)
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: budget.accessibilityLabel))
                .accessibilityValue(Text(verbatim: accessibilityValue))
            if let caption = budget.caption {
                Text(verbatim: caption)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var headlineRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: budget.headline)
                .font(Font.TS.body.weight(.medium))
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let rightLabel = budget.rightLabel {
                Text(verbatim: rightLabel)
                    .font(Font.TS.body.weight(budget.rightLabelIsDanger ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(budget.rightLabelIsDanger ? Color.TS.statusDanger : Color.TS.textMuted)
            }
        }
    }
}

/// The clamped progress bar — a rounded track with a tinted fill sized to `fraction` (0…1). The fill width
/// is the web `widthPct`; decorative (the spoken value lives on the wrapping element), so hidden from
/// VoiceOver here.
struct UsageCardProgressBar: View {
    let fraction: Double
    let tint: Color

    private let height: CGFloat = 8

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color.TS.textPrimary.opacity(0.08))
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.7))
                    .frame(width: max(0, geometry.size.width * fraction))
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

// MARK: - Bands section (web `BandsSection`)

/// The at-a-glance bands grid — the native peer of the web 3-up `grid` of bands. Uses an adaptive grid so
/// it flows 1 → N columns across iPhone / iPad / macOS and Dynamic Type, the platform-idiomatic peer of
/// the web responsive `grid-cols-1 md:grid-cols-3`. Each band is its own combined VoiceOver element.
struct UsageCardBandsView: View {
    let bands: [UsageCardBand]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(bands) { band in
                UsageCardBandCell(band: band)
            }
        }
    }
}

/// One band cell — an uppercase muted label (with optional leading glyph), a large tabular value, and an
/// optional muted subtitle, on a fill + ring driven by the band's intent (web `intentBandRing`).
struct UsageCardBandCell: View {
    let band: UsageCardBand

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            UsageCardSectionLabel(text: band.label, iconSystemName: band.iconSystemName)
            Text(verbatim: band.value)
                .font(Font.TS.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            if let sub = band.sub {
                Text(verbatim: sub)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(band.intent.bandFill, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(ringOverlay)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var ringOverlay: some View {
        if let ring = band.intent.bandRing {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(ring, lineWidth: 1)
        }
    }
}

// MARK: - Shared section label (web uppercase `text-xs tracking-wider text-muted`)

/// The small uppercase, letter-spaced, muted section label shared by the bands and the top-list blocks —
/// the native peer of the web `text-xs uppercase tracking-wider text-[var(--text-muted)]` header with an
/// optional leading glyph. Hidden from VoiceOver when it sits inside a combined element.
struct UsageCardSectionLabel: View {
    let text: String
    var iconSystemName: String?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let iconSystemName {
                Image(systemName: iconSystemName)
                    .font(.system(size: 11))
                    .accessibilityHidden(true)
            }
            Text(verbatim: text)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .lineLimit(1)
        }
        .foregroundStyle(Color.TS.textMuted)
    }
}
