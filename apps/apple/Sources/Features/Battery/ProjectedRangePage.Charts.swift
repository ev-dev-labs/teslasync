import SwiftUI

// The two charts on the Projected-Range surface, built on the P3 native Swift Charts wrappers
// (never a WKWebView): the efficiency `RadialGauge` (web Section 2 left) and the rated-vs-projected
// `AreaChart` (web Section 2 right). Each renders its own empty state (never a blank region) and an
// accessible summary; SI metres convert to the user's distance unit at this boundary (ADR-005).

// MARK: - Efficiency gauge (web Section 2 — GlassPanel6 + RadialGauge)

/// The efficiency-gauge panel (web `GlassPanel` + `RadialGauge`): the 0…100 % efficiency factor as
/// a radial gauge tinted by the web color bands, captioned with the server accuracy note.
struct ProjectedRangeGaugeSection: View {
    let projection: ProjectedRangeSnapshot
    let colorIndex: Int

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                TSRadialGauge(
                    value: projection.efficiencyFactor,
                    label: "range.efficiency",
                    colorIndex: colorIndex
                )
                if projection.hasAccuracyNote {
                    Text(verbatim: projection.accuracyNote)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 220)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Projection curve (web Section 2 — GlassPanel7 + AreaChart)

/// The range-projection-curve panel (web `GlassPanel` + `AreaChart`): the rated and projected
/// range across the battery sweep as two gradient areas, with a current-battery marker (web
/// `ReferenceLine`), or the no-curve empty state.
struct ProjectedRangeCurveSection: View {
    let projection: ProjectedRangeSnapshot
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("range.projectionCurve")
                if projection.hasCurve {
                    TSAreaChart(series: [ratedSeries, projectedSeries])
                        .frame(height: 260)
                        .accessibilityLabel(Text("range.projectionCurve"))
                        .accessibilityValue(Text(verbatim: accessibilitySummary))
                    legend
                } else {
                    TSEmptyState(title: "range.projectionCurve", systemImage: "chart.xyaxis.line")
                        .frame(maxWidth: .infinity, minHeight: 260)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var ratedSeries: TSChartSeries {
        TSChartSeries(id: "rated", name: "range.rated", nameText: "Rated Range",
                      points: points(\.ratedRangeM, "r"), colorIndex: 0)
    }

    private var projectedSeries: TSChartSeries {
        TSChartSeries(id: "projected", name: "range.projected", nameText: "Projected Range",
                      points: points(\.projectedRangeM, "p"), colorIndex: 1)
    }

    /// Maps the curve points to the user's distance unit at the render boundary (ADR-005).
    private func points(_ keyPath: KeyPath<RangeCurvePoint, Double>, _ prefix: String) -> [TSChartPoint] {
        projection.projectionCurve.map { point in
            TSChartPoint(
                x: point.batteryPct,
                y: Units.convertDistance(point[keyPath: keyPath], units),
                id: "\(prefix)-\(point.batteryPct)"
            )
        }
    }

    /// Web `<Legend />` + the `ReferenceLine` "Current" marker, as a compact legend row.
    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(color: TSChartPalette.color(at: 0), label: "range.rated")
            legendItem(color: TSChartPalette.color(at: 1), label: "range.projected")
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.xs) {
                TSCaption("range.current")
                Text(verbatim: ProjectedRangePageFormat.batteryPercent(projection.batteryLevel))
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    private func legendItem(color: Color, label: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            TSCaption(label)
        }
    }

    private var accessibilitySummary: String {
        TSChartFormat.summary(for: projectedSeries)
    }
}
