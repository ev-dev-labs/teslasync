import SwiftUI

// The summary / route-card / metrics panels + the date-range control + the loading skeleton for the
// Route Efficiency surface (web GlassPanel1, the StaggerContainer route cards, GlassPanel4, and the
// `RangePicker`). The comparison chart lives in `RouteEfficiencyPage.Charts.swift`. Each value formats
// from raw analytics units via `RouteEfficiencyFormat` at this display boundary; each panel renders
// its own empty state (never a blank region).

// MARK: - Summary stats (web GlassPanel1 — Routes / Total-Trips / Best / Avg)

/// The four-up summary panel (web GlassPanel1): route count, total trips, best efficiency, and average
/// efficiency. The two efficiency tiles carry the user's `Wh/km`-or-`Wh/mi` unit in their caption.
struct RouteEfficiencySummarySection: View {
    let model: RouteEfficiencyPageModel
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                tile(
                    value: "\(model.routes.count)",
                    caption: String(localized: "routeEfficiency.routes"),
                    tone: .accent
                )
                tile(
                    value: "\(model.totalTrips)",
                    caption: String(localized: "routeEfficiency.totalTrips"),
                    tone: .neutral
                )
                tile(
                    value: "\(RouteEfficiencyFormat.efficiencyRounded(model.bestEfficiency, units))",
                    caption: efficiencyCaption("routeEfficiency.bestEfficiency"),
                    tone: .success
                )
                tile(
                    value: "\(RouteEfficiencyFormat.efficiencyRounded(model.averageEfficiency, units))",
                    caption: efficiencyCaption("routeEfficiency.avgEfficiency"),
                    tone: .warning
                )
            }
        }
    }

    /// Web `${t(key)} ${efficiencyUnit}` — the stat caption with the active consumption unit.
    private func efficiencyCaption(_ key: String.LocalizationValue) -> String {
        "\(String(localized: key)) \(RouteEfficiencyFormat.efficiencyUnit(units))"
    }

    private func tile(value: String, caption: String, tone: TSTone) -> some View {
        VStack(spacing: TSSpacing.xs) {
            TSAnimatedNumber(formatted: value)
                .foregroundStyle(tone == .neutral ? Color.TS.textPrimary : tone.color)
            Text(verbatim: caption.uppercased())
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Route cards (web StaggerContainer — GlassPanel2 per route)

/// The per-route card grid (web `StaggerContainer` of `RouteCard`s). Each card is its own
/// `GlassPanel2`. Renders the `common.noData` empty state (never a blank region) when there are no
/// routes, keeping the section visible.
struct RouteEfficiencyRoutesSection: View {
    let model: RouteEfficiencyPageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)
    }

    var body: some View {
        if model.routes.isEmpty {
            TSGlassPanel {
                TSEmptyState(title: "common.noData", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                    .frame(maxWidth: .infinity)
            }
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(model.routes) { route in
                    RouteEfficiencyRouteCard(route: route, units: units)
                }
            }
        }
    }
}

/// One route card (web `RouteCard` — GlassPanel2): the start→end places, the trip count + mean
/// distance, the variant-tinted average-consumption badge, and the best/avg/worst efficiency bar.
struct RouteEfficiencyRouteCard: View {
    let route: RouteEfficiencyRoute
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                RouteEfficiencyBar(route: route, units: units)
                labels
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            TSIconBox(systemName: "mappin.and.ellipse", tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: route.startLocation)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: route.endLocation)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                .lineLimit(1)
                Text(verbatim: subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            TSBadge(LocalizedStringKey(badgeText), tone: RouteEfficiencyFormat.variant(route.avgEfficiency))
        }
    }

    /// Web `${tripCount} ${t('trips')} · ${fmtNumber(toDistanceDisplay(avgDistance))} ${unit} ${t('avg')}`.
    private var subtitle: String {
        let trips = "\(route.tripCount) \(String(localized: "routeEfficiency.trips"))"
        let distance = RouteEfficiencyFormat.distance(route.avgDistanceM, units)
        return "\(trips) · \(distance) \(String(localized: "routeEfficiency.avg"))"
    }

    /// Web badge `${fmtInt(avgEff)} ${efficiencyUnit}`.
    private var badgeText: String {
        RouteEfficiencyFormat.efficiencyInt(route.avgEfficiency, units)
    }

    /// Web row beneath the bar: Best / Avg / Worst labels.
    private var labels: some View {
        HStack(spacing: TSSpacing.md) {
            Spacer(minLength: 0)
            Text("routeEfficiency.best")
            Text("routeEfficiency.avgLabel")
            Text("routeEfficiency.worst")
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityHidden(true)
    }

    private var accessibilitySummary: String {
        "\(route.startLocation) → \(route.endLocation), \(badgeText)"
    }
}

/// The best/avg/worst efficiency bar (web RouteCard gradient + colored numbers): a proportional track
/// (green up to best, cyan to average, red to worst — keyed off the worst value) plus the three
/// consumption numbers tinted to match.
struct RouteEfficiencyBar: View {
    let route: RouteEfficiencyRoute
    let units: UnitPreferences

    private var bestFraction: Double {
        proportion(route.bestEfficiency)
    }

    private var avgFraction: Double {
        proportion(route.avgEfficiency)
    }

    private func proportion(_ value: Double) -> Double {
        let denominator = max(route.worstEfficiency, 1)
        return min(max(value / denominator, 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            GeometryReader { geo in
                let width = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.TS.surfaceGlass)
                    HStack(spacing: 0) {
                        Rectangle().fill(TSChartPalette.color(at: 2)).frame(width: width * bestFraction)
                        Rectangle().fill(TSChartPalette.color(at: 4))
                            .frame(width: width * max(avgFraction - bestFraction, 0))
                        Rectangle().fill(TSChartPalette.color(at: 5))
                            .frame(width: width * max(1 - avgFraction, 0))
                    }
                    .clipShape(Capsule())
                }
            }
            .frame(height: 8)
            .accessibilityHidden(true)
            numbers
        }
    }

    private var numbers: some View {
        HStack(spacing: TSSpacing.md) {
            Spacer(minLength: 0)
            value(route.bestEfficiency, colorIndex: 2)
            value(route.avgEfficiency, colorIndex: 4)
            value(route.worstEfficiency, colorIndex: 5)
        }
    }

    private func value(_ whPerKm: Double, colorIndex: Int) -> some View {
        Text(verbatim: "\(RouteEfficiencyFormat.efficiencyRounded(whPerKm, units))")
            .font(Font.TS.caption)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(TSChartPalette.color(at: colorIndex))
    }
}

// MARK: - Route metrics (web GlassPanel4 — Best / Avg / Worst / Most-Driven bars, or common.noData)

/// The route-metrics panel (web GlassPanel4): a titled grid of best / average / worst efficiency bars
/// plus the most-driven-route trip bar — or the `common.noData` empty state when there are no routes.
struct RouteEfficiencyMetricsSection: View {
    let model: RouteEfficiencyPageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("routeEfficiency.metrics")
                }
                if model.routes.isEmpty {
                    TSEmptyState(title: "common.noData", systemImage: "waveform.path.ecg")
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        metric(
                            label: "routeEfficiency.bestLabel",
                            whPerKm: model.bestEfficiency,
                            maxWhPerKm: 300,
                            colorIndex: 2
                        )
                        metric(
                            label: "routeEfficiency.avgLabel",
                            whPerKm: model.averageEfficiency,
                            maxWhPerKm: 300,
                            colorIndex: 4
                        )
                        metric(
                            label: "routeEfficiency.worstLabel",
                            whPerKm: model.worstEfficiency,
                            maxWhPerKm: 400,
                            colorIndex: 5
                        )
                        mostDrivenMetric
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func metric(
        label: LocalizedStringKey,
        whPerKm: Double,
        maxWhPerKm: Double,
        colorIndex: Int
    ) -> some View {
        let displayMax = RouteEfficiencyFormat.efficiencyValue(maxWhPerKm, units)
        let displayValue = RouteEfficiencyFormat.efficiencyValue(whPerKm, units)
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            RouteEfficiencyMetricBar(fraction: displayMax > 0 ? displayValue / displayMax : 0, colorIndex: colorIndex)
            Text(verbatim: RouteEfficiencyFormat.efficiencyInt(whPerKm, units))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }

    /// Web Most-Driven-Route bar: trip count over `max(routes[0].tripCount, 20)`.
    private var mostDrivenMetric: some View {
        let trips = model.mostDrivenTripCount
        let denominator = Double(max(trips, 20))
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel("routeEfficiency.mostDrivenLabel")
            RouteEfficiencyMetricBar(fraction: denominator > 0 ? Double(trips) / denominator : 0, colorIndex: 6)
            Text(verbatim: "\(trips) \(String(localized: "routeEfficiency.trips"))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A palette-tinted proportion bar (web `MetricBar color={...}`), wrapping the shared bar track so the
/// best/avg/worst/most-driven metrics keep their distinct web colors.
struct RouteEfficiencyMetricBar: View {
    let fraction: Double
    let colorIndex: Int

    private var clamped: Double {
        min(max(fraction, 0), 1)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.surfaceGlass)
                Capsule()
                    .fill(TSChartPalette.color(at: colorIndex))
                    .frame(width: geo.size.width * clamped)
            }
        }
        .frame(height: 8)
        .accessibilityValue(Text("progress.percent \(Int((clamped * 100).rounded()))"))
    }
}
