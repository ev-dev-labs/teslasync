//
//  FleetStatsBar.Chart.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  The inline trend sparkline rendered inside the Distance / Energy cards — the native
//  parity of the web `<MiniChart>` (features/dashboard/components/FleetStatsBar.tsx
//  feeds it `recentDrives.distance_m` / `recentCharges.total_energy_added_wh`,
//  reversed). The web `MiniChart` draws a bare `<polyline>` (straight segments, 1.5pt,
//  round caps) auto-scaled to the series min/max, and renders NOTHING when there are
//  fewer than two points — so the line interpolation here is `.linear` (not smoothed)
//  and the caller only mounts this view once the series has ≥ 2 points.
//

import Charts
import SwiftUI

private let fleetSparklineHeight: CGFloat = 24
private let fleetSparklineMaxWidth: CGFloat = 72

/// The compact trend line (web `MiniChart`): a Swift Charts line auto-scaled to the
/// data, axis-free, tinted with the owning card's accent. Decorative — the underlying
/// value is already spoken by the card's combined accessibility label.
struct FleetStatsSparkline: View {
    let values: [Double]
    let color: Color

    private struct Point: Identifiable {
        let id: Int
        let value: Double
    }

    private var points: [Point] {
        values.enumerated().map { Point(id: $0.offset, value: $0.element) }
    }

    var body: some View {
        Chart(points) { point in
            LineMark(
                x: .value("i", point.id),
                y: .value("v", point.value)
            )
            .foregroundStyle(color)
            .interpolationMethod(.linear)
            .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .frame(maxWidth: fleetSparklineMaxWidth)
        .frame(height: fleetSparklineHeight)
        .accessibilityHidden(true)
    }
}
