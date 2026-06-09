//
//  WeekOverWeekSummary.Views.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  The composable sub-views for the weekly-digest "Week-over-Week Comparison" grid —
//  the native port of the web `StatCard` plus the freshness / offline / error chrome
//  the page owner contributes. Every view is token-driven (P1/S9), localizes through
//  `WeekOverWeekStrings` (P1/S10), reuses the shared component library
//  (`@/components/ui`, `@/components/data-display`, `@/components/motion`), and carries
//  VoiceOver labels. No view performs networking — they read the bound model.
//

import SwiftUI

// MARK: - i18n SwiftUI bridge (P1/S10)

extension WeekOverWeekStrings {
    /// Resolved value wrapped as a `LocalizedStringKey` for shared components that
    /// accept one; the resolved string is not a main-catalog key, so SwiftUI renders it
    /// verbatim.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Stat tile (web `StatCard`)

/// A solid metric tile: a label + icon row, a bold value with an optional unit, and an
/// optional trend chip — the native port of the web `StatCard`. Read as a single
/// VoiceOver element with the composed label.
struct WeekOverWeekStatTile: View {
    let item: WeekOverWeekStatItem

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                labelRow
                valueRow
                if let trend = item.trend {
                    WeekOverWeekTrendChip(trend: trend)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WeekOverWeekAccessibility.tileLabel(item)))
    }

    /// Web `flex items-center justify-between` — label leading, icon trailing.
    private var labelRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: WeekOverWeekStrings.string(item.labelKey, item.labelFallback))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Image(systemName: item.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }

    /// Web `flex items-baseline gap-1` — large value with an optional small unit.
    private var valueRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: item.value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let unitKey = item.unitKey, let unitFallback = item.unitFallback {
                Text(verbatim: WeekOverWeekStrings.string(unitKey, unitFallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

// MARK: - Trend chip (web `StatCard` trend row)

/// The week-over-week trend row. The arrow follows `trend.direction` (the numeric
/// up/down/flat glyph), while the color is the web `StatCard` tri-state
/// `positive ? green : direction === 'flat' ? muted : red`. Folded into the parent
/// tile's accessibility label.
struct WeekOverWeekTrendChip: View {
    let trend: WeekOverWeekTrend

    private var tone: Color {
        if trend.positive { return Color.TS.statusSuccess }
        return trend.direction == .flat ? Color.TS.textMuted : Color.TS.statusDanger
    }

    private var symbol: String {
        switch trend.direction {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .flat: "minus"
        }
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
            Text(verbatim: trend.value)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
        }
        .foregroundStyle(tone)
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (native connectivity chrome)

/// The surface freshness chip (stale / offline) — a colored dot + label. Shown only
/// when degraded; a fresh surface carries no chip (web has no such chrome).
struct WeekOverWeekFreshnessChip: View {
    let connection: WeekOverWeekConnection

    private var tone: Color {
        switch connection {
        case .online: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        WeekOverWeekAccessibility.freshnessLabel(connection)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Offline banner (cached comparison stays visible)

/// Shown above the grid while offline: the last comparison remains visible behind this
/// notice (web cache-then-network keep-last behavior).
struct WeekOverWeekOfflineBanner: View {
    var body: some View {
        WeekOverWeekNoticeBanner(
            systemImage: "wifi.slash",
            tone: Color.TS.statusWarning,
            titleKey: WeekOverWeekKeys.offline,
            titleFallback: "Offline",
            messageKey: WeekOverWeekKeys.offlineMessage,
            messageFallback: "You're offline. Showing the last saved comparison."
        )
    }
}

// MARK: - Error banner (failed with a cached comparison)

/// Shown above the grid when a refresh fails but a previous comparison is still on
/// screen: a retry affordance that keeps the cached data visible.
struct WeekOverWeekErrorBanner: View {
    let onRetry: () -> Void

    var body: some View {
        WeekOverWeekNoticeBanner(
            systemImage: "exclamationmark.triangle.fill",
            tone: Color.TS.statusDanger,
            titleKey: WeekOverWeekKeys.errorTitle,
            titleFallback: "Couldn't refresh",
            messageKey: WeekOverWeekKeys.errorMessage,
            messageFallback: "Showing the last saved comparison."
        ) {
            TSButton(
                WeekOverWeekStrings.key(WeekOverWeekKeys.refresh, "Refresh"),
                variant: .secondary,
                size: .small,
                action: onRetry
            )
            .accessibilityHint(WeekOverWeekStrings.key(WeekOverWeekKeys.refreshHint, "Re-pull the weekly digest"))
        }
    }
}

// MARK: - Notice banner shell

/// A leading-icon notice row with a title, message, and optional trailing accessory —
/// the shared shell behind the offline + error banners.
struct WeekOverWeekNoticeBanner<Accessory: View>: View {
    let systemImage: String
    let tone: Color
    let titleKey: String
    let titleFallback: String
    let messageKey: String
    let messageFallback: String
    @ViewBuilder var accessory: () -> Accessory

    init(
        systemImage: String,
        tone: Color,
        titleKey: String,
        titleFallback: String,
        messageKey: String,
        messageFallback: String,
        @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }
    ) {
        self.systemImage = systemImage
        self.tone = tone
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.accessory = accessory
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: WeekOverWeekStrings.string(titleKey, titleFallback))
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: WeekOverWeekStrings.string(messageKey, messageFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            accessory()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            tone.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (initial-mount chrome)

/// A skeleton stat tile shown while the surface resolves its first snapshot.
struct WeekOverWeekSkeletonTile: View {
    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 72, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                }
                TSSkeleton(width: 110, height: 24)
                TSSkeleton(width: 56, height: 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHidden(true)
    }
}
