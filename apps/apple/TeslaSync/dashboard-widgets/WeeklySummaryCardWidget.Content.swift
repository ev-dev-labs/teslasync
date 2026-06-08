//
//  WeeklySummaryCardWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  The content-layout leaf views the WeeklySummaryCardWidget surface composes:
//  the compact hero (web compact branch), the responsive stat-card grid (web
//  `grid-cols-2` / `grid-cols-4` with the cost + efficiency cards gated on
//  wide/tall + the `InlineMetric` footer) and the stale/offline connectivity
//  banner. Each is a self-contained, parameterized `View` (not a private helper
//  on the surface) so the file stays within the house length limit while keeping
//  the surface struct's chrome encapsulated.
//

import Foundation
import SwiftUI

// MARK: - Grid layout helper

/// Shared responsive layout math for the loading skeleton and the live stat
/// grid: 4 columns when wide else 2, and the matching card count (web
/// `isWide ? 'grid-cols-4' : 'grid-cols-2'` + `{(isWide || isTall) && …}`).
enum WeeklyGridLayout {
    static func columns(isWide: Bool) -> [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
            count: isWide ? 4 : 2
        )
    }

    static func tileCount(isWide: Bool, isTall: Bool) -> Int {
        isWide || isTall ? 4 : 2
    }
}

// MARK: - Compact content (web compact branch)

/// The compact (1×1) layout: a single large distance number with a unit + "this
/// week" caption (web `<span>{fmtNumber(distance, 0)}</span>` + caption).
struct WeeklyCompactContent: View {
    let projection: WeeklySummaryProjection

    var body: some View {
        VStack(spacing: 2) {
            WeeklySummaryBigNumber(formatted: projection.distanceCompactValue)
            HStack(spacing: 4) {
                Text(verbatim: projection.distanceUnit)
                WeeklySummaryStrings.text("widget.weeklySummary.thisWeek", "this week")
            }
            .font(Font.TS.caption)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let thisWeek = WeeklySummaryStrings.string("widget.weeklySummary.thisWeek", "this week")
        return "\(projection.distanceCompactValue) \(projection.distanceUnit) \(thisWeek)"
    }
}

// MARK: - Stat grid (web standard / wide / tall branch)

/// The responsive stat-card grid: a stale/offline banner, the Distance + Energy
/// cards (plus Cost + Efficiency when wide or tall), and a compact inline footer
/// (cost + efficiency) when neither — the native parity of the web grid + footer.
struct WeeklyStatGrid: View {
    let projection: WeeklySummaryProjection
    let connection: WeeklyConnection
    let isWide: Bool
    let isTall: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if connection != .live { WeeklyConnectivityBanner(connection: connection) }
            LazyVGrid(columns: WeeklyGridLayout.columns(isWide: isWide), alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(tiles) { tile in
                    WeeklyStatTile(data: tile)
                }
            }
            if !isWide, !isTall { inlineFooter }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }

    private var inlineFooter: some View {
        HStack {
            WeeklyInlineMetric(
                systemImage: "dollarsign",
                value: projection.costValue,
                accessibilityLabel: "\(WeeklySummaryStrings.string("widget.weeklySummary.cost", "Cost")) "
                    + projection.costValue
            )
            Spacer(minLength: TSSpacing.sm)
            WeeklyInlineMetric(
                systemImage: "gauge.medium",
                value: "\(projection.efficiencyValue) \(projection.efficiencyUnit)",
                accessibilityLabel: "\(WeeklySummaryStrings.string("widget.weeklySummary.efficiency", "Efficiency")) "
                    + "\(projection.efficiencyValue) \(projection.efficiencyUnit)"
            )
        }
        .padding(.horizontal, TSSpacing.xs)
    }

    /// Distance + Energy always; Cost + Efficiency when wide or tall.
    private var tiles: [WeeklyStatTileData] {
        var tiles: [WeeklyStatTileData] = [
            WeeklyStatTileData(
                id: "distance",
                label: WeeklySummaryStrings.string("widget.weeklySummary.distance", "Distance"),
                value: projection.distanceValue,
                unit: projection.distanceUnit,
                systemImage: "road.lanes",
                trend: projection.distanceTrend
            ),
            WeeklyStatTileData(
                id: "energy",
                label: WeeklySummaryStrings.string("widget.weeklySummary.energy", "Energy"),
                value: projection.energyValue,
                unit: "kWh",
                systemImage: "bolt.fill",
                trend: projection.energyTrend
            )
        ]
        if isWide || isTall {
            tiles.append(WeeklyStatTileData(
                id: "cost",
                label: WeeklySummaryStrings.string("widget.weeklySummary.cost", "Cost"),
                value: projection.costValue,
                unit: nil,
                systemImage: "dollarsign.circle.fill",
                trend: projection.costTrend
            ))
            tiles.append(WeeklyStatTileData(
                id: "efficiency",
                label: WeeklySummaryStrings.string("widget.weeklySummary.efficiency", "Efficiency"),
                value: projection.efficiencyValue,
                unit: projection.efficiencyUnit,
                systemImage: "gauge.medium",
                trend: projection.efficiencyTrend
            ))
        }
        return tiles
    }
}

// MARK: - Connectivity banner (web stale/offline chrome)

/// The stale/offline banner shown above the grid when the live query is not
/// fresh — the native parity of the web `DataFreshness` degraded chip.
struct WeeklyConnectivityBanner: View {
    let connection: WeeklyConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.weeklySummary.offlineBanner" : "widget.weeklySummary.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced week"
            : "Reconnecting — figures may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            WeeklySummaryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
