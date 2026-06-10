//
//  GeofenceDrawer.Map.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The MapKit canvas — the Leaflet → MapKit port of the web `GeofenceDrawer`'s map surface. Renders
//  the persisted fences as circle / polygon overlays (the `fenceToLayer` peer), previews the active
//  draw draft (the live leaflet-draw shape), turns a tap into a coordinate via `MapReader` +
//  `MapProxy.convert` (the draw-click handler), and fits / focuses the camera. Tints use the brand
//  accent token (the web single `color`); the in-progress draft is dashed to distinguish it.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - View-layer overlay value types

/// A persisted circle fence resolved for the map.
private struct GeofenceCircleOverlay: Identifiable {
    let id: String
    let center: CLLocationCoordinate2D
    let radius: Double
}

/// A persisted polygon fence resolved for the map.
private struct GeofencePolygonOverlay: Identifiable {
    let id: String
    let coordinates: [CLLocationCoordinate2D]
}

/// A draft vertex marker (id by placement order).
private struct GeofenceVertex: Identifiable {
    let id: Int
    let coordinate: CLLocationCoordinate2D
}

// MARK: - Map canvas

/// The interactive geofence map. Binds through the model: renders the renderable fences + the live
/// draft, forwards taps as new draft points, and fits / focuses the camera as the data changes.
struct GeofenceMapCanvas: View {
    @Bindable var model: GeofenceDrawerModel
    @State private var camera: MapCameraPosition = .automatic

    private let fenceTint = Color.TS.accent
    private let defaultSpan = MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)

    var body: some View {
        MapReader { proxy in
            Map(position: $camera) {
                persistedOverlays
                draftOverlays
                draftVertexMarkers
            }
            .mapStyle(.standard)
            .contentShape(Rectangle())
            .onTapGesture { location in
                guard let coordinate = proxy.convert(location, from: .local) else { return }
                model.addPoint(GeofencePoint(lat: coordinate.latitude, lng: coordinate.longitude))
            }
        }
        .frame(minHeight: 220)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: GeofenceDrawerAccessibility.mapLabel(localize: model.localize)))
        .accessibilityHint(Text(verbatim: model.draftHint))
        .onAppear { fitCamera() }
        .onChange(of: model.renderables.count) { _, _ in fitCamera() }
        .onChange(of: model.focusedFenceID) { _, _ in focusCamera() }
    }

    // MARK: Map content

    @MapContentBuilder
    private var persistedOverlays: some MapContent {
        ForEach(circleOverlays) { overlay in
            MapCircle(center: overlay.center, radius: overlay.radius)
                .foregroundStyle(fenceTint.opacity(0.15))
                .stroke(fenceTint, lineWidth: 2)
        }
        ForEach(polygonOverlays) { overlay in
            MapPolygon(coordinates: overlay.coordinates)
                .foregroundStyle(fenceTint.opacity(0.15))
                .stroke(fenceTint, lineWidth: 2)
        }
    }

    @MapContentBuilder
    private var draftOverlays: some MapContent {
        if let circle = draftCircle {
            MapCircle(center: circle.center, radius: circle.radius)
                .foregroundStyle(fenceTint.opacity(0.12))
                .stroke(fenceTint, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
        }
        if draftRectangleCoordinates.count == 4 {
            MapPolygon(coordinates: draftRectangleCoordinates)
                .foregroundStyle(fenceTint.opacity(0.12))
                .stroke(fenceTint, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
        }
        if draftPolylineCoordinates.count >= 2 {
            MapPolyline(coordinates: draftPolylineCoordinates)
                .stroke(fenceTint, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
        }
    }

    @MapContentBuilder
    private var draftVertexMarkers: some MapContent {
        ForEach(draftVertices) { vertex in
            Annotation("", coordinate: vertex.coordinate) {
                Circle()
                    .fill(fenceTint)
                    .frame(width: 11, height: 11)
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            }
        }
        .annotationTitles(.hidden)
    }

    // MARK: Derived overlays

    private var circleOverlays: [GeofenceCircleOverlay] {
        model.renderables.compactMap { renderable in
            guard case let .circle(center, radius) = renderable.kind else { return nil }
            return GeofenceCircleOverlay(id: renderable.id, center: Self.coordinate(center), radius: radius)
        }
    }

    private var polygonOverlays: [GeofencePolygonOverlay] {
        model.renderables.compactMap { renderable in
            guard case let .polygon(ring) = renderable.kind else { return nil }
            return GeofencePolygonOverlay(id: renderable.id, coordinates: ring.map(Self.coordinate))
        }
    }

    private var draftCircle: GeofenceCircleOverlay? {
        guard model.draft.mode == .circle, let center = model.draft.points.first else { return nil }
        return GeofenceCircleOverlay(id: "draft", center: Self.coordinate(center), radius: model.draft.radiusMeters)
    }

    private var draftRectangleCoordinates: [CLLocationCoordinate2D] {
        guard model.draft.mode == .rectangle, model.draft.points.count == 2 else { return [] }
        let pair = GeofenceGeometry.corners(model.draft.points[0], model.draft.points[1])
        return GeofenceGeometry.rectangleRing(sw: pair.sw, ne: pair.ne).map(Self.coordinate)
    }

    private var draftPolylineCoordinates: [CLLocationCoordinate2D] {
        guard model.draft.mode == .polygon, model.draft.points.count >= 2 else { return [] }
        return model.draft.points.map(Self.coordinate)
    }

    private var draftVertices: [GeofenceVertex] {
        model.draft.points.enumerated().map { GeofenceVertex(id: $0.offset, coordinate: Self.coordinate($0.element)) }
    }

    // MARK: Camera

    private func fitCamera() {
        let points = GeofenceDrawerProjection.cameraPoints(from: model.renderables).map(Self.coordinate)
        if let region = TSGeo.boundingRegion(for: points) {
            camera = .region(region)
        } else if let center = model.center {
            camera = .region(MKCoordinateRegion(center: Self.coordinate(center), span: defaultSpan))
        }
    }

    private func focusCamera() {
        guard let id = model.focusedFenceID,
              let renderable = model.renderables.first(where: { $0.id == id }) else { return }
        let points: [CLLocationCoordinate2D] = switch renderable.kind {
        case let .circle(center, _): [Self.coordinate(center)]
        case let .polygon(ring): ring.map(Self.coordinate)
        case .none: []
        }
        if let region = TSGeo.boundingRegion(for: points) {
            camera = .region(region)
        }
    }

    private static func coordinate(_ point: GeofencePoint) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: point.lat, longitude: point.lng)
    }
}
