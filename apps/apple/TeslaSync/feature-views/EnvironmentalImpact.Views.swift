//
//  EnvironmentalImpact.Views.swift
//  TeslaSync — P4 feature view · 0112 · EnvironmentalImpact (Apple)
//
//  The presentational subviews of the loaded EnvironmentalImpact card — the
//  native port of the web header (leaf icon + title), the two primary figure
//  tiles (CO₂ saved + tree-years), the description callout (trees icon + the
//  interpolated sentence with bold-green figures), and the three secondary
//  figures (gallons / metric tons / dollars). Each piece reads its copy through
//  the injected `EnvironmentalImpactLocalizer`; no English is hardcoded. The
//  load/empty/error chrome + the card container live in `EnvironmentalImpact.swift`.
//

import SwiftUI

// MARK: - Header (web `h3` leaf icon + title + freshness chip)

struct EnvironmentalImpactHeader: View {
    let chip: EnvironmentalFreshnessChip?
    let localize: EnvironmentalImpactLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
            Text(verbatim: localize.string("costAnalysis.environment.title", "Environmental Impact"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            if let chip {
                EnvironmentalFreshnessChipView(chip: chip, localize: localize)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(verbatim: EnvironmentalImpactAccessibility.headerLabel(
            chip: chip,
            localize: localize
        )))
    }
}

// MARK: - Freshness chip (stale / offline)

struct EnvironmentalFreshnessChipView: View {
    let chip: EnvironmentalFreshnessChip
    let localize: EnvironmentalImpactLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: chip.systemImage)
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: localize.string(chip.labelKey, chip.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: localize.string(chip.labelKey, chip.labelFallback)))
    }
}

// MARK: - Primary figure tile (web `bg-green-500/10` centered tile)

struct EnvironmentalPrimaryTile: View {
    let stat: EnvironmentalStat
    let localize: EnvironmentalImpactLocalizer

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: stat.value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.statusSuccess)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(verbatim: localize.string(stat.labelKey, stat.labelFallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.statusSuccess.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EnvironmentalImpactAccessibility.statLabel(stat, localize: localize)))
    }
}

// MARK: - Description callout (web trees icon + interpolated sentence)

struct EnvironmentalImpactDescriptionView: View {
    let description: EnvironmentalImpactDescription

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "tree.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            sentence
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: description.accessibilityLabel))
    }

    /// Web rich `<p>`: prose with two bold-green interpolated figures, composed as
    /// concatenated `Text` so it flows + scales with Dynamic Type as one phrase.
    private var sentence: Text {
        Text(verbatim: description.lead + " ")
            + highlight(description.co2Highlight)
            + Text(verbatim: " " + description.middle + " ")
            + highlight(description.treeHighlight)
            + Text(verbatim: " " + description.trailing)
    }

    private func highlight(_ value: String) -> Text {
        Text(verbatim: value)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.statusSuccess)
    }
}

// MARK: - Secondary figure (web bottom 3-col centered stat)

struct EnvironmentalSecondaryStatView: View {
    let stat: EnvironmentalStat
    let localize: EnvironmentalImpactLocalizer

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: stat.value)
                .font(Font.TS.section)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(verbatim: localize.string(stat.labelKey, stat.labelFallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EnvironmentalImpactAccessibility.statLabel(stat, localize: localize)))
    }
}
