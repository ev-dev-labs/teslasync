//
//  VehicleCharts.Views.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The composed sections + their furniture: the section header (web `<h3
//  className="section-title">` icon + title), the metric tile (web `MetricCard`),
//  the adaptive tile grid (web `grid grid-cols-2 sm:grid-cols-3 …`), and the three
//  non-map sections — Vehicle Configuration, Car Display Preferences, and Speed
//  History (the live-map section lives in VehicleCharts.Map.swift). Every panel is
//  a token-driven glass surface (P1/S9) and every string resolves through the
//  P1/S10 facade — never a blank box, never a literal.
//

import SwiftUI

// MARK: - Section header (web `<h3 className="section-title">` icon + title)

/// A section heading: a tinted leading glyph + the localized title, marked as an
/// accessibility header (web `section-title` with a lucide icon).
struct VehicleChartsSectionHeader: View {
    let systemImage: String
    let tint: Color
    let title: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Metric tile (web `MetricCard`)

/// A compact label / value tile (web `MetricCard`): a truncated muted label over a
/// bold value, on a subtle bordered surface. Rendered verbatim (the strings are
/// pre-resolved), combined into one VoiceOver element.
struct VehicleChartsMetricTile: View {
    let tile: VehicleChartsTile

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: tile.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: tile.value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(tile.label), \(tile.value)"))
    }
}

// MARK: - Tile grid (web responsive `grid`)

/// An adaptive grid of metric tiles (web `grid grid-cols-2 sm:grid-cols-3 …`),
/// flowing into as many columns as the width allows.
struct VehicleChartsTileGrid: View {
    let tiles: [VehicleChartsTile]

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(tiles) { tile in
                VehicleChartsMetricTile(tile: tile)
            }
        }
    }
}

// MARK: - Vehicle configuration section (web `{vehicleConfigData && …}`)

/// The Vehicle Configuration panel — the localized title over the 18-tile grid.
struct VehicleChartsConfigSection: View {
    let config: VehicleChartsConfig
    let localize: (String, String) -> String

    private var tiles: [VehicleChartsTile] {
        VehicleChartsConfigTiles.make(config: config, localize: localize)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VehicleChartsSectionHeader(
                systemImage: "car.fill",
                tint: Color.TS.chartSeriesPower,
                title: VehicleChartsLabels.vehicleConfigTitle(localize: localize)
            )
            VehicleChartsTileGrid(tiles: tiles)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.xl)
        .tsGlassPanel()
    }
}

// MARK: - Car display preferences section (web `{userPrefData && …}`)

/// The Car Display Preferences panel — the title, the helper copy, and the 5-tile
/// grid (web `parseSettingEnum` values).
struct VehicleChartsPreferencesSection: View {
    let preferences: VehicleChartsPreferences
    let localize: (String, String) -> String

    private var tiles: [VehicleChartsTile] {
        VehicleChartsPreferenceTiles.make(preferences: preferences, localize: localize)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VehicleChartsSectionHeader(
                systemImage: "gearshape.fill",
                tint: Color.TS.statusWarning,
                title: VehicleChartsLabels.carPreferencesTitle(localize: localize)
            )
            Text(verbatim: VehicleChartsLabels.preferencesHelper(localize: localize))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            VehicleChartsTileGrid(tiles: tiles)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.xl)
        .tsGlassPanel()
    }
}

// MARK: - Speed history section (web Battery & Speed chart — always rendered)

/// The Speed History panel — the title over the area chart, or the friendly
/// "Position data will appear here" message when there is no speed data. Always
/// rendered (web always shows this panel), never a blank box.
struct VehicleChartsSpeedSection: View {
    let samples: [VehicleChartsSpeedSample]
    let units: any VehicleChartsUnits
    let formatting: any VehicleChartsFormatting
    let localize: (String, String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VehicleChartsSectionHeader(
                systemImage: "waveform.path.ecg",
                tint: Color.TS.accent,
                title: VehicleChartsLabels.speedHistoryTitle(localize: localize)
            )
            if samples.isEmpty {
                emptyChart
            } else {
                VehicleChartsSpeedChart(
                    samples: samples,
                    units: units,
                    formatting: formatting,
                    localize: localize
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.xl)
        .tsGlassPanel()
    }

    /// The no-data state inside the panel (web `<p>{positionDataWillAppear}</p>`).
    private var emptyChart: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.xyaxis.line")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: VehicleChartsLabels.positionDataWillAppear(localize: localize))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 256)
        .accessibilityElement(children: .combine)
    }
}
