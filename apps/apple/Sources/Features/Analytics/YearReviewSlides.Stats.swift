import SwiftUI

// The stat-driven slides (web `StatHeroSlide` for distance + energy, and `StatChartSlide` for the
// monthly activity bars). SI values convert to the user's unit preference at this render boundary.

// MARK: - Distance hero (web `StatHeroSlide field="distance"`)

/// Total distance hero: 🛣️, the converted total, the unit, and the "% around the Earth" line.
struct YearReviewDistanceSlide: View {
    let review: YearReview
    let units: UnitPreferences

    var body: some View {
        YearReviewHeroSlide(
            emoji: "🛣️",
            value: YearReviewStoryFormat.distanceInt(review.totalDistanceM, units),
            unit: Text(verbatim: units.distance),
            comparison: comparison
        )
    }

    /// Web `earthLaps = total_distance_km / 40075`; ≥ 1% shows the lap line, else the small line.
    private var comparison: String {
        let earthLaps = review.totalDistanceKm / 40075
        guard earthLaps >= 0.01 else {
            return String(localized: "yearReview.distanceSmall")
        }
        let percent = YearReviewStoryFormat.number(earthLaps * 100, decimals: 1)
        return String(format: String(localized: "yearReview.distanceComparison"), percent)
    }
}

// MARK: - Energy hero (web `StatHeroSlide field="energy"`)

/// Total energy hero: ⚡, the total kWh, "kWh charged", and the "power a home for N days" line.
struct YearReviewEnergySlide: View {
    let review: YearReview

    var body: some View {
        YearReviewHeroSlide(
            emoji: "⚡",
            value: YearReviewStoryFormat.integer(YearReviewStoryFormat.energyKWhValue(review.totalEnergyWh)),
            unit: Text("yearReview.energyUnit"),
            comparison: comparison
        )
    }

    /// Web `days = Math.round(total_energy_kwh / 30)`.
    private var comparison: String {
        let days = Int((review.totalEnergyKWh / 30).rounded())
        return String(format: String(localized: "yearReview.energyComparison"), days)
    }
}

// MARK: - Monthly activity (web `StatChartSlide`)

/// Drive-count slide: 🗓️, the total drives, the per-week average, and the monthly bar chart on the
/// P3 `TSBarChart` wrapper with a month-label row beneath (the wrapper's category axis is
/// index-based, mirroring the sibling `StatisticsComparisonSection`).
struct YearReviewStatChartSlide: View {
    let review: YearReview

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: "🗓️", size: 48)
            drivesHeadline
            Text(verbatim: avgPerWeek)
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
            chart
        }
    }

    private var drivesHeadline: some View {
        HStack(alignment: .lastTextBaseline, spacing: TSSpacing.sm) {
            YearReviewHeroNumber(value: YearReviewStoryFormat.integer(Double(review.totalDrives)))
            Text("yearReview.drives")
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.7))
        }
    }

    /// Web `t('yearReview.avgPerWeek', { count })` → "{{count}} drives per week on average".
    private var avgPerWeek: String {
        String(
            format: String(localized: "yearReview.avgPerWeek"),
            YearReviewStoryFormat.number(review.avgDrivesPerWeek, decimals: 1)
        )
    }

    private var chart: some View {
        VStack(spacing: TSSpacing.xs) {
            TSBarChart(series: [series])
                .frame(height: 170)
            monthAxis
        }
        .frame(maxWidth: 460)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("yearReview.drives"))
    }

    private var series: TSChartSeries {
        let points = review.monthlyStats.map { stat in
            TSChartPoint(x: Double(stat.month), y: Double(stat.drives), id: "m-\(stat.month)")
        }
        return TSChartSeries(id: "drives", name: "yearReview.drives", nameText: "drives", points: points, colorIndex: 6)
    }

    private var monthAxis: some View {
        HStack(spacing: 0) {
            ForEach(review.monthlyStats) { stat in
                Text(verbatim: YearReviewStoryFormat.monthShortLabel(stat.month))
                    .font(.system(size: 9))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}
