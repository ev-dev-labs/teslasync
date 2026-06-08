//
//  SummarySlide.Components.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  The Apple-idiomatic view pieces the surface composes: the screenshot-friendly
//  glass card (web `motion.div` gradient card), the staggered stat rows (web
//  `AnimatedNumber` + Lucide icon, via the shared data-display + motion
//  components), the conditional savings line, the freshness + refresh accessory,
//  and the empty / error / offline / loading states (web `EmptyState` /
//  `QueryError`). All strings resolve through the P1/S10 facade; all colors /
//  spacing come from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Freshness chip + status accessory (live / stale / offline)

/// Header chip flagging live / stale / offline data (web freshness indicator).
struct SummarySlideFreshnessChip: View {
    let freshness: SummarySlideFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: SummarySlideStrings.string("yearReview.summary.live", "Live")
        case .stale: SummarySlideStrings.string("yearReview.summary.stale", "Stale")
        case .offline: SummarySlideStrings.string("yearReview.summary.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Freshness chip + an in-flight spinner + a refresh control (web refetch).
struct SummaryStatusAccessory: View {
    let freshness: SummarySlideFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            SummarySlideFreshnessChip(freshness: freshness)
            if refreshing {
                ProgressView().controlSize(.mini)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(SummarySlideStrings.text("yearReview.summary.refresh", "Refresh"))
        }
    }
}

/// Capsule retry button shared by the error + offline states (web `QueryError`).
struct SummaryRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            SummarySlideStrings.text("yearReview.summary.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SummarySlideStrings.text("yearReview.summary.retry", "Retry"))
    }
}

// MARK: - Card header (web year / title / vehicle block)

/// The card's top row: the year + "Year in Review" on the leading edge, the
/// vehicle name + model on the trailing edge (web `flex items-center justify-between`).
struct SummaryCardHeader: View {
    let header: SummaryHeader

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: header.yearText)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: header.titleText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: TSSpacing.md)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: header.vehicleName)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: header.vehicleModel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim:
            "\(header.titleText) \(header.yearText), \(header.vehicleName) \(header.vehicleModel)"))
    }
}

// MARK: - Stat row (web `AnimatedNumber` + Lucide icon)

/// One headline stat row: the Lucide-mapped icon, the `AnimatedNumber` value, and
/// the label (web `<stat.icon/> <AnimatedNumber/> <span>{stat.label}</span>`).
/// Uses the shared `TSAnimatedNumber` (data-display) for the reduce-motion-aware
/// count animation.
struct SummaryStatRow: View {
    let stat: SummaryStat

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: stat.iconSystemName)
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 22)
                .accessibilityHidden(true)
            TSAnimatedNumber(formatted: stat.formattedValue)
                .frame(minWidth: 64, alignment: .leading)
            Text(verbatim: stat.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(stat.formattedValue) \(stat.label)"))
    }
}

/// The staggered list of stat rows (web `stats.map` with a per-index motion delay),
/// composed with the shared motion `TSStaggerContainer` / `TSStaggerItem`.
struct SummaryStatList: View {
    let stats: [SummaryStat]

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(stats.enumerated()), id: \.element.id) { index, stat in
                TSStaggerItem(index: index) {
                    SummaryStatRow(stat: stat)
                }
            }
        }
    }
}

// MARK: - Savings line (web `data.gas_savings > 0 && …`)

/// The conditional savings footer (web emerald `💰 Saved $… vs. gas`), shown only
/// when the projection carries a savings value.
struct SummarySavingsFooter: View {
    let savings: SummarySavings

    var body: some View {
        VStack(spacing: 0) {
            Divider().overlay(Color.TS.border)
            Text(verbatim: "💰 \(savings.text)")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusSuccess)
                .multilineTextAlignment(.center)
                .padding(.top, TSSpacing.md)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: savings.text))
    }
}

// MARK: - The screenshot card (web `motion.div` gradient card)

/// The screenshot-friendly recap card (web's rounded glass card). Composes the
/// header, the staggered stats, the optional savings line, and the brand caption,
/// then the freshness accessory on top. This is the loaded "content" state.
struct SummaryRecapCard: View {
    let projection: SummaryProjection
    let freshness: SummarySlideFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top) {
                SummaryCardHeader(header: projection.header)
                Spacer(minLength: TSSpacing.sm)
                SummaryStatusAccessory(freshness: freshness, refreshing: refreshing, onRefresh: onRefresh)
            }
            SummaryStatList(stats: projection.stats)
            if let savings = projection.savings {
                SummarySavingsFooter(savings: savings)
            }
            Text(verbatim: projection.brandLine)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: 420)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityElement(children: .contain)
    }
}

/// The caption under the card (web `📸 Screenshot to share your year!`).
struct SummaryShareHint: View {
    let hint: String

    var body: some View {
        Text(verbatim: hint)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .accessibilityLabel(Text(verbatim: hint))
    }
}

// MARK: - Empty / error / offline / loading states

/// The friendly empty state for a zero-activity review (never a blank card).
struct SummaryEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SummarySlideStrings.text("yearReview.summary.empty.title", "No year in review yet")
            } icon: {
                Image(systemName: "sparkles")
            }
        } description: {
            SummarySlideStrings.text(
                "yearReview.summary.empty.message",
                "Drive and charge through the year and your recap will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct SummaryErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SummarySlideStrings.text("yearReview.summary.errorTitle", "Couldn't load your year in review")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if retryable {
                SummaryRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state (web offline fallback) with retry.
struct SummaryOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            SummarySlideStrings.text("yearReview.summary.offlineMessage", "Offline — showing your last saved recap")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            SummaryRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// Skeleton chrome shown during the initial fetch (web `Skeleton`); its a11y label
/// is the loading message.
struct SummaryLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 90, height: 24)
                    TSSkeleton(width: 130, height: 12)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 110, height: 12)
                    TSSkeleton(width: 70, height: 10)
                }
            }
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 22, height: 22, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 64, height: 20)
                    TSSkeleton(height: 12)
                }
            }
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: 420)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityElement()
        .accessibilityLabel(SummarySlideStrings.text("yearReview.summary.loading", "Loading your year in review…"))
    }
}
