//
//  SummaryStatsRow.Views.swift
//  TeslaSync — P4 feature view · 0048 · SummaryStatsRow (Apple)
//
//  The presentational subviews composed by `SummaryStatsRow`: the responsive
//  one/two/four-column grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), the
//  metric tile (web `<MetricCard>` — label + bold value + tinted SF Symbol badge),
//  and the loading skeleton row. All consume the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Accent → design token (web `MetricCard color` → brand `Color`)

extension SummaryStatAccent {
    /// The brand token color for the tile's icon badge. Semantic (ADR-006) parity
    /// with the web `NeonColor`: green/red map to the status roles, cyan to the
    /// brand accent, and blue/purple to the brand chart-series roles (the closest
    /// token hues) so the four tiles stay visually distinct without porting hex.
    var color: Color {
        switch self {
        case .secure: Color.TS.statusSuccess
        case .unsecure: Color.TS.statusDanger
        case .lastLock: Color.TS.accent
        case .uptime: Color.TS.chartSeriesSpeed
        case .events: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Tile value resolution (web `t()` + `timeSince` at the display boundary)

extension SummaryStatTile {
    /// The localised label (web `t(labelKey, fallback)`).
    var resolvedLabel: String {
        SSRStrings.string(labelKey, labelFallback)
    }

    /// The localised display value: `Secure` / `Unsecure` (web ternary), the
    /// relative-time wording, or a pre-formatted numeric string rendered verbatim.
    var resolvedValue: String {
        switch value {
        case let .secure(isSecure):
            SSRStrings.string(
                isSecure ? "admin.security.secure" : "admin.security.unsecure",
                isSecure ? "Secure" : "Unsecure"
            )
        case let .relative(bucket):
            SSRStrings.relativeTime(bucket)
        case let .text(text):
            text
        }
    }
}

// MARK: - Icon badge (web `MetricCard` icon box: `c.bg` / `c.ring` / `c.text`)

/// The tinted SF Symbol badge — the native parity of the web `MetricCard` icon box
/// (`rounded-lg p-1.5 ring-1` with the color's 10%-fill / 20%-ring / solid glyph).
/// Parameterised by a brand `Color` so each tile keeps its distinct accent.
struct SSRIconBadge: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 32, height: 32)
            .background(
                color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(color.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Metric tile (web `<MetricCard label value icon color>`)

/// One resolved metric tile — the SwiftUI parity of a single web `<MetricCard>`:
/// the label + bold value on the leading edge and the tinted icon badge trailing,
/// inside the glass card surface. The value text uses the primary text role (web
/// `text-[var(--text-primary)]`); only the badge carries the accent.
struct SSRMetricTile: View {
    let tile: SummaryStatTile

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: tile.resolvedLabel)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: tile.resolvedValue)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SSRIconBadge(symbol: tile.symbol, color: tile.accent.color)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SummaryStatsAccessibility.tileLabel(
            label: tile.resolvedLabel, value: tile.resolvedValue
        )))
    }
}

// MARK: - Responsive grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`)

/// A responsive grid that reflows its cells across one / two / four columns at the
/// web Tailwind breakpoints, measured with the iOS 18 / macOS 15 `onGeometryChange`
/// width seam so the column math (`SummaryStatsLayout`) stays pure + testable.
struct SSRResponsiveGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    @ViewBuilder let cell: (Item) -> Cell

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
            count: SummaryStatsLayout.columnCount(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(items) { item in
                cell(item)
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Data row (web resolved branch — four `<MetricCard>` in a `<FadeIn>`)

/// The resolved row of four metric tiles (web non-loading branch), wrapped in the
/// shared fade-in (web `<FadeIn>`).
struct SSRStatsRow: View {
    let tiles: [SummaryStatTile]

    var body: some View {
        TSFadeIn {
            SSRResponsiveGrid(items: tiles) { tile in
                SSRMetricTile(tile: tile)
            }
        }
    }
}

// MARK: - Loading row (web `Array.from({length:4}).map(<Skeleton height={88}/>)`)

/// One skeleton slot identity for the loading grid.
private struct SSRSkeletonSlot: Identifiable {
    let id: Int
}

/// The in-flight skeleton row (web loading branch): four 88pt redacted blocks laid
/// out in the same responsive grid, so the row keeps its shape while data loads.
struct SSRLoadingRow: View {
    private let slots = (0 ..< 4).map(SSRSkeletonSlot.init)

    var body: some View {
        SSRResponsiveGrid(items: slots) { _ in
            TSSkeleton(height: 88, cornerRadius: TSRadius.lg)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SSRStrings.string(
            "admin.security.stat.loadingA11y", "Loading security summary"
        )))
    }
}
