import SwiftUI

// MARK: - Route metric cards (web MetricCard row: Distance / ETA / Traffic-Delay / Avg-Speed / Energy)

/// The route-metric card row (web MetricCard grid): Distance, ETA, Traffic Delay, Avg Speed, and Energy
/// at Arrival. Inactive-route metrics read the em dash (web `'—'`), exactly as the source.
struct NavMetricsSection: View {
    let model: NavigationRoutePageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var latest: NavSnapshot? {
        model.latest
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 2 : 5)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            NavMetricCard(
                label: "nav.metric.distance",
                value: model.hasActiveRoute
                    ? NavigationRouteFormat.distance(latest?.distanceToArrivalM ?? 0, units)
                    : NavigationRouteFormat.emptyValue,
                systemImage: "point.topleft.down.curvedto.point.bottomright.up",
                tone: .accent
            )
            NavMetricCard(
                label: "nav.metric.eta",
                value: etaValue,
                systemImage: "clock.fill",
                tone: .info
            )
            NavMetricCard(
                label: "nav.metric.trafficDelay",
                value: model.hasActiveRoute
                    ? NavigationRouteFormat.duration(latest?.routeTrafficDelayS ?? 0, units)
                    : NavigationRouteFormat.emptyValue,
                systemImage: "exclamationmark.triangle.fill",
                tone: .success
            )
            NavMetricCard(
                label: "nav.metric.avgSpeed",
                value: NavigationRouteFormat.speed(model.averageSpeedMps, units),
                systemImage: "gauge.with.dots.needle.50percent",
                tone: .warning
            )
            NavMetricCard(
                label: "nav.metric.energyAtArrival",
                value: energyValue,
                systemImage: "bolt.batteryblock.fill",
                tone: .success
            )
        }
    }

    /// Web ETA `${fmtNumber(minutes, 0)} min` (the unit word stays English `min`, web verbatim).
    private var etaValue: String {
        guard model.hasActiveRoute else { return NavigationRouteFormat.emptyValue }
        return "\(NavigationRouteFormat.minutes(latest?.minutesToArrival ?? 0)) \(String(localized: "nav.minutes"))"
    }

    /// Web `${fmtNumber(expected_energy_pct_at_arrival, 0)}%` or `'—'`.
    private var energyValue: String {
        guard let pct = model.chargingTelemetry?.expectedEnergyPctAtArrival else {
            return NavigationRouteFormat.emptyValue
        }
        return "\(NavigationRouteFormat.number(pct, decimals: 0))%"
    }
}

/// One route-metric card (web `MetricCard`): a tinted icon, a label, and the pre-formatted value.
struct NavMetricCard: View {
    let label: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    TSMetricLabel(label)
                    Spacer()
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel10 — Route Traffic Delay (web Route Traffic Delay panel)

/// The route-traffic-delay panel (web GlassPanel10): a large delay duration tinted by magnitude plus the
/// `TrafficDelayBadge`. Shows a skeleton while the latest snapshot loads.
struct NavTrafficDelaySection: View {
    let model: NavigationRoutePageModel
    let units: UnitPreferences

    private var seconds: Double {
        model.latest?.routeTrafficDelayS ?? 0
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    TSPanelTitle("nav.trafficDelay")
                }
                if model.latestState == .loading {
                    TSSkeleton(height: 48)
                } else {
                    HStack(spacing: TSSpacing.lg) {
                        Text(verbatim: NavigationRouteFormat.duration(seconds, units))
                            .font(Font.TS.display)
                            .fontWeight(.bold)
                            .monospacedDigit()
                            .foregroundStyle(NavigationRouteFormat.trafficDelayHeadlineTone(seconds).color)
                        NavTrafficDelayBadge(seconds: seconds, units: units)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
