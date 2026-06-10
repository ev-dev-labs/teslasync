//
//  VehicleCharts.Map.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The live-map section: the MapKit `Map` (web Leaflet `MapContainer` +
//  `MapTileLayer`), the current-position marker (web `vehicleIcon()`), the trail
//  polyline (web `<Polyline>` in cyan, drawn only when `trail.length > 1`), the
//  map-style switcher (web `MapLayerSwitcher`), and the mono coordinate footer
//  (web `${fmtNumber(lat)}, ${fmtNumber(lng)}`). The camera frames the current
//  position + trail via the shared, unit-tested `TSGeo.boundingRegion`. Tokens +
//  facade only.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Map style (web `MapLayerSwitcher` / `MapTileLayer`)

/// The selectable map style — the native parity of the web `MapStyle`
/// (dark/light/satellite) projected onto MapKit's native styles.
enum VehicleChartsMapStyle: String, CaseIterable, Identifiable {
    case standard
    case hybrid
    case imagery

    var id: String {
        rawValue
    }

    var mapStyle: MapStyle {
        switch self {
        case .standard: .standard
        case .hybrid: .hybrid
        case .imagery: .imagery
        }
    }

    func label(localize: (String, String) -> String) -> String {
        switch self {
        case .standard: localize("map.style.standard", "Standard")
        case .hybrid: localize("map.style.hybrid", "Hybrid")
        case .imagery: localize("map.style.imagery", "Satellite")
        }
    }
}

// MARK: - Live-map section (web first GlassPanel)

/// The Live Map panel — the localized title, the framed map canvas with its style
/// switcher, and the mono coordinate footer. Rendered only when the state has a
/// truthy location (web `{state.latitude && state.longitude && …}`).
struct VehicleChartsMapSection: View {
    let projection: VehicleChartsProjection
    let formatting: any VehicleChartsFormatting
    let localize: (String, String) -> String

    @State private var style: VehicleChartsMapStyle = .standard

    var body: some View {
        VStack(spacing: 0) {
            VehicleChartsSectionHeader(
                systemImage: "location.north.fill",
                tint: Color.TS.accent,
                title: VehicleChartsLabels.locationTitle(localize: localize)
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.lg)

            VehicleChartsMapCanvas(projection: projection, style: style, localize: localize)
                .frame(height: 288)
                .overlay(alignment: .topTrailing) {
                    VehicleChartsMapStyleSwitcher(style: $style, localize: localize)
                        .padding(TSSpacing.sm)
                }

            coordinateFooter
        }
        .frame(maxWidth: .infinity)
        .tsGlassPanel()
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
    }

    @ViewBuilder
    private var coordinateFooter: some View {
        if let current = projection.current {
            let latitude = formatting.formatNumber(current.latitude)
            let longitude = formatting.formatNumber(current.longitude)
            Text(verbatim: VehicleChartsLabels.coordinate(latitude: latitude, longitude: longitude))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(
                    Text(verbatim: VehicleChartsLabels.coordinateAccessibility(
                        latitude: latitude,
                        longitude: longitude,
                        localize: localize
                    ))
                )
        }
    }
}

// MARK: - Map canvas (web MapContainer + MapTileLayer + Marker + Polyline)

/// The MapKit canvas. Owns its camera so it stays framed on the current position
/// and trail, re-fitting whenever the projection changes; plots the vehicle
/// marker and the cyan trail polyline (web `<Polyline>` when `trail.length > 1`).
struct VehicleChartsMapCanvas: View {
    let projection: VehicleChartsProjection
    let style: VehicleChartsMapStyle
    let localize: (String, String) -> String

    @State private var camera: MapCameraPosition

    init(
        projection: VehicleChartsProjection,
        style: VehicleChartsMapStyle,
        localize: @escaping (String, String) -> String
    ) {
        self.projection = projection
        self.style = style
        self.localize = localize
        _camera = State(initialValue: VehicleChartsMapCanvas.cameraPosition(for: projection))
    }

    var body: some View {
        Map(position: $camera) {
            if projection.hasTrail {
                MapPolyline(coordinates: projection.trailCoordinates)
                    .stroke(Color.TS.accent.opacity(0.6), lineWidth: 3)
            }
            if let coordinate = projection.currentCoordinate {
                Annotation(VehicleChartsLabels.mapMarker(localize: localize), coordinate: coordinate, anchor: .bottom) {
                    VehicleChartsMapMarker()
                        .accessibilityLabel(Text(verbatim: VehicleChartsLabels.mapMarker(localize: localize)))
                }
            }
        }
        .mapStyle(style.mapStyle)
        .onChange(of: projection) { _, newValue in
            camera = VehicleChartsMapCanvas.cameraPosition(for: newValue)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: VehicleChartsLabels.mapAccessibility(localize: localize)))
    }

    /// The camera that frames the current position + trail (shared
    /// `TSGeo.boundingRegion`), or the current position alone at a zoom-14-
    /// equivalent span when there is no trail to widen to.
    static func cameraPosition(for projection: VehicleChartsProjection) -> MapCameraPosition {
        if projection.hasTrail, let region = TSGeo.boundingRegion(for: projection.cameraCoordinates) {
            return .region(region)
        }
        if let coordinate = projection.currentCoordinate {
            return .region(
                MKCoordinateRegion(
                    center: coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
                )
            )
        }
        return .automatic
    }
}

// MARK: - Vehicle marker (web `vehicleIcon()`)

/// The current-position marker — a car glyph in the brand-accent disc (the native
/// parity of the web vehicle icon).
struct VehicleChartsMapMarker: View {
    var body: some View {
        Image(systemName: "car.fill")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(.white)
            .padding(7)
            .background(Color.TS.accent, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .shadow(radius: 2)
    }
}

// MARK: - Map-style switcher (web `MapLayerSwitcher`)

/// The map-style segmented switcher (web `MapLayerSwitcher`).
struct VehicleChartsMapStyleSwitcher: View {
    @Binding var style: VehicleChartsMapStyle
    let localize: (String, String) -> String

    var body: some View {
        Picker(selection: $style) {
            ForEach(VehicleChartsMapStyle.allCases) { option in
                Text(verbatim: option.label(localize: localize)).tag(option)
            }
        } label: {
            Text(verbatim: localize("map.style.label", "Map style"))
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityLabel(Text(verbatim: localize("map.style.label", "Map style")))
    }
}
