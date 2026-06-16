import CoreLocation
import MapKit
import SwiftUI

// The Map Overview map surfaces (web `GlassPanel` map + `GlassPanel` route playback). Both
// render through the P3 MapKit wrappers (`TSMapView` / `TSRoutePlayback`) — never a web view —
// and resolve their own empty states so neither panel is ever blank (ADR-011).

/// GlassPanel1 — the live map: the recent-trail polyline, the current-position marker with the
/// vehicle-name callout (web `Popup`), and the layer switcher (web `MapLayerSwitcher` →
/// `MapTileLayer`). Falls back to the no-GPS empty state when there is no valid current fix.
struct MapOverviewMapSection: View {
    let model: MapOverviewPageModel
    @State private var camera: MapCameraPosition

    init(model: MapOverviewPageModel) {
        self.model = model
        let focus = (model.latest.map { [$0.coordinate] } ?? []) + model.trailCoordinates
        _camera = State(initialValue: TSMapCamera.fitting(focus))
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.hasValidLatest {
                    mapBody
                } else {
                    emptyState
                }
            }
        }
        .onChange(of: model.latest?.id) { recenter() }
    }

    @ViewBuilder
    private var mapBody: some View {
        TSMapView(
            camera: $camera,
            annotations: annotations,
            route: model.trailCoordinates,
            style: model.mapStyle
        )
        .frame(minHeight: 360)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        HStack {
            TSMapLayerSwitcher(style: styleBinding).frame(maxWidth: 280)
            Spacer()
        }
    }

    /// The current-position marker (web `Marker` + `Popup`): the vehicle name, or the localized
    /// "Vehicle" fallback when the selected vehicle has no display name.
    private var annotations: [TSMapAnnotation] {
        guard model.hasValidLatest, let latest = model.latest else { return [] }
        return [
            TSMapAnnotation(
                id: "current",
                coordinate: latest.coordinate,
                title: markerTitle,
                tone: .accent,
                systemImage: "car.fill"
            )
        ]
    }

    private var markerTitle: LocalizedStringKey {
        if let name = model.selectedVehicle?.displayName, !name.isEmpty {
            return LocalizedStringKey(name)
        }
        return "mapOverview.vehicle"
    }

    private var styleBinding: Binding<TSMapStyle> {
        Binding(get: { model.mapStyle }, set: { model.setMapStyle($0) })
    }

    private func recenter() {
        let focus = (model.latest.map { [$0.coordinate] } ?? []) + model.trailCoordinates
        camera = TSMapCamera.fitting(focus)
    }

    private var emptyState: some View {
        TSEmptyState(title: "mapOverview.noLocation", systemImage: "location.slash")
            .frame(maxWidth: .infinity, minHeight: 280)
    }
}

/// GlassPanel2 — recent route playback (web `RoutePlayback`): an interpolated vehicle marker
/// with a scrubber + transport controls over the recent trail, via the P3 `TSRoutePlayback`
/// wrapper. Falls back to the no-history empty state when there is no playable trail.
struct MapOverviewPlaybackSection: View {
    let model: MapOverviewPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("mapOverview.recentPlayback")
                if model.playbackCoordinates.count > 1 {
                    TSRoutePlayback(route: model.playbackCoordinates)
                        .accessibilityLabel(Text("mapOverview.playbackLabel"))
                } else {
                    TSEmptyState(title: "mapOverview.noHistory", systemImage: "play.slash")
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
        }
    }
}

/// The page loading state (web `PageContainer loading` skeleton). Mirrors the populated layout's
/// rhythm — map, playback, metric grid, panels — so the transition to content is stable.
struct MapOverviewSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSSkeleton(height: 360, cornerRadius: TSRadius.lg)
            TSSkeleton(height: 280, cornerRadius: TSRadius.lg)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 84, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 140, cornerRadius: TSRadius.lg)
            TSSkeleton(height: 220, cornerRadius: TSRadius.lg)
        }
        .accessibilityElement()
        .accessibilityLabel(Text("mapOverview.pageTitle"))
    }
}
