//
//  AnimatedMarker.MarkerMap.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The native MapKit host — the SwiftUI/MapKit parity of the web `AnimatedMarker` living inside its
//  parent leaflet `MapContainer` and reaching the map through `useMap()`. SwiftUI's `Map` is the
//  native idiom in this codebase (see `TSMapView` / `LocationMapWidget`), so the marker renders as a
//  SwiftUI `Annotation` whose content is the pulsing glyph, and the web `useMap()` instance maps onto
//  the bound `Map` camera. The web effect's two behaviours are reproduced exactly:
//
//    • reposition — the annotation re-anchors to the new coordinate (web `marker.setLatLng`);
//    • keep-in-view — the camera pans to the target ONLY when it leaves the visible bounds (web
//      `if (!map.getBounds().contains(target)) map.panTo(target, { animate: true, duration: 0.3 })`),
//      animated unless Reduce Motion is on (the web consumers snap under reduced motion).
//
//  The pan decision is the pure `AnimatedMarkerGeo.region(_:contains:)`; the view only converts to
//  MapKit types at this boundary.
//

import MapKit
import SwiftUI

// MARK: - MapKit boundary conversions

extension AnimatedMarkerCoordinate {
    /// The MapKit coordinate for this value type (MapKit boundary only).
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension AnimatedMarkerSpan {
    /// The MapKit span for this value type (MapKit boundary only).
    var coordinateSpan: MKCoordinateSpan {
        MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    }
}

// MARK: - Marker map (web `MapContainer` + `useMap` + `AnimatedMarker`)

/// The MapKit map hosting the animated marker. Owns the camera (web `useMap`), tracks the visible
/// region, and pans only when the marker leaves it — the verbatim port of the web keep-in-view effect.
struct AnimatedMarkerMapView: View {
    let fix: AnimatedMarkerFix?
    let span: AnimatedMarkerSpan
    let showsHeadingIndicator: Bool
    let accessibilityLabel: String
    let accessibilityValue: String
    let interactive: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var camera: MapCameraPosition
    @State private var visibleRegion: MKCoordinateRegion?

    init(
        fix: AnimatedMarkerFix?,
        span: AnimatedMarkerSpan,
        showsHeadingIndicator: Bool,
        accessibilityLabel: String,
        accessibilityValue: String,
        interactive: Bool = true
    ) {
        self.fix = fix
        self.span = span
        self.showsHeadingIndicator = showsHeadingIndicator
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.interactive = interactive
        _camera = State(initialValue: AnimatedMarkerMapView.initialCamera(fix: fix, span: span))
    }

    var body: some View {
        Map(position: $camera, interactionModes: interactive ? .all : []) {
            if let fix {
                Annotation(
                    "",
                    coordinate: fix.coordinate.clCoordinate,
                    anchor: .center
                ) {
                    AnimatedMarkerGlyph(
                        color: fix.color.color,
                        heading: showsHeadingIndicator ? fix.heading : nil
                    )
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onMapCameraChange(frequency: .onEnd) { context in
            visibleRegion = context.region
        }
        .onChange(of: fix) { _, newFix in
            recenterIfNeeded(to: newFix)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    // MARK: Keep-in-view (web `panTo` only when out of bounds)

    /// Pans the camera to a new fix only when it leaves the current visible bounds — the verbatim port
    /// of the web `if (!map.getBounds().contains(target)) map.panTo(...)`. Before the first camera
    /// reading the surface centres on the first fix so the marker is never off-screen.
    private func recenterIfNeeded(to newFix: AnimatedMarkerFix?) {
        guard let target = newFix?.coordinate else { return }
        guard let region = visibleRegion else {
            setCamera(center: target.clCoordinate, span: span.coordinateSpan)
            return
        }
        let center = AnimatedMarkerCoordinate(
            latitude: region.center.latitude,
            longitude: region.center.longitude
        )
        let visibleSpan = AnimatedMarkerSpan(
            latitudeDelta: region.span.latitudeDelta,
            longitudeDelta: region.span.longitudeDelta
        )
        if AnimatedMarkerGeo.region(center: center, span: visibleSpan, contains: target) {
            return
        }
        setCamera(center: target.clCoordinate, span: region.span)
    }

    /// Sets the camera to a region, animated (web `panTo({ animate: true, duration: 0.3 })`) unless
    /// Reduce Motion is on (the web consumers snap under reduced motion).
    private func setCamera(center: CLLocationCoordinate2D, span: MKCoordinateSpan) {
        let region = MKCoordinateRegion(center: center, span: span)
        if reduceMotion {
            camera = .region(region)
        } else {
            withAnimation(.easeInOut(duration: 0.3)) {
                camera = .region(region)
            }
        }
    }

    /// The initial camera — centred on the first fix when present, else a neutral region (the
    /// loading / empty overlays cover the map until a usable fix resolves).
    static func initialCamera(fix: AnimatedMarkerFix?, span: AnimatedMarkerSpan) -> MapCameraPosition {
        let center = fix?.coordinate ?? AnimatedMarkerCoordinate(latitude: 0, longitude: 0)
        return .region(MKCoordinateRegion(center: center.clCoordinate, span: span.coordinateSpan))
    }
}
