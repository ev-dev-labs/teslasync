//
//  TemperatureSection.Views.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  Presentational chrome composed by `TemperatureSection`: the series palette, the
//  panel header + freshness chip, the stale/offline banner, the up-to-six stat tiles
//  (web `grid-cols-3`), the bottom legend, and the loading / empty / error states.
//  The Swift Charts line chart + tooltip live in TemperatureSection.Chart.swift. Copy
//  resolves through the P1/S10 facade; chrome is token-driven (P1/S9). No networking
//  and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Series palette (web line `stroke`)

/// The series → stroke mapping. The web colors each line with a fixed Tailwind hue
/// (`#3b82f6` outside, `#f97316` inside, `#fb7185` driver, `#a855f7` passenger);
/// native reads the design-token brand chart colors closest to each (Speed/​Energy/
/// Temperature/​Power) so a line, its legend swatch, and its stat tile always agree
/// and the colors track the theme.
enum TempSectionPalette {
    static func color(for series: TempSectionSeries) -> Color {
        switch series {
        case .outside: Color.TS.chartSeriesSpeed
        case .inside: Color.TS.chartSeriesEnergy
        case .driver: Color.TS.chartSeriesTemperature
        case .passenger: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `Temperatures` with a
/// thermometer glyph + the live-state freshness chip.
struct TempSectionHeader: View {
    let connection: TempSectionConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TempSectionStrings.text("driveDetail.temperatures", "Temperatures")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            TempSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TempSectionFreshnessChip: View {
    let connection: TempSectionConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TempSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TempSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TempSectionConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so a cached trace is clearly labeled (web `DataFreshness` intent).
struct TempSectionConnectivityBanner: View {
    let connection: TempSectionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.offlineBanner" : "driveDetail.staleBanner"
        let fallback = offline
            ? "Offline — showing last known temperatures"
            : "Reconnecting — temperatures may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TempSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat tiles (web `grid-cols-3` cells)

/// One resolved stat tile (label + value + accent), built from the projection.
private struct TempSectionTileItem: Identifiable {
    let id: TempSectionTileKind
    let label: String
    let value: String
    let tone: Color
}

/// The up-to-six stat tiles in a three-column grid (web `grid grid-cols-3 gap-3`):
/// the four series averages, the climate status, and the fan summary — each present
/// only when its value exists.
struct TempSectionStatGrid: View {
    let projection: TempSectionProjection
    let locale: Locale

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: TSSpacing.md),
        count: 3
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(items) { item in
                TempSectionStatTileView(item: item)
            }
        }
    }

    private var items: [TempSectionTileItem] {
        projection.tileKinds.compactMap { kind in tile(for: kind) }
    }

    private func tile(for kind: TempSectionTileKind) -> TempSectionTileItem? {
        switch kind {
        case .outside, .inside, .driver, .passenger:
            seriesTile(for: kind)
        case .climate:
            climateTile()
        case .fan:
            fanTile()
        }
    }

    private func seriesTile(for kind: TempSectionTileKind) -> TempSectionTileItem? {
        guard let series = Self.series(for: kind), let average = projection.average(for: series) else {
            return nil
        }
        let value = TempSectionFormat.temperature(
            average,
            symbol: projection.unitSymbol,
            localeIdentifier: locale.identifier
        )
        return TempSectionTileItem(
            id: kind,
            label: TempSectionStrings.string(series.tileLabelKey, series.tileLabelFallback),
            value: value,
            tone: TempSectionPalette.color(for: series)
        )
    }

    private func climateTile() -> TempSectionTileItem? {
        guard let climate = projection.climate else { return nil }
        return TempSectionTileItem(
            id: .climate,
            label: TempSectionStrings.string("driveDetail.climate", "Climate"),
            value: TempSectionStrings.string(climate.labelKey, climate.labelFallback),
            tone: climate.isOn ? Color.TS.statusSuccess : Color.TS.textMuted
        )
    }

    private func fanTile() -> TempSectionTileItem? {
        guard let maxFan = projection.maxFan else { return nil }
        let avgLabel = TempSectionStrings.string("driveDetail.avg", "Avg")
        let maxLabel = TempSectionStrings.string("driveDetail.max", "Max")
        let avgText = TempSectionFormat.int(projection.avgFan ?? 0, localeIdentifier: locale.identifier)
        let maxText = TempSectionFormat.plain(maxFan, localeIdentifier: locale.identifier)
        return TempSectionTileItem(
            id: .fan,
            label: TempSectionStrings.string("driveDetail.fanStatus", "Fan Status"),
            value: "\(avgLabel) \(avgText) · \(maxLabel) \(maxText)",
            tone: Color.TS.accent
        )
    }

    private static func series(for kind: TempSectionTileKind) -> TempSectionSeries? {
        switch kind {
        case .outside: .outside
        case .inside: .inside
        case .driver: .driver
        case .passenger: .passenger
        case .climate, .fan: nil
        }
    }
}

/// A single stat tile: the muted label over the accent value, in a hairline-bordered
/// card (web `rounded-lg bg-white/[0.03] border-white/[0.06]`).
private struct TempSectionStatTileView: View {
    let item: TempSectionTileItem

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: item.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text(verbatim: item.value)
                .font(Font.TS.body)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(item.tone)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .padding(.horizontal, TSSpacing.xs)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(item.label), \(item.value)"))
    }
}

// MARK: - Legend (web bottom `<Legend>`)

/// The legend: one swatch + "Name °C" label per present series (web `<Line name>` is
/// `${seriesName} ${tempUnit}`), colored from the series palette.
struct TempSectionLegend: View {
    let series: [TempSectionSeries]
    let unitSymbol: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(series) { item in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(TempSectionPalette.color(for: item))
                        .frame(width: 12, height: 8)
                    Text(verbatim: "\(TempSectionStrings.string(item.nameKey, item.nameFallback)) \(unitSymbol)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a row of muted stat tiles over a chart
/// placeholder, respecting Reduce Motion (via `TSSkeleton`). // parity:allow ui
struct TempSectionLoading: View {
    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: TSSpacing.md),
        count: 3
    )

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.sm)
                }
            }
            TSSkeleton(height: 180, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TempSectionStrings.text("driveDetail.tempLoading", "Loading temperatures"))
    }
}

// MARK: - Empty state (web "No temperature telemetry…" overlay)

/// The resolved-but-empty state: the web empty overlay (Activity glyph + sentence)
/// over a native `ContentUnavailableView`. Never a blank box.
struct TempSectionEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TempSectionStrings.text(
                    "driveDetail.noTemperatureData",
                    "No temperature telemetry is available for this drive."
                )
            } icon: {
                Image(systemName: "thermometer.medium.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct TempSectionError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TempSectionStrings.text("driveDetail.tempErrorTitle", "Couldn't load temperatures")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                TempSectionStrings.text("driveDetail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TempSectionStrings.text("driveDetail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
