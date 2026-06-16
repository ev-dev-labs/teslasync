import SwiftUI

// The Map Overview status surfaces: the four current-status metric cards, the location-details
// panel, and the quick-links panel. SI values (speed in m/s, odometer in metres) convert to the
// user's units only here, at the render boundary, via `MapOverviewFormat` / `Units` (ADR-005).
// Every value resolves to an em-dash when its source datum is absent, so no cell is ever blank.

/// Panels 3–6 — the current-status metric grid (web `MetricCard` row): current speed, heading,
/// lat / lon, and last-updated (with the auto-refresh caption). Reflows 2-up on compact iPhone
/// width and 4-up on macOS / iPad regular width (ADR-002/006).
struct MapOverviewStatusSection: View {
    let model: MapOverviewPageModel
    let isCompact: Bool
    @Environment(\.tsUnits) private var units

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 2 : 4)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSMetricCard(title: "mapOverview.currentSpeed", value: speedValue)
            TSMetricCard(title: "mapOverview.heading", value: headingValue)
            TSMetricCard(title: "mapOverview.latLon", value: latLonValue)
            TSMetricCard(
                title: "mapOverview.lastUpdated",
                value: lastUpdatedValue,
                caption: "mapOverview.autoRefresh"
            )
        }
    }

    private var speedValue: String {
        guard let latest = model.latest else { return "—" }
        return MapOverviewFormat.speed(latest.speedMps, units: units)
    }

    private var headingValue: String {
        MapOverviewFormat.heading(model.latest?.heading)
    }

    private var latLonValue: String {
        MapOverviewFormat.coordinatePair(model.latest, decimals: 4)
    }

    private var lastUpdatedValue: String {
        guard let latest = model.latest else { return "—" }
        return MapOverviewFormat.dateTime(latest.createdAt)
    }
}

/// GlassPanel7 — the location-details panel (web home / work / HomeLink / odometer grid). Shows
/// the tri-state at-home / at-work / HomeLink badges plus the odometer, or its own empty state
/// when neither a position nor a snapshot has resolved.
struct MapOverviewLocationDetailsSection: View {
    let model: MapOverviewPageModel
    let isCompact: Bool
    @Environment(\.tsUnits) private var units

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 1 : 2)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("mapOverview.locationDetails")
                if model.latest != nil || model.snapshot != nil {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                        homeRow
                        workRow
                        homelinkRow
                        odometerRow
                    }
                } else {
                    TSEmptyState(title: "mapOverview.noLocation", systemImage: "location.slash")
                        .frame(maxWidth: .infinity, minHeight: 120)
                }
            }
        }
    }

    private var homeRow: some View {
        let status = MapOverviewLocationDetailsSection.triState(model.snapshot?.locatedAtHome)
        return detailRow(
            systemImage: "house.fill",
            tint: model.snapshot?.locatedAtHome == true ? Color.TS.statusSuccess : Color.TS.textMuted,
            label: "mapOverview.atHome"
        ) {
            TSBadge(status.0, tone: status.1)
        }
    }

    private var workRow: some View {
        let status = MapOverviewLocationDetailsSection.triState(model.snapshot?.locatedAtWork)
        return detailRow(
            systemImage: "briefcase.fill",
            tint: model.snapshot?.locatedAtWork == true ? Color.TS.statusSuccess : Color.TS.textMuted,
            label: "mapOverview.atWork"
        ) {
            TSBadge(status.0, tone: status.1)
        }
    }

    private var homelinkRow: some View {
        let nearby = model.snapshot?.homelinkNearby == true
        return detailRow(
            systemImage: "link",
            tint: nearby ? Color.TS.accent : Color.TS.textMuted,
            label: "mapOverview.homelinkNearby"
        ) {
            TSBadge(nearby ? "mapOverview.yes" : "mapOverview.no", tone: nearby ? .info : .neutral)
        }
    }

    private var odometerRow: some View {
        detailRow(
            systemImage: "gauge.with.dots.needle.bottom.50percent",
            tint: Color.TS.accent,
            label: "mapOverview.odometer"
        ) {
            Text(verbatim: MapOverviewFormat.odometer(model.latest?.odometerM, units: units))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private func detailRow(
        systemImage: String,
        tint: Color,
        label: LocalizedStringKey,
        @ViewBuilder trailing: () -> some View
    ) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage).foregroundStyle(tint).frame(width: 22)
            Text(label).font(Font.TS.bodySm).foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            trailing()
        }
        .accessibilityElement(children: .combine)
    }

    /// Maps a tri-state flag to its localized badge text + tone (web yes / no / unknown).
    static func triState(_ value: Bool?) -> (LocalizedStringKey, TSTone) {
        switch value {
        case .some(true): ("mapOverview.yes", .success)
        case .some(false): ("mapOverview.no", .neutral)
        case .none: ("mapOverview.unknown", .neutral)
        }
    }
}

/// GlassPanel8 — the quick-links panel (web navigation buttons). Each button is a real, labelled
/// navigation affordance to a sibling maps sub-page parity unit; the page raises the selection
/// through `onQuickLink`. Reflows to a vertical stack when the row will not fit (ADR-002/006).
struct MapOverviewQuickLinksSection: View {
    let onQuickLink: (MapOverviewQuickLink) -> Void

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("mapOverview.quickLinks")
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: TSSpacing.sm) { buttons }
                    VStack(alignment: .leading, spacing: TSSpacing.sm) { buttons }
                }
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        ForEach(MapOverviewQuickLink.allCases) { link in
            TSButton(
                variant: .secondary,
                size: .small,
                action: { onQuickLink(link) },
                label: { Label(LocalizedStringKey(link.titleKey), systemImage: link.systemImage) }
            )
        }
    }
}
