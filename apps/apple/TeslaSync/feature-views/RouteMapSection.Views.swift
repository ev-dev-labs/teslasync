//
//  RouteMapSection.Views.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  The MapKit canvas chrome composed by `RouteMapSection`: the speed-colored trail + start/end/anchor
//  markers, the map-style switcher, and the coordinate/band → MapKit/color bridges. The footer, legend,
//  banner, and loading/empty/error/freshness states live in RouteMapSection.States.swift. All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens / native maps primitives —
//  no networking, no Tailwind ports. Speed-band hex values are the web-source segment colors (the
//  documented dynamic-color exception), mapped here at the view boundary.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Coordinate + band → MapKit / color bridges (kept out of the host-testable adapter)

extension RouteCoordinate {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension RouteSpeedBand {
    /// The trail polyline color (web `speedSegments` hex ladder).
    var segmentColor: Color {
        switch self {
        case .low: Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255) // #10b981
        case .lowMid: Color(red: 0, green: 240 / 255, blue: 255 / 255) // #00f0ff
        case .midHigh: Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255) // #f59e0b
        case .high: Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255) // #ef4444
        }
    }

    /// The legend swatch color (web footer Tailwind swatches).
    var legendColor: Color {
        switch self {
        case .low: Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255) // emerald-500
        case .lowMid: Color(red: 34 / 255, green: 211 / 255, blue: 238 / 255) // cyan-400
        case .midHigh: Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255) // amber-500
        case .high: Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255) // red-500
        }
    }
}

extension RouteMapMarker.Kind {
    var tone: Color {
        switch self {
        case .start: Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255) // #10b981
        case .end: Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255) // #ef4444
        case .anchor: Color(red: 34 / 255, green: 211 / 255, blue: 238 / 255) // #22d3ee
        }
    }
}

// MARK: - Resolved content (web `trail.length > 0` branch)

/// The resolved route map: the canvas (with the style switcher + stationary banner overlaid) above the
/// start/legend/end footer — the parity of the web `trail.length > 0` body.
struct RouteMapResolved: View {
    let projection: RouteMapProjection
    @Binding var mapStyle: TSMapStyle

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            RouteMapCanvas(projection: projection, mapStyle: $mapStyle)
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    RouteMapStylePicker(style: $mapStyle)
                        .padding(TSSpacing.sm)
                }
                .overlay(alignment: .top) {
                    if projection.showStationaryBanner {
                        RouteMapStationaryBanner()
                            .padding(TSSpacing.sm)
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            RouteMapFooter(projection: projection)
        }
    }
}

// MARK: - MapKit canvas (web `MapContainer` + `Polyline` + `CircleMarker`)

/// The native MapKit canvas: the speed-colored trail polylines + the start/end/anchor markers, with the
/// camera fit to the route (web `FitBounds`). MapKit panning/zooming replaces the web `scrollWheelZoom`.
struct RouteMapCanvas: View {
    let projection: RouteMapProjection
    @Binding var mapStyle: TSMapStyle
    @State private var camera: MapCameraPosition

    init(projection: RouteMapProjection, mapStyle: Binding<TSMapStyle>) {
        self.projection = projection
        _mapStyle = mapStyle
        _camera = State(initialValue: TSMapCamera.fitting(projection.cameraCoordinates.map(\.clCoordinate)))
    }

    var body: some View {
        Map(position: $camera) {
            ForEach(projection.segments) { segment in
                MapPolyline(coordinates: [segment.start.clCoordinate, segment.end.clCoordinate])
                    .stroke(segment.band.segmentColor, lineWidth: 4)
            }
            marker(projection.startMarker)
            marker(projection.endMarker)
            marker(projection.anchorMarker)
        }
        .mapStyle(mapStyle.mapStyle)
        .onChange(of: cameraKey) { _, _ in
            camera = TSMapCamera.fitting(projection.cameraCoordinates.map(\.clCoordinate))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: RouteMapAccessibility.canvasSummary(for: projection)))
    }

    @MapContentBuilder
    private func marker(_ marker: RouteMapMarker?) -> some MapContent {
        if let marker {
            Annotation(marker.title, coordinate: marker.coordinate.clCoordinate) {
                RouteMapMarkerView(marker: marker)
            }
        }
    }

    /// A stable key so the camera refits when the projected route changes (e.g. loading → loaded).
    private var cameraKey: String {
        let coordinates = projection.cameraCoordinates
        let first = coordinates.first
        let last = coordinates.last
        return "\(coordinates.count):\(first?.latitude ?? 0),\(first?.longitude ?? 0):"
            + "\(last?.latitude ?? 0),\(last?.longitude ?? 0)"
    }
}

/// A single map marker dot (web `CircleMarker`). The visible annotation title carries the short label;
/// the timestamp detail rides the accessibility label (the web `Popup` content).
struct RouteMapMarkerView: View {
    let marker: RouteMapMarker

    var body: some View {
        Circle()
            .fill(marker.kind.tone)
            .frame(width: 14, height: 14)
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .shadow(radius: 1)
            .accessibilityLabel(Text(verbatim: RouteMapAccessibility.markerSummary(for: marker)))
    }
}

// MARK: - Style switcher (web `MapLayerSwitcher`)

/// A compact map-style switcher (web `MapLayerSwitcher`) over the shared `TSMapStyle`, with its labels
/// resolved through this surface's P1/S10 table so the control needs no shared catalog edit.
struct RouteMapStylePicker: View {
    @Binding var style: TSMapStyle

    var body: some View {
        Picker(selection: $style) {
            ForEach(TSMapStyle.allCases) { option in
                Text(verbatim: label(for: option)).tag(option)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 220)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityLabel(RouteMapSectionStrings.text("routeMap.styleLabel", "Map style"))
    }

    private func label(for style: TSMapStyle) -> String {
        switch style {
        case .standard: RouteMapSectionStrings.string("routeMap.style.standard", "Standard")
        case .hybrid: RouteMapSectionStrings.string("routeMap.style.hybrid", "Hybrid")
        case .imagery: RouteMapSectionStrings.string("routeMap.style.satellite", "Satellite")
        }
    }
}
