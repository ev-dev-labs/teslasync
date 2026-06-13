//
//  UsageCard.Sections.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The presentational pieces of the usage card (part 2 of 2): the key/value detail grid, the top-list
//  breakdown blocks, the callout banner, and the footer link row. The intent → token projection, the
//  container, the empty leaf, the budget bar, and the bands grid live in UsageCard.Views.swift (split to
//  keep each file within the SwiftLint file-length budget). All chrome is token-driven (P1/S9); no raw hex,
//  no Tailwind ports. Decorative glyphs are hidden from VoiceOver; metric cells are spoken as combined
//  elements; the banner is one combined element; every footer link carries its own label (+ an external
//  hint), satisfying the "labels on every interactive element" bar.
//

import SwiftUI

// MARK: - Details section (web `DetailsSection`)

/// The key/value detail grid — the native peer of the web 4-up `grid` of `label` / `value` pairs. Uses an
/// adaptive grid so it flows 2 → N columns across iPhone / iPad / macOS and Dynamic Type (the idiomatic
/// peer of the web `grid-cols-2 md:grid-cols-4`). Each pair is its own combined VoiceOver element; the
/// value text is colored by the pair's intent (web `intentValueText`).
struct UsageCardDetailsView: View {
    let details: [UsageCardDetail]

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(details) { detail in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: detail.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: detail.value)
                        .font(Font.TS.body)
                        .monospacedDigit()
                        .foregroundStyle(detail.intent.valueTextColor)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Top-lists section (web `TopListsSection`)

/// The top-list breakdown grid — the native peer of the web 2-up `grid` of breakdown blocks. Uses an
/// adaptive grid so it flows 1 → 2 columns (the idiomatic peer of the web `grid-cols-1 md:grid-cols-2`).
struct UsageCardTopListsView: View {
    let topLists: [UsageCardTopList]

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(topLists) { list in
                UsageCardTopListBlock(list: list)
            }
        }
    }
}

/// One breakdown block — an uppercase muted header (with optional glyph) over a name/value list. The name
/// is monospaced + truncating (web `font-mono truncate`); the value is right-aligned + tabular. Each row
/// is its own combined VoiceOver element; the block contains them.
struct UsageCardTopListBlock: View {
    let list: UsageCardTopList

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            UsageCardSectionLabel(text: list.title, iconSystemName: list.iconSystemName)
            VStack(spacing: TSSpacing.xs) {
                ForEach(list.items) { item in
                    HStack(spacing: TSSpacing.sm) {
                        Text(verbatim: item.label)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(verbatim: item.value)
                            .font(Font.TS.body)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.textPrimary.opacity(0.04),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Banner section (web `BannerSection`)

/// The callout banner — the native peer of the web `role="status"` callout: a leading glyph (web
/// `AlertTriangle` by default), a bold title, and a muted description, on a fill + ring driven by the
/// banner's intent (web `intentBannerBg`). Read as one combined VoiceOver element with the resolved label.
struct UsageCardBannerView: View {
    let banner: UsageCardBannerProjection
    let accessibilityLabel: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: banner.iconSystemName)
                .font(Font.TS.body)
                .foregroundStyle(banner.intent.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: banner.title)
                    .font(Font.TS.body.weight(.semibold))
                    .foregroundStyle(banner.intent.tint)
                Text(verbatim: banner.description)
                    .font(Font.TS.caption)
                    .foregroundStyle(banner.intent.tint.opacity(0.85))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            banner.intent.tint.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(banner.intent.tint.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Footer section (web `FooterSection`)

/// The footer link row — the native peer of the web `flex-wrap` link row over a hairline top border.
/// Lays the link chips in a row that collapses to a column when the width is tight (the idiomatic peer of
/// `flex-wrap`). Each chip is a primary (filled) or secondary (plain) accent control; external links open
/// in the browser, internal links route through the host `onSelect` seam.
struct UsageCardFooterView: View {
    let links: [UsageCardFooterLinkProjection]
    let onSelect: (UsageCardFooterLinkProjection) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: TSSpacing.sm) { chips }
                VStack(alignment: .leading, spacing: TSSpacing.sm) { chips }
            }
        }
    }

    private var chips: some View {
        ForEach(links) { link in
            UsageCardFooterChip(
                link: link,
                externalHint: UsageCardStrings.externalLinkHint,
                onSelect: onSelect
            )
        }
    }
}

/// One footer chip — a `Link` (external, opening in the browser) or a `Button` (internal, routing through
/// the host). Both carry the web trailing external-link glyph and an explicit VoiceOver label; external
/// chips add the "opens in browser" hint. `primary` renders the filled accent variant (web `bg-cyan-500/15
/// ring-1`); secondary is plain accent text. The 44pt minimum height meets the iOS HIG touch target.
struct UsageCardFooterChip: View {
    let link: UsageCardFooterLinkProjection
    let externalHint: String
    let onSelect: (UsageCardFooterLinkProjection) -> Void

    var body: some View {
        control
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: link.label))
    }

    @ViewBuilder
    private var control: some View {
        if link.external, let url = link.externalURL {
            Link(destination: url) { chipLabel }
                .accessibilityAddTraits(.isLink)
                .accessibilityHint(Text(verbatim: externalHint))
        } else if link.external {
            chipLabel.opacity(0.5)
        } else {
            Button { onSelect(link) } label: { chipLabel }
                .accessibilityAddTraits(.isButton)
        }
    }

    private var chipLabel: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: link.label)
                .font(Font.TS.label)
            Image(systemName: "arrow.up.right")
                .font(.system(size: 11))
                .accessibilityHidden(true)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(chipBackground)
        .overlay(chipRing)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var chipBackground: some View {
        if link.primary {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.accent.opacity(0.15))
        }
    }

    @ViewBuilder
    private var chipRing: some View {
        if link.primary {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1)
        }
    }
}
