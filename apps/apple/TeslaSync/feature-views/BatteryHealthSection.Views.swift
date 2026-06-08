//
//  BatteryHealthSection.Views.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  The section header + state bodies composed by `BatteryHealthSection`: the
//  always-visible header (battery glyph + title + freshness / connectivity chips),
//  the data body (the pills grid above the stats grid), and the loading skeleton,
//  empty, and error states. The leaf tiles live in BatteryHealthSection.Tiles.swift.
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking.
//

import SwiftUI

// MARK: - Section header (web title row + native freshness chrome)

/// The always-visible section header: the battery glyph + "Battery Health" title,
/// a background-refresh spinner while fetching, and the stale / offline chips.
struct BHSectionHeader: View {
    let isFetching: Bool
    let isStale: Bool
    let isOffline: Bool

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "minus.plus.batteryblock")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            Text(verbatim: BHStrings.string("analytics.weeklyDigest.batteryHealth", "Battery Health"))
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if isFetching {
                ProgressView().controlSize(.small)
            }
            if isStale {
                BHChip(
                    text: BHStrings.string("analytics.weeklyDigest.stale", "Stale"),
                    systemImage: "clock.arrow.circlepath",
                    tone: .warning
                )
            }
            if isOffline {
                BHChip(
                    text: BHStrings.string("analytics.weeklyDigest.offline", "Offline"),
                    systemImage: "wifi.slash",
                    tone: .neutral
                )
            }
        }
    }
}

// MARK: - Data body (web pills grid + stats grid)

/// The populated state: the two pills (web `sm:grid-cols-2`) above the three stats
/// (web `sm:grid-cols-3`), each collapsing to a single column on narrow widths.
struct BHDataBody: View {
    let pills: [BatteryPillProjection]
    let stats: [MiniStatProjection]

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            LazyVGrid(columns: BHGrid.columns(minimum: 220), spacing: TSSpacing.lg) {
                ForEach(pills) { BatteryPillView(pill: $0) }
            }
            LazyVGrid(columns: BHGrid.columns(minimum: 150), spacing: TSSpacing.md) {
                ForEach(stats) { MiniStatView(stat: $0) }
            }
        }
    }
}

/// Shared responsive grid columns (single column on narrow, multi on wide).
enum BHGrid {
    static func columns(minimum: CGFloat) -> [GridItem] {
        [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.lg, alignment: .top)]
    }
}

// MARK: - Loading (skeleton chrome)

/// One skeleton tile (a glass tile with redacted lines + an optional bar).
struct BHTileSkeleton: View {
    var showsBar = false

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 22, height: 22, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(width: 96, height: 9)
                TSSkeleton(width: 56, height: 12)
            }
            Spacer(minLength: TSSpacing.sm)
            if showsBar {
                TSSkeleton(width: 64, height: 8, cornerRadius: TSRadius.sm)
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityHidden(true)
    }
}

/// The first-load state: skeleton pills + skeleton stats in the same grids as the
/// data body, so the layout does not jump when content resolves.
struct BHLoadingBody: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            LazyVGrid(columns: BHGrid.columns(minimum: 220), spacing: TSSpacing.lg) {
                ForEach(0 ..< 2, id: \.self) { _ in BHTileSkeleton(showsBar: true) }
            }
            LazyVGrid(columns: BHGrid.columns(minimum: 150), spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in BHTileSkeleton() }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: BHStrings.string(
            "analytics.weeklyDigest.batteryHealth.loadingA11y", "Loading battery health"
        )))
    }
}

// MARK: - Empty (web parent `!hasData`)

/// The no-charging state: a friendly explanation that battery health appears once a
/// session is recorded (never a blank box).
struct BHEmptyBody: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: BHStrings.string(
                "analytics.weeklyDigest.batteryHealth.emptyTitle", "No charging this week"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: BHStrings.string(
                "analytics.weeklyDigest.batteryHealth.empty",
                "Battery health appears here once a charge session is recorded for the selected week."
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web parent error + native retry)

/// The failure box (warning triangle + message) with the retry affordance the P4
/// states contract's `QueryError`-equivalent requires, wired to the model's refresh.
struct BHErrorBody: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: BHStrings.string(
                    "analytics.weeklyDigest.batteryHealth.error", "Could not load battery health for this week."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: BHStrings.string("analytics.weeklyDigest.batteryHealth.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: BHStrings.string(
                "analytics.weeklyDigest.batteryHealth.retry", "Retry"
            )))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
    }
}
