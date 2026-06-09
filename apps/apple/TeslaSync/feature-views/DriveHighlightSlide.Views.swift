//
//  DriveHighlightSlide.Views.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  The presentational subviews composed by `DriveHighlightSlide`: the content slide (spring-in emoji,
//  uppercased label, frosted card with route + three-up stat grid + date), the stale/offline freshness
//  banner, and the loading / empty / error states. All consume the P1/S10 facade and the shared P1/S9
//  tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Content slide (web happy-path body)

/// The populated slide (web content body). Reproduces the web composition top-to-bottom and drives the
/// same staged entrance animations, every one of which collapses to an instant reveal under Reduce
/// Motion: the emoji springs in, then the label and the card slide up and fade in on a cascade.
struct DriveHighlightSlideContent: View {
    let projection: DriveHighlightSlideProjection
    let emoji: String
    let connection: DriveHighlightSlideConnection
    let isFetching: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var emojiSize: CGFloat = 56

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            if connection != .live {
                DriveHighlightSlideFreshnessBanner(connection: connection, isFetching: isFetching)
            }

            Text(verbatim: emoji)
                .font(.system(size: emojiSize))
                .accessibilityHidden(true)
                .driveHighlightPopIn(reduceMotion: reduceMotion)

            Text(verbatim: projection.label)
                .font(Font.TS.section)
                .textCase(.uppercase)
                .tracking(1.5)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .accessibilityHidden(true)
                .driveHighlightSlideIn(delay: 0.2, duration: 0.4, yOffset: 20, reduceMotion: reduceMotion)

            DriveHighlightCard(projection: projection)
                .driveHighlightSlideIn(delay: 0.4, duration: 0.5, yOffset: 30, reduceMotion: reduceMotion)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
    }
}

// MARK: - Card (web frosted panel: route + stat grid + date)

/// The frosted card holding the route, the three-up stat grid, and the date — the native parity of the
/// web `bg-white/[0.05] backdrop-blur-sm rounded-2xl border` panel.
struct DriveHighlightCard: View {
    let projection: DriveHighlightSlideProjection

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            DriveHighlightRouteRow(start: projection.startAddress, end: projection.endAddress)
            DriveHighlightStatGrid(projection: projection)
            if !projection.date.isEmpty {
                Text(verbatim: projection.date)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: 380)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Route row (web `MapPin start → ArrowRight end`)

/// The start → end route line. Each address truncates to a single line (web `truncate`), with the
/// decorative pin and arrow glyphs hidden from VoiceOver (the route is spoken by the card's combined
/// a11y label).
struct DriveHighlightRouteRow: View {
    let start: String
    let end: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: start)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.right")
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: end)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .accessibilityHidden(true)
    }
}

// MARK: - Stat grid (web `grid grid-cols-3`)

/// The three-up stat grid: distance (no glyph), duration (clock glyph), efficiency (bolt glyph). Each
/// cell is a big value over a small caption, evenly splitting the row like the web `grid-cols-3`.
struct DriveHighlightStatGrid: View {
    let projection: DriveHighlightSlideProjection

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            DriveHighlightStatCell(
                icon: nil,
                value: projection.distanceValue,
                caption: projection.distanceUnit
            )
            DriveHighlightStatCell(
                icon: "clock",
                value: projection.durationText,
                caption: DriveHighlightSlideStrings.string("yearReview.duration", "duration")
            )
            DriveHighlightStatCell(
                icon: "bolt.fill",
                value: projection.efficiencyValue,
                caption: projection.efficiencyUnit
            )
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

/// One stat cell — an optional leading glyph beside the bold value, with a muted caption beneath. The
/// value shrinks to fit rather than wrapping so all three columns stay aligned.
struct DriveHighlightStatCell: View {
    let icon: String?
    let value: String
    let caption: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                Text(verbatim: value)
                    .font(.system(size: 22, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
            Text(verbatim: caption)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Freshness banner (stale / offline — P4 connection states)

/// The stale / offline banner shown above the cached card when the query is not live — the native parity
/// of the web `DataFreshness` chip. The card stays visible behind it (last-known highlight) while a
/// stale query auto-refreshes.
struct DriveHighlightSlideFreshnessBanner: View {
    let connection: DriveHighlightSlideConnection
    let isFetching: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .lineLimit(1)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var symbol: String {
        switch connection {
        case .offline: "wifi.slash"
        case .stale: isFetching ? "arrow.clockwise" : "clock.arrow.circlepath"
        case .live: "checkmark.circle"
        }
    }

    private var tone: Color {
        switch connection {
        case .offline: Color.TS.textMuted
        case .stale: Color.TS.statusWarning
        case .live: Color.TS.statusSuccess
        }
    }

    private var label: String {
        switch connection {
        case .offline:
            return DriveHighlightSlideStrings.string(
                "driveHighlight.offlineBanner",
                "Offline — showing last known highlight"
            )
        case .stale:
            let key = isFetching ? "driveHighlight.updatingBanner" : "driveHighlight.staleBanner"
            let fallback = isFetching ? "Refreshing this highlight…" : "Reconnecting — highlight may be stale"
            return DriveHighlightSlideStrings.string(key, fallback)
        case .live:
            return DriveHighlightSlideStrings.string("driveHighlight.liveBanner", "Live")
        }
    }
}

// MARK: - Loading (web initial fetch → skeleton chrome)

/// The initial-fetch skeleton: a redacted echo of the slide's shape (emoji disc, label bar, card with a
/// route line and three stat blocks). Shimmer respects Reduce Motion via `TSSkeleton`.
struct DriveHighlightSlideLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 56, height: 56, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 140, height: 14)
            VStack(spacing: TSSpacing.lg) {
                TSSkeleton(width: 240, height: 14)
                HStack(spacing: TSSpacing.md) {
                    ForEach(0 ..< 3, id: \.self) { _ in
                        VStack(spacing: TSSpacing.xs) {
                            TSSkeleton(width: 56, height: 24, cornerRadius: TSRadius.sm)
                            TSSkeleton(width: 36, height: 10)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                TSSkeleton(width: 120, height: 10)
            }
            .padding(TSSpacing.xl)
            .frame(maxWidth: 380)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            DriveHighlightSlideStrings.text("driveHighlight.loadingA11y", "Loading drive highlight")
        )
    }
}

// MARK: - Empty (web `!drive` branch)

/// The friendly empty state — the native parity of the web `!drive` branch: the slide emoji over the
/// "No drive data for this year" message, never a blank slide.
struct DriveHighlightSlideEmptyView: View {
    let emoji: String

    @ScaledMetric(relativeTo: .largeTitle) private var emojiSize: CGFloat = 60

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            if !emoji.isEmpty {
                Text(verbatim: emoji)
                    .font(.system(size: emojiSize))
                    .accessibilityHidden(true)
            }
            DriveHighlightSlideStrings.text("yearReview.noDriveData", "No drive data for this year")
                .font(Font.TS.section)
                .fontWeight(.regular)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web fetch failed → QueryError equivalent + retry)

/// The failure state — the P4 states contract's `QueryError` equivalent: an icon, a title, the upstream
/// message, and a retry affordance wired to the model's refresh.
struct DriveHighlightSlideErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)

            DriveHighlightSlideStrings.text("driveHighlight.errorTitle", "Couldn't load this drive highlight")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)

            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: onRetry) {
                DriveHighlightSlideStrings.text("driveHighlight.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DriveHighlightSlideStrings.text("driveHighlight.retry", "Retry"))
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
