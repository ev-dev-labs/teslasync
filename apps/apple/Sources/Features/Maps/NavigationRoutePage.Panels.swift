import SwiftUI

// The navigation-status panel, the location-status cards, the route-metric cards, and the route-traffic
// -delay panel for the Navigation & Route surface (web GlassPanel1, the location-status card grid, the
// MetricCard row, and the Route-Traffic-Delay GlassPanel). Charts live in
// `NavigationRoutePage.Charts.swift`; the tables live in `NavigationRoutePage.Tables.swift`. Each value
// formats from SI via `NavigationRouteFormat` at this display boundary; each panel renders its own
// loading / empty region (never a blank region).

// MARK: - GlassPanel1 — Navigation Status (web Navigation Status Panel)

/// The navigation-status panel (web GlassPanel1): the title + active/inactive badge, the
/// route-last-updated freshness row, and — when a route is active — the destination / ETA / distance /
/// traffic-delay grid, else the `nav.noActiveNav` empty state.
struct NavStatusPanel: View {
    let model: NavigationRoutePageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var latest: NavSnapshot? {
        model.latest
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                lastUpdatedRow
                Group {
                    if model.latestState == .loading {
                        loading
                    } else if let latest, model.hasActiveRoute {
                        routeGrid(latest)
                    } else {
                        TSEmptyState(
                            title: "nav.noActiveNav",
                            systemImage: "location.north.line"
                        )
                        .frame(maxWidth: .infinity, minHeight: 120)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "location.north.circle.fill")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSPanelTitle("nav.status")
            Spacer(minLength: TSSpacing.sm)
            TSBadge(
                model.hasActiveRoute ? "nav.active" : "nav.inactive",
                tone: model.hasActiveRoute ? .success : .neutral
            )
        }
    }

    private var lastUpdatedRow: some View {
        HStack(spacing: TSSpacing.xs) {
            TSFreshnessIndicator(isStale: model.isStale, label: "nav.routeLastUpdated")
            Text(verbatim: NavigationRouteFormat.dateTime(latest?.routeLastUpdated))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var loading: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in TSSkeleton(height: 14) }
        }
    }

    private func routeGrid(_ latest: NavSnapshot) -> some View {
        let columns = Array(
            repeating: GridItem(.flexible(), alignment: .topLeading),
            count: isCompact ? 2 : 4
        )
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            field(label: "nav.destination", value: Text(verbatim: destinationText(latest)))
            field(label: "nav.eta", value: etaText(latest.minutesToArrival))
            field(
                label: "nav.distanceRemaining",
                value: Text(verbatim: NavigationRouteFormat.distance(latest.distanceToArrivalM ?? 0, units))
            )
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSMetricLabel("nav.trafficDelay")
                NavTrafficDelayBadge(seconds: latest.routeTrafficDelayS ?? 0, units: units)
            }
        }
    }

    private func field(label: LocalizedStringKey, value: Text) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            value
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `latest.destination_name ?? '—'`.
    private func destinationText(_ latest: NavSnapshot) -> String {
        latest.destinationName ?? NavigationRouteFormat.emptyValue
    }

    /// Web ETA `${fmtNumber(minutes, 0)} ${t('nav.minutes')}`.
    private func etaText(_ minutes: Double?) -> Text {
        Text(verbatim: NavigationRouteFormat.minutes(minutes ?? 0) + " ") + Text("nav.minutes")
    }
}

/// The traffic-delay badge (web `TrafficDelayBadge`): the formatted delay duration + `nav.delay`,
/// tinted success / warning / danger by the delay magnitude.
struct NavTrafficDelayBadge: View {
    let seconds: Double
    let units: UnitPreferences

    private var tone: TSTone {
        NavigationRouteFormat.trafficDelayTone(seconds)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone.color).frame(width: 6, height: 6)
            (Text(verbatim: NavigationRouteFormat.duration(seconds, units) + " ") + Text("nav.delay"))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel2 — Location Status Cards (web LocationStatusCard grid)

/// The location-status card grid (web GlassPanel2): current location, GPS fix quality, heading, home
/// status, and work status. Each card lights up when its value is active (web `glow`/`ring`).
struct NavLocationStatusSection: View {
    let model: NavigationRoutePageModel
    let isCompact: Bool

    private var latest: NavSnapshot? {
        model.latest
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 1 : 2)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            NavLocationStatusCard(
                systemImage: "mappin.circle.fill",
                label: "nav.currentLocation",
                value: locationValue,
                active: model.hasValidLocation
            )
            NavLocationStatusCard(
                systemImage: "dot.radiowaves.up.forward",
                label: "nav.gpsFixQuality",
                value: Text(verbatim: gpsFixLabel),
                active: latest?.gpsFix == .locked
            )
            NavLocationStatusCard(
                systemImage: "safari.fill",
                label: "nav.heading",
                value: headingValue,
                active: latest?.heading != nil
            )
            NavLocationStatusCard(
                systemImage: "house.fill",
                label: "nav.homeStatus",
                value: homeValue,
                active: latest?.locatedAtHome == true
            )
            NavLocationStatusCard(
                systemImage: "briefcase.fill",
                label: "nav.workStatus",
                value: workValue,
                active: latest?.locatedAtWork == true
            )
        }
    }

    private var locationValue: Text {
        if let coordinate = NavigationRouteFormat.coordinate(
            latitude: latest?.latitude,
            longitude: latest?.longitude
        ) {
            return Text(verbatim: coordinate)
        }
        return Text("nav.locationUnavailable")
    }

    /// Web `t('nav.gpsState.${fix}', { defaultValue: fix })` — the normalized fix value (data-driven).
    private var gpsFixLabel: String {
        (latest?.gpsFix ?? .unknown).rawValue
    }

    private var headingValue: Text {
        guard latest?.heading != nil else { return Text("nav.unknown") }
        return Text(verbatim: NavigationRouteFormat.heading(latest?.heading))
    }

    private var homeValue: Text {
        if latest?.locatedAtHome == true {
            return Text("nav.atHome")
        }
        if latest?.locatedAtHome == false {
            if latest?.homelinkNearby == true {
                return Text("nav.homelinkNearby")
            }
            return Text("nav.awayFromHome")
        }
        return Text("nav.unknown")
    }

    private var workValue: Text {
        if latest?.locatedAtWork == true {
            return Text("nav.atWork")
        }
        if latest?.locatedAtWork == false {
            return Text("nav.notAtWork")
        }
        return Text("nav.unknown")
    }
}

/// One location-status card (web `LocationStatusCard`): a tinted icon, a label, a value, and an
/// active/inactive check chip. The value is a caller-supplied `Text` so it carries either a localized
/// key or a verbatim data value.
struct NavLocationStatusCard: View {
    let systemImage: String
    let label: LocalizedStringKey
    let value: Text
    let active: Bool

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(active ? Color.TS.statusSuccess : Color.TS.textMuted)
                    .frame(width: 40, height: 40)
                    .background(
                        (active ? Color.TS.statusSuccess : Color.TS.textMuted).opacity(0.15),
                        in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    TSMetricLabel(label)
                    value
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                }
                Spacer(minLength: TSSpacing.sm)
                Image(systemName: active ? "checkmark.circle.fill" : "minus.circle")
                    .foregroundStyle(active ? Color.TS.statusSuccess : Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(active ? 0.4 : 0), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
