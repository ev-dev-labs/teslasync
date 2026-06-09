//
//  SlideRenderer.Heroes.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  The renderer's built-in, data-bound default slide bodies — SlideDispatchContent + SlideHeroView routing each
//  SlideHero case (stat / drive-highlight / comparisons / charging-breakdown) over the gradient. Split from
//  SlideRenderer.Views.swift for file-length hygiene.
//

import SwiftUI

// MARK: - Default dispatch body (the renderer's built-in slide composition)

/// The renderer's built-in slide body — the data-bound default that renders every `SlideHero` case so
/// the surface composes a complete recap in isolation (previews/tests) and in production until/unless
/// the parent injects the richer child surfaces through the generic seam.
public struct SlideDispatchContent: View {
    private let context: SlideRenderContext

    public init(context: SlideRenderContext) {
        self.context = context
    }

    public var body: some View {
        SlideHeroView(
            hero: context.projection.hero,
            accessibilityLabel: context.projection.accessibilityLabel
        )
    }
}

/// Routes a projected `SlideHero` to its presentational view. `.none` (web `default: return null`)
/// renders the gradient only.
struct SlideHeroView: View {
    let hero: SlideHero
    let accessibilityLabel: String

    var body: some View {
        if case .none = hero {
            Color.clear.accessibilityHidden(true)
        } else {
            heroBody
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(TSSpacing.x2xl)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: accessibilityLabel))
        }
    }

    @ViewBuilder
    private var heroBody: some View {
        switch hero {
        case let .stat(emoji, title, value, unit, caption):
            SlideStatHero(emoji: emoji, title: title, value: value, unit: unit, caption: caption)
        case let .driveHighlight(drive):
            SlideDriveHighlightHero(hero: drive)
        case let .comparisons(emoji, title, items):
            SlideComparisonsHero(emoji: emoji, title: title, items: items)
        case let .chargingBreakdown(charging):
            SlideChargingBreakdownHero(hero: charging)
        case .none:
            EmptyView()
        }
    }
}

// MARK: - Stat hero (title / stat-hero / stat-chart / savings / environment / patterns / summary)

/// A centered emoji + headline value + unit + supporting caption — the web stat-style slides' hero.
/// The emoji animates in on appear (spring-ish scale) and is decorative (accessibility-hidden); the
/// combined slide label is spoken by the parent `SlideHeroView`.
struct SlideStatHero: View {
    let emoji: String
    let title: String
    let value: String?
    let unit: String?
    let caption: String?

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            SlideEmoji(emoji, size: 68)
            if let value, !value.isEmpty {
                TSFadeIn(delay: 0.2) {
                    Text(verbatim: value)
                        .font(.system(size: 56, weight: .bold))
                        .foregroundStyle(SlideInk.primary)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                }
            }
            if let unit, !unit.isEmpty {
                TSFadeIn(delay: 0.35) {
                    Text(verbatim: unit)
                        .font(Font.TS.section)
                        .foregroundStyle(SlideInk.secondary)
                }
            }
            TSFadeIn(delay: 0.5) {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .foregroundStyle(SlideInk.secondary)
                    .multilineTextAlignment(.center)
            }
            if let caption, !caption.isEmpty {
                TSFadeIn(delay: 0.65) {
                    Text(verbatim: caption)
                        .font(Font.TS.caption)
                        .foregroundStyle(SlideInk.muted)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Drive highlight hero (the slice the renderer owns)

/// The drive-highlight body — emoji + the renderer-owned label + a route/stat card, or the localized
/// no-data state. The native parity of the web `DriveHighlightSlide`'s composition for the drive the
/// `SlideRenderer` arm selects.
struct SlideDriveHighlightHero: View {
    let hero: DriveHighlightHero

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            SlideEmoji(hero.emoji, size: 56)
            Text(verbatim: hero.label)
                .font(Font.TS.section)
                .textCase(.uppercase)
                .tracking(2)
                .foregroundStyle(SlideInk.secondary)
                .multilineTextAlignment(.center)
            if hero.hasDrive {
                card
            } else {
                Text(verbatim: hero.noDataText)
                    .font(Font.TS.body)
                    .foregroundStyle(SlideInk.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var card: some View {
        VStack(spacing: TSSpacing.md) {
            route
            stats
            if !hero.date.isEmpty {
                Text(verbatim: hero.date)
                    .font(Font.TS.caption)
                    .foregroundStyle(SlideInk.muted)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 360)
        .background(SlideInk.panel, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(SlideInk.panelBorder, lineWidth: 1)
        )
    }

    private var route: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 12))
                .foregroundStyle(SlideInk.muted)
            Text(verbatim: hero.startAddress)
                .lineLimit(1)
                .truncationMode(.tail)
            Image(systemName: "arrow.right")
                .font(.system(size: 10))
                .foregroundStyle(SlideInk.muted)
            Text(verbatim: hero.endAddress)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(Font.TS.caption)
        .foregroundStyle(SlideInk.secondary)
    }

    private var stats: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            SlideMetric(value: hero.distanceText, label: hero.distanceUnit)
            SlideMetric(value: hero.durationText, label: hero.durationLabel, systemImage: "clock")
            SlideMetric(value: hero.efficiencyText, label: hero.efficiencyUnit, systemImage: "bolt")
        }
        .frame(maxWidth: .infinity)
    }
}

/// One value-over-label metric inside the drive-highlight card (web stat cell).
struct SlideMetric: View {
    let value: String
    let label: String
    var systemImage: String?

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 3) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 10))
                        .foregroundStyle(SlideInk.muted)
                }
                Text(verbatim: value)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(SlideInk.primary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(SlideInk.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Comparisons hero (fun facts grid)

/// The fun-facts grid — the web `ComparisonsSlide`'s two-column card grid (emoji + label + value).
struct SlideComparisonsHero: View {
    let emoji: String
    let title: String
    let items: [YearReviewRecapComparison]

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Text(verbatim: title)
                .font(Font.TS.section)
                .foregroundStyle(SlideInk.secondary)
                .multilineTextAlignment(.center)
            LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                ForEach(items) { item in
                    comparisonCard(item)
                }
            }
            .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func comparisonCard(_ item: YearReviewRecapComparison) -> some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: item.emoji)
                .font(.system(size: 28))
                .accessibilityHidden(true)
            Text(verbatim: item.label)
                .font(Font.TS.label)
                .foregroundStyle(SlideInk.primary)
                .multilineTextAlignment(.center)
            Text(verbatim: item.value)
                .font(Font.TS.caption)
                .foregroundStyle(SlideInk.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(SlideInk.panel, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(SlideInk.panelBorder, lineWidth: 1)
        )
    }
}

// MARK: - Charging breakdown hero

/// The charging-mix body — sessions headline + average plug-in SOC caption + the positive-share legend
/// with proportion bars (the web `ChargingBreakdownSlide` donut + legend, as native bars).
struct SlideChargingBreakdownHero: View {
    let hero: ChargingBreakdownHero

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            SlideEmoji(hero.emoji, size: 52)
            Text(verbatim: hero.sessionsValue)
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(SlideInk.primary)
            Text(verbatim: hero.sessionsLabel)
                .font(Font.TS.body)
                .foregroundStyle(SlideInk.secondary)
            Text(verbatim: hero.socCaption)
                .font(Font.TS.caption)
                .foregroundStyle(SlideInk.muted)
                .multilineTextAlignment(.center)
            VStack(spacing: TSSpacing.xs) {
                ForEach(Array(hero.shares.enumerated()), id: \.element.id) { offset, share in
                    SlideShareBar(share: share, colorIndex: offset)
                }
            }
            .frame(maxWidth: 320)
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One charging-mix legend row: a colored proportion bar + label + percent.
struct SlideShareBar: View {
    let share: ChargingShare
    let colorIndex: Int

    private static let palette: [Color] = [
        Color(.sRGB, red: 0.961, green: 0.620, blue: 0.043, opacity: 1),
        Color(.sRGB, red: 0.231, green: 0.510, blue: 0.965, opacity: 1),
        Color(.sRGB, red: 0.420, green: 0.447, blue: 0.502, opacity: 1)
    ]

    private var tone: Color {
        Self.palette[colorIndex % Self.palette.count]
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(tone).frame(width: 8, height: 8)
            Text(verbatim: share.label)
                .font(Font.TS.caption)
                .foregroundStyle(SlideInk.secondary)
            Spacer(minLength: TSSpacing.sm)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(SlideInk.panel)
                    Capsule().fill(tone)
                        .frame(width: max(4, geo.size.width * share.fraction))
                }
            }
            .frame(height: 6)
            .frame(maxWidth: 120)
            Text(verbatim: share.percentText)
                .font(Font.TS.caption)
                .foregroundStyle(SlideInk.primary)
                .frame(minWidth: 36, alignment: .trailing)
        }
    }
}
