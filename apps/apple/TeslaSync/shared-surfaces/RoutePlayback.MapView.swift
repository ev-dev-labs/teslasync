//
//  RoutePlayback.MapView.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The native MapKit host — the SwiftUI/MapKit parity of the web Leaflet `MapContainer` and its
//  children: the trail polyline (web `Polyline`), the start / end anchors (web green / red
//  `CircleMarker`s), the heading-aware playhead tracking `currentIndex` (web `AnimatedMarker`), and the
//  floating tile-layer switcher (web `MapLayerSwitcher`). The camera frames the plotted trail via the
//  shared, unit-tested `TSGeo.boundingRegion`, re-fitting whenever the trail changes (web `FitTrail` /
//  `fitBounds`). The view converts the pure value types to MapKit types only at this boundary.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - MapKit boundary conversions

extension RoutePlaybackCoordinate {
    /// The MapKit coordinate for this value type (MapKit boundary only).
    var clLocation: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension RoutePlaybackMapStyle {
    /// The shared map-style token for this value type (web `MapStyle` → native style).
    var tsMapStyle: TSMapStyle {
        switch self {
        case .standard: .standard
        case .hybrid: .hybrid
        case .imagery: .imagery
        }
    }
}

// MARK: - Route map (web `MapContainer` + `Polyline` + `CircleMarker`s + `AnimatedMarker`)

/// The MapKit map hosting the trail, the anchors, and the playhead. Owns its camera (web `useMap`) so it
/// stays framed on the plotted trail, re-fitting whenever the trail changes; the floating switcher binds
/// the tile style (web `MapLayerSwitcher`).
struct RoutePlaybackMapView: View {
    let route: RoutePlaybackRoute
    let frame: RoutePlaybackFrame
    let trailColor: Color
    let markerColor: Color
    let showsLayerSwitcher: Bool
    let accessibilityLabel: String
    let accessibilityValue: String

    @State private var camera: MapCameraPosition
    @State private var mapStyle: TSMapStyle

    init(
        route: RoutePlaybackRoute,
        frame: RoutePlaybackFrame,
        trailColor: Color,
        markerColor: Color,
        showsLayerSwitcher: Bool,
        initialStyle: RoutePlaybackMapStyle,
        accessibilityLabel: String,
        accessibilityValue: String
    ) {
        self.route = route
        self.frame = frame
        self.trailColor = trailColor
        self.markerColor = markerColor
        self.showsLayerSwitcher = showsLayerSwitcher
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        _camera = State(initialValue: TSMapCamera.fitting(route.trail.map(\.clLocation)))
        _mapStyle = State(initialValue: initialStyle.tsMapStyle)
    }

    var body: some View {
        Map(position: $camera) {
            trailContent
            anchorContent
            playheadContent
        }
        .mapStyle(mapStyle.mapStyle)
        .onChange(of: route.trail) { _, updated in
            camera = TSMapCamera.fitting(updated.map(\.clLocation))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
        .overlay(alignment: .topLeading) { layerSwitcher }
    }

    // MARK: Map content

    @MapContentBuilder
    private var trailContent: some MapContent {
        if route.trail.count >= 2 {
            MapPolyline(coordinates: route.trail.map(\.clLocation))
                .stroke(
                    trailColor.opacity(0.85),
                    style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
                )
        }
    }

    @MapContentBuilder
    private var anchorContent: some MapContent {
        if let start = route.start {
            Annotation(
                RoutePlaybackStrings.string("routePlayback.start", "Start"),
                coordinate: start.clLocation,
                anchor: .center
            ) {
                TSCircleMarker(tone: .success)
            }
        }
        if let end = route.end {
            Annotation(
                RoutePlaybackStrings.string("routePlayback.end", "End"),
                coordinate: end.clLocation,
                anchor: .center
            ) {
                TSCircleMarker(tone: .danger)
            }
        }
    }

    @MapContentBuilder
    private var playheadContent: some MapContent {
        if frame.hasPlayhead, let point = frame.currentPoint {
            Annotation(
                RoutePlaybackStrings.string("routePlayback.playhead", "Current position"),
                coordinate: point.coordinate.clLocation,
                anchor: .center
            ) {
                RoutePlaybackPlayheadGlyph(color: markerColor, heading: frame.heading)
            }
        }
    }

    // MARK: Layer switcher (web `MapLayerSwitcher`)

    @ViewBuilder
    private var layerSwitcher: some View {
        if showsLayerSwitcher {
            TSMapLayerSwitcher(style: $mapStyle)
                .frame(maxWidth: 240)
                .padding(TSSpacing.sm)
                .accessibilityLabel(Text(verbatim: RoutePlaybackStrings.string(
                    "routePlayback.layerSwitcher", "Map style"
                )))
        }
    }
}
