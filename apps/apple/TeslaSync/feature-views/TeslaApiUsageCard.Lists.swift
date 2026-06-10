//
//  TeslaApiUsageCard.Lists.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The remaining presentational subviews composed by `TeslaApiUsageCard`, reproducing the shared
//  web <UsageCard> regions — the Top-services / By-method top-list breakdowns, the over-budget
//  callout banner, and the footer navigation links. All consume the P1/S10 facade output + the
//  shared P1/S9 tokens, and route footer taps through the injected navigator seam (web `<Link>`).
//

import SwiftUI

// MARK: - Top-lists (web `TopListsSection` — grid-cols-1 md:grid-cols-2)

/// The optional top-list breakdowns ("Top services" / "By method"). Adaptive so one or two blocks
/// sit side by side (web `md:grid-cols-2`).
struct TeslaApiUsageTopListsView: View {
    let topLists: [TeslaApiUsageTopList]

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(topLists) { list in
                TeslaApiUsageTopListBlock(list: list)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One top-list block — a header (icon + uppercase title) over a list of monospaced label / value
/// rows.
struct TeslaApiUsageTopListBlock: View {
    let list: TeslaApiUsageTopList

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

// MARK: - Banner (web `BannerSection`)

/// The over-budget callout — an icon + title + description in a tinted, ringed tile. Announced on
/// appear (web `role="status" aria-live="polite"`).
struct TeslaApiUsageBannerView: View {
    let banner: TeslaApiUsageBanner

    private var tone: Color {
        TeslaApiUsageIntentStyle.barColor(banner.intent)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: banner.systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: banner.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(tone)
                Text(verbatim: banner.description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Footer links (web `FooterSection`)

/// The footer navigation links over a hairline top border — the native peer of the web footer
/// `<Link>`s. Each tap routes through the injected navigator seam (`onOpen`).
struct TeslaApiUsageFooterView: View {
    let links: [TeslaApiUsageFooterLink]
    let onOpen: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
            HStack(spacing: TSSpacing.sm) {
                ForEach(links) { link in
                    TeslaApiUsageFooterButton(link: link, onOpen: onOpen)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One footer button — a filled (primary) or ghost (secondary) link with a trailing external-link
/// glyph, labelled for VoiceOver with just its title.
struct TeslaApiUsageFooterButton: View {
    let link: TeslaApiUsageFooterLink
    let onOpen: (String) -> Void

    var body: some View {
        TSButton(
            variant: link.primary ? .primary : .ghost,
            size: .small,
            action: handleTap
        ) {
            HStack(spacing: 4) {
                Text(verbatim: link.label)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
            }
        }
        .accessibilityLabel(Text(verbatim: link.label))
        .accessibilityAddTraits(.isLink)
    }

    private func handleTap() {
        onOpen(link.route)
    }
}
