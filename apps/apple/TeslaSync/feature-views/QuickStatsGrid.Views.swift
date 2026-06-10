//
//  QuickStatsGrid.Views.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  The presentational subviews composed by `QuickStatsGrid`: the responsive metric grid
//  (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` → an adaptive `LazyVGrid`), the metric
//  tile (web `<MetricCard>` — label, value, optional subtitle, accented icon box), and the
//  loading / empty / error / connectivity chrome. All consume the P1/S10 facade and the
//  shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `MetricCard` `color` values map
//  cyan → `accent` (the brand cyan that equals web `#00f0ff`), green → `statusSuccess`
//  (web `#10b981`), purple → `chartSeriesPower` (web `#a855f7`).
//

import SwiftUI

// MARK: - Accent mapping (web NeonColor → design token)

extension QuickStatAccent {
    /// The design token the web `MetricCard` `color` maps to (semantic, not literal).
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .purple: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Grid layout (web responsive column track)

/// The shared adaptive column track for the grid + the loading skeleton, so both flow
/// identically (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` — two columns on a phone,
/// more as width allows).
enum QuickStatsGridLayout {
    static let columns = [
        GridItem(.adaptive(minimum: 150, maximum: .infinity), spacing: TSSpacing.md, alignment: .top)
    ]
}

// MARK: - Tile chrome (web `MetricCard` container)

/// The bordered glass tile surface shared by the metric tile and its skeleton (web
/// `p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]`).
private struct QuickStatTileChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

private extension View {
    func quickStatTileChrome() -> some View {
        modifier(QuickStatTileChrome())
    }
}

// MARK: - Accented icon box (web `MetricCard` icon chip)

/// The accented icon chip in the tile's trailing slot (web `rounded-lg p-1.5 ring-1` with
/// the colour's `/10` fill + `/20` ring). Takes an explicit `Color` so the purple accent
/// (which has no `TSTone` case) renders at parity.
struct QuickStatIconBox: View {
    let systemName: String
    let color: Color

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 30, height: 30)
            .background(
                color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(color.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Metric tile (one web `<MetricCard>`)

/// One resolved metric tile — the label, the value, an optional subtitle, and the accented
/// icon box, combined into a single VoiceOver element.
struct QuickStatTileView: View {
    let tile: QuickStatTileModel

    private var label: String {
        QuickStatsStrings.string(tile.labelKey, tile.labelFallback)
    }

    private var subtitle: String? {
        guard let key = tile.subtitleKey, let fallback = tile.subtitleFallback else { return nil }
        return QuickStatsStrings.string(key, fallback)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: tile.value)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            QuickStatIconBox(systemName: tile.iconSystemName, color: tile.accent.color)
        }
        .quickStatTileChrome()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: QuickStatsAccessibility.tileLabel(
            label: label,
            value: tile.value,
            subtitle: subtitle
        )))
    }
}

// MARK: - Grid body (web non-loading render)

/// The resolved grid — the eight metric tiles in the adaptive column track, wrapped in the
/// shared fade-in (web `FadeIn`).
struct QuickStatsGridContent: View {
    let tiles: [QuickStatTileModel]

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: QuickStatsGridLayout.columns, spacing: TSSpacing.md) {
                ForEach(tiles) { tile in
                    QuickStatTileView(tile: tile)
                }
            }
        }
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: eight skeleton tiles in the same grid so the surface keeps its
/// shape while the parent query resolves.
struct QuickStatsLoadingGrid: View {
    var body: some View {
        LazyVGrid(columns: QuickStatsGridLayout.columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 8, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 56, height: 10)
                    TSSkeleton(width: 88, height: 18)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .quickStatTileChrome()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: QuickStatsStrings.string("quickStats.loadingA11y", "Loading vehicle stats")))
    }
}

/// The empty render: a friendly state shown when the parent resolved with no vehicle
/// state, never a blank grid.
struct QuickStatsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: QuickStatsStrings.string("quickStats.emptyTitle", "No vehicle data"))
            } icon: {
                Image(systemName: "gauge.medium")
            }
        } description: {
            Text(verbatim: QuickStatsStrings.string(
                "quickStats.empty",
                "Live stats will appear once the vehicle reports in."
            ))
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance, shown only when
/// there is no cached vehicle state to fall back to.
struct QuickStatsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: QuickStatsStrings.string("quickStats.errorTitle", "Couldn't load vehicle stats"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: QuickStatsStrings.string("quickStats.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: QuickStatsStrings.string("quickStats.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Connectivity banner (P4 leaf freshness axis)

/// The stale / offline banner shown above the grid when the feed is not live: a freshness
/// chip + message + a refresh affordance. Cached tiles stay visible beneath it.
struct QuickStatsConnectivityBanner: View {
    let connection: QuickStatsConnection
    let onRefresh: () -> Void

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var chipLabel: String {
        isOffline
            ? QuickStatsStrings.string("quickStats.offline", "Offline")
            : QuickStatsStrings.string("quickStats.stale", "Stale")
    }

    private var message: String {
        isOffline
            ? QuickStatsStrings.string("quickStats.offlineBanner", "Offline — showing last known data")
            : QuickStatsStrings.string("quickStats.staleBanner", "Reconnecting — data may be stale")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .lineLimit(2)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: "\(chipLabel). \(message)"))

            Spacer(minLength: TSSpacing.sm)

            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: QuickStatsStrings.string("quickStats.refresh", "Refresh")))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }
}
