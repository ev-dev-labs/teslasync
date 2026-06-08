//
//  LifetimeSummary.Views.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  The section header + state bodies composed by `LifetimeSummary`: the always-visible
//  header (trend glyph + title + freshness / connectivity chips), the data body (the
//  seven-tile adaptive grid), and the loading skeleton, empty, and error states. The
//  leaf tiles live in LifetimeSummary.Tiles.swift. All consume the P1/S10 facade and
//  the shared P1/S9 tokens — no networking.
//

import SwiftUI

// MARK: - Section header (web title row + native freshness chrome)

/// The always-visible section header: the trend glyph + "Lifetime Summary" title, a
/// background-refresh spinner while fetching, and the stale / offline chips.
struct LSSectionHeader: View {
    let isFetching: Bool
    let isStale: Bool
    let isOffline: Bool

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: LSStrings.string("costAnalysis.lifetime.title", "Lifetime Summary"))
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if isFetching {
                ProgressView().controlSize(.small)
            }
            if isStale {
                LSChip(
                    text: LSStrings.string("costAnalysis.lifetime.stale", "Stale"),
                    systemImage: "clock.arrow.circlepath",
                    tone: .warning
                )
            }
            if isOffline {
                LSChip(
                    text: LSStrings.string("costAnalysis.lifetime.offline", "Offline"),
                    systemImage: "wifi.slash",
                    tone: .neutral
                )
            }
        }
    }
}

// MARK: - Shared responsive grid

/// Responsive grid columns (single column on narrow, multiple on wide) — the native
/// analogue of the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3`.
enum LSGrid {
    static func columns(minimum: CGFloat = 150) -> [GridItem] {
        [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md, alignment: .top)]
    }
}

// MARK: - Data body (web tile grid)

/// The populated state: the seven lifetime-metric tiles flowing through the adaptive
/// grid, collapsing to a single column on narrow widths.
struct LSDataBody: View {
    let tiles: [LifetimeMetricProjection]

    var body: some View {
        LazyVGrid(columns: LSGrid.columns(), spacing: TSSpacing.md) {
            ForEach(tiles) { LSMetricTile(projection: $0) }
        }
    }
}

// MARK: - Loading (skeleton chrome)

/// One skeleton tile (a glass tile with two redacted lines), matching `LSMetricTile`'s
/// footprint so the layout does not jump when content resolves.
struct LSTileSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSSkeleton(width: 72, height: 9)
            TSSkeleton(width: 96, height: 13)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityHidden(true)
    }
}

/// The first-load state: a grid of skeleton tiles in the same layout as the data body.
struct LSLoadingBody: View {
    var body: some View {
        LazyVGrid(columns: LSGrid.columns(), spacing: TSSpacing.md) {
            ForEach(0 ..< LifetimeMetricKind.allCases.count, id: \.self) { _ in LSTileSkeleton() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LSStrings.string(
            "costAnalysis.lifetime.loadingA11y", "Loading lifetime summary"
        )))
    }
}

// MARK: - Empty (web `: "No data"`)

/// The no-data state: a friendly explanation that lifetime totals appear once a session
/// is recorded (never a blank box). Reproduces the web "No data" string as the title.
struct LSEmptyBody: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: LSStrings.string("costAnalysis.lifetime.noData", "No data"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: LSStrings.string(
                "costAnalysis.lifetime.empty",
                "Lifetime totals appear here once a charging session is recorded for the selected range."
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 128)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (native retry — P4 `QueryError` equivalent)

/// The failure box (warning triangle + message) with the retry affordance the P4 states
/// contract's `QueryError`-equivalent requires, wired to the model's refresh.
struct LSErrorBody: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: LSStrings.string(
                    "costAnalysis.lifetime.error", "Could not load the lifetime summary."
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
                Text(verbatim: LSStrings.string("costAnalysis.lifetime.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: LSStrings.string("costAnalysis.lifetime.retry", "Retry")))
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
