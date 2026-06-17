//
//  GuardModeLiveMap.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — Live Map
//
//  Native MapKit parity of the web Leaflet `LiveMap` (GlassPanel 5). Reproduces
//  every web map child with a first-party SwiftUI map primitive — no WKWebView,
//  no Leaflet clone:
//    web MapContainer → `Map`            web MapTileLayer → `.mapStyle` basemap
//    web Marker       → `Marker`         web Circle       → `MapCircle`
//    web Popup        → `Annotation`     web Polyline     → `MapPolyline`
//  Distances are SI: the geofence `radius` is meters straight from the API.
//

import CoreLocation
import MapKit
import SwiftUI

/// The MapKit canvas — the native peer of the web `MapContainer`.
struct GuardModeLiveMap: View {
    let coordinate: CLLocationCoordinate2D
    let vehicleName: String
    let homeGeofence: GuardModeGeofence?
    let trailCoordinates: [CLLocationCoordinate2D]

    @State private var camera: MapCameraPosition
    @State private var showPopup = true

    init(
        coordinate: CLLocationCoordinate2D,
        vehicleName: String,
        homeGeofence: GuardModeGeofence?,
        trailCoordinates: [CLLocationCoordinate2D]
    ) {
        self.coordinate = coordinate
        self.vehicleName = vehicleName
        self.homeGeofence = homeGeofence
        self.trailCoordinates = trailCoordinates
        _camera = State(initialValue: .region(MKCoordinateRegion(
            center: coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        )))
    }

    var body: some View {
        Map(position: $camera) {
            homeGeofenceCircle
            eventTrail
            vehicleMarker
            vehiclePopup
        }
        .mapStyle(mapTileStyle)
        .onTapGesture { showPopup.toggle() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilitySummary))
    }

    // MARK: - Web MapTileLayer → native basemap

    /// The first-party basemap that replaces the web dark tile layer.
    private var mapTileStyle: MapStyle {
        .standard(elevation: .flat, pointsOfInterest: .excludingAll)
    }

    // MARK: - Web Marker → native Marker

    @MapContentBuilder
    private var vehicleMarker: some MapContent {
        Marker(markerTitle, systemImage: "car.fill", coordinate: coordinate)
            .tint(.blue)
    }

    // MARK: - Web Popup → native Annotation callout

    @MapContentBuilder
    private var vehiclePopup: some MapContent {
        if showPopup {
            Annotation(markerTitle, coordinate: coordinate, anchor: .bottom) {
                GuardModeMapPopup(name: markerTitle, coordinate: coordinate)
            }
            .annotationTitles(.hidden)
        }
    }

    // MARK: - Web Circle → native MapCircle (home geofence, SI meters)

    @MapContentBuilder
    private var homeGeofenceCircle: some MapContent {
        if let homeGeofence {
            MapCircle(
                center: CLLocationCoordinate2D(
                    latitude: homeGeofence.latitude,
                    longitude: homeGeofence.longitude
                ),
                radius: homeGeofence.radius
            )
            .foregroundStyle(.blue.opacity(0.12))
            .stroke(.blue.opacity(0.6), lineWidth: 2)
        }
    }

    // MARK: - Web Polyline → native MapPolyline (event trail)

    @MapContentBuilder
    private var eventTrail: some MapContent {
        if trailCoordinates.count > 1 {
            MapPolyline(coordinates: trailCoordinates)
                .stroke(.red, style: StrokeStyle(lineWidth: 3, dash: [8, 4]))
        }
    }

    private var markerTitle: String {
        vehicleName.isEmpty ? coordinateText : vehicleName
    }

    private var coordinateText: String {
        String(format: "%.6f, %.6f", coordinate.latitude, coordinate.longitude)
    }

    private var accessibilitySummary: String {
        String(
            localized: "translation.guard.liveMap",
            defaultValue: "Live Vehicle Location"
        ) + ": " + markerTitle
    }
}

// MARK: - Popup card (web Popup body: name + coordinates)

/// The callout card rendered inside the vehicle `Annotation` — the native peer of
/// the web `MapPopup` (vehicle name over its 6-decimal coordinate).
struct GuardModeMapPopup: View {
    let name: String
    let coordinate: CLLocationCoordinate2D

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "car.fill")
                .font(.title3)
                .foregroundStyle(.blue)
            Text(name)
                .font(.caption)
                .fontWeight(.semibold)
            Text(coordinateText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(.blue.opacity(0.4), lineWidth: 1)
        )
        .shadow(radius: 4)
        .accessibilityElement(children: .combine)
    }

    private var coordinateText: String {
        String(format: "%.6f, %.6f", coordinate.latitude, coordinate.longitude)
    }
}
