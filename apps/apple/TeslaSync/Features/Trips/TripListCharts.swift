import Charts
import SwiftUI

// The native Swift Charts surface (never a WKWebView) for the Trips list page: the top-trips-by-
// distance horizontal bar chart (web Recharts `BarChart` with `layout="vertical"`) framed by the
// `ChartContainer` parity panel (titled, aria-labelled, fixed height, CSV / JSON export actions, and
// the `trips.chart.empty` empty state — never a blank region). Distances convert from SI metres to
// the user's unit at this render boundary via `TripListFormat` (P1/S5, ADR-005); colors / typography
// resolve from the P2 tokens.

// MARK: - Chart datum (web `chartData` element)

/// One plotted bar — the native peer of the web `chartData` element: the trip's display name (or the
/// `Trip #{id}` fallback) and its distance already converted to the user's unit.
struct TripListChartPoint: Identifiable, Equatable {
    let id: Int64
    let name: String
    let distance: Double
}

// MARK: - Bar chart (web `BarChart layout="vertical"`)

/// The top-trips-by-distance horizontal bar chart (web Recharts `BarChart` with `layout="vertical"`):
/// one `BarMark` per trip, the longest at the top, tinted with the brand-accent gradient the web uses
/// (`#00f0ff`). The caller renders the empty state, so this view always has bars to plot.
struct TripDistanceBarChart: View {
    let points: [TripListChartPoint]
    let distanceUnit: String

    var body: some View {
        Chart(points) { point in
            BarMark(
                x: .value(rangeAxisLabel, point.distance),
                y: .value(tripAxisLabel, point.name)
            )
            .foregroundStyle(barGradient)
            .cornerRadius(4)
        }
        .chartYScale(domain: orderedDomain)
        .chartXAxis { valueAxis }
        .chartYAxis { categoryAxis }
        .frame(height: 280)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TripListStrings.chartTitleAria))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    /// Largest-first source order placed top-to-bottom: the categorical y-domain's first element sits
    /// at the bottom, so the reversed order puts the longest trip at the top (web ranking).
    private var orderedDomain: [String] {
        points.map(\.name).reversed()
    }

    // MARK: Axes

    @AxisContentBuilder
    private var valueAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel()
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    @AxisContentBuilder
    private var categoryAxis: some AxisContent {
        AxisMarks(preset: .aligned, position: .leading) { value in
            AxisValueLabel {
                if let name = value.as(String.self) {
                    Text(verbatim: name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
        }
    }

    // MARK: Style + labels

    /// Web `ChartGradient` `#00f0ff` at 0.8 opacity → solid accent, drawn leading→trailing for the
    /// horizontal bars.
    private var barGradient: LinearGradient {
        LinearGradient(
            colors: [Color.TS.accent.opacity(0.85), Color.TS.accent.opacity(0.55)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    private var tripAxisLabel: String {
        TripListStrings.chartColTrip
    }

    private var rangeAxisLabel: String {
        TripListStrings.chartDistance(unit: distanceUnit)
    }

    private var accessibilityValue: String {
        let total = points.reduce(0) { $0 + $1.distance }
        return "\(points.count) · \(TripListFormat.integer(total)) \(distanceUnit)"
    }
}

// MARK: - Chart panel (web `ChartContainer` "Top Trips by Distance")

/// The top-trips chart panel — the SwiftUI parity of the web `<ChartContainer>`: the titled,
/// aria-labelled header with the CSV / JSON export actions over the bar chart, and the
/// `trips.chart.empty` `ContentUnavailableView` when there is no data. Bordered figure chrome
/// (matching the shared `ChartContainer` surface), fixed 280-pt body height.
struct TripListChartPanel: View {
    let model: TripListPageModel
    let units: UnitPreferences

    private var points: [TripListChartPoint] {
        model.topTripsByDistance.map { trip in
            TripListChartPoint(
                id: trip.id,
                name: trip.name ?? TripListStrings.tripFallback(id: trip.id),
                distance: TripListFormat.distanceValue(meters: trip.totalDistanceM, units: units)
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.hasChartData {
                TripDistanceBarChart(points: points, distanceUnit: units.distance)
            } else {
                emptyState
            }
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(TripListStrings.chartTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            exportActions
        }
    }

    /// Web export `Button`s (CSV / JSON): HIG `ShareLink`s that hand the serialized content to the
    /// system share sheet (Save to Files / AirDrop / …) — the native peer of the web file download.
    private var exportActions: some View {
        HStack(spacing: TSSpacing.sm) {
            ShareLink(item: model.csvContent) {
                exportLabel(TripListStrings.exportCsv)
            }
            .accessibilityLabel(Text(TripListStrings.exportCsv))
            ShareLink(item: model.jsonContent) {
                exportLabel(TripListStrings.exportJson)
            }
            .accessibilityLabel(Text(TripListStrings.exportJson))
        }
        .disabled(!model.hasTrips)
    }

    private func exportLabel(_ title: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 11, weight: .semibold))
            Text(title)
                .font(Font.TS.label)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .contentShape(Rectangle())
    }

    private var emptyState: some View {
        TSEmptyState(
            title: TripListStrings.chartEmpty,
            systemImage: "chart.bar.xaxis"
        )
        .frame(maxWidth: .infinity, minHeight: 280)
    }
}
