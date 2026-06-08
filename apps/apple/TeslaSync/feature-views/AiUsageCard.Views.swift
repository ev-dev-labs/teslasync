//
//  AiUsageCard.Views.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  The presentational subviews composed by `AiUsageCard`, reproducing the shared web <UsageCard>
//  regions (bands grid, key/value detail grid, top-list breakdowns, empty message) plus the P4
//  leaf chrome (freshness chip, stale/offline banner, loading skeleton, retryable error). All
//  consume the P1/S10 facade + the shared P1/S9 tokens — no networking, no Tailwind ports, no raw
//  hex. The web intent palette (normal / warn / danger) is mapped to the semantic status tokens.
//
//  Scope note: the web <UsageCard> primitive is shared between TeslaApiUsageCard and AiUsageCard.
//  Its native atomic peer is owned by the P4 component-library bundle (out of scope here, and not
//  yet present), so these regions are reproduced as private subviews scoped to this surface — the
//  only files this prompt is allowed to touch.
//

import SwiftUI

// MARK: - Intent palette (web `intentBandRing` / `intentValueText`)

/// Maps a `UsageCardIntent` to the semantic status tokens — the native peer of the web intent
/// class maps. `normal` is a near-transparent glass tile with no ring; `warn` / `danger` add a
/// tinted fill + ring and colour the headline value.
enum AiUsageIntentStyle {
    static func valueColor(_ intent: AiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.TS.textPrimary
        case .warn: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }

    static func tileFill(_ intent: AiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.TS.surfaceGlass
        case .warn: Color.TS.statusWarning.opacity(0.10)
        case .danger: Color.TS.statusDanger.opacity(0.10)
        }
    }

    static func tileStroke(_ intent: AiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.clear
        case .warn: Color.TS.statusWarning.opacity(0.30)
        case .danger: Color.TS.statusDanger.opacity(0.30)
        }
    }
}

// MARK: - Bands grid (web `BandsSection` — grid-cols-1 md:grid-cols-3)

/// The three at-a-glance bands. Adaptive so it is a single column on a compact width and three
/// across on a regular width (web `md:grid-cols-3`).
struct AiUsageBandsView: View {
    let bands: [AiUsageBand]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(bands) { band in
                AiUsageBandCell(band: band)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One band tile — an icon + uppercase label, a large tabular headline (+ small unit), and a
/// subtitle. The intent tints the tile + colours the value.
struct AiUsageBandCell: View {
    let band: AiUsageBand

    private var valueWithUnit: String {
        guard let unit = band.unit else { return band.value }
        return "\(band.value) \(unit)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: 4) {
                Image(systemName: band.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: band.label)
                    .font(Font.TS.caption)
                    .tracking(0.5)
                    .textCase(.uppercase)
            }
            .foregroundStyle(Color.TS.textMuted)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: band.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(AiUsageIntentStyle.valueColor(band.intent))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = band.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }

            Text(verbatim: band.sub)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            AiUsageIntentStyle.tileFill(band.intent),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(AiUsageIntentStyle.tileStroke(band.intent), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(AiUsageAccessibility.label(band.label, valueWithUnit)). \(band.sub)"))
    }
}

// MARK: - Detail grid (web `DetailsSection` — grid-cols-2 md:grid-cols-4)

/// The key/value detail grid. Adaptive: two columns compact, four regular (web `md:grid-cols-4`).
struct AiUsageDetailsView: View {
    let details: [AiUsageDetail]

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(details) { detail in
                AiUsageDetailCell(detail: detail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One detail cell — a muted label over an intent-coloured tabular value.
struct AiUsageDetailCell: View {
    let detail: AiUsageDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: detail.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(verbatim: detail.value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(AiUsageIntentStyle.valueColor(detail.intent))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AiUsageAccessibility.label(detail.label, detail.value)))
    }
}

// MARK: - Top-lists (web `TopListsSection` — grid-cols-1 md:grid-cols-2)

/// The optional top-list breakdowns ("By feature" / "Recent calls"). Adaptive so one or two blocks
/// sit side by side (web `md:grid-cols-2`).
struct AiUsageTopListsView: View {
    let topLists: [AiUsageTopList]

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(topLists) { list in
                AiUsageTopListBlock(list: list)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One top-list block — a header (icon + uppercase title) over a list of monospaced label / value
/// rows.
struct AiUsageTopListBlock: View {
    let list: AiUsageTopList

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: 6) {
                Image(systemName: list.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: list.title)
                    .font(Font.TS.caption)
                    .tracking(0.5)
                    .textCase(.uppercase)
            }
            .foregroundStyle(Color.TS.textMuted)

            VStack(spacing: TSSpacing.xs) {
                ForEach(list.items) { item in
                    HStack(spacing: TSSpacing.sm) {
                        Text(verbatim: item.label)
                            .font(Font.TS.caption.monospaced())
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(verbatim: item.value)
                            .font(Font.TS.bodySm)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

// MARK: - Empty state (web `UsageCard` emptyMessage)

/// The resolved-but-empty state (web `!today || call_count === 0`). A friendly icon + the
/// localized message — never a blank panel.
struct AiUsageEmptyView: View {
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
