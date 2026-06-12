//
//  WidgetMapView.Views.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  The presentational pieces of the map primitive — the native peers of the web elements: the empty
//  content default (the web optional `children`), the friendly empty leaf (the native "never a bare box"
//  peer of the web `<EmptyState message={emptyMessage} />`), and the MapKit canvas (the web
//  `<MapContainer>` with a dark tile layer + the `children` slot). All chrome is token-driven (P1/S9); no
//  raw hex, no Tailwind ports. Per Apple HIG the map uses the adaptive `.standard` style (the web hardcodes
//  dark Leaflet tiles only because the web app is dark-only; the native app supports light + dark through
//  the adaptive design tokens, the same way the sibling primitives dropped the Tailwind colors).
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - WidgetMapEmptyContent (web optional `children`)

/// An empty map-content value — the default overlay slot when a host mounts the primitive with no
/// `children`. Composes nothing, so a centered map renders without overlays.
public struct WidgetMapEmptyContent: MapContent {
    public init() {}

    @MapContentBuilder public var body: some MapContent {}
}

// MARK: - WidgetMapEmptyState (web `<EmptyState message={emptyMessage} />`)

/// The friendly empty leaf — the native "never a bare box" peer of the web
/// `<EmptyState message={emptyMessage} className="py-4" />`. A centered map-pin icon over the headline
/// (the resolved empty message) and a supporting hint, combined into a single VoiceOver element.
/// Token-driven (P1/S9); copy via the P1/S10 facade.
struct WidgetMapEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            Text(verbatim: WidgetMapViewStrings.emptyHint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(message). \(WidgetMapViewStrings.emptyHint)"))
    }
}

// MARK: - WidgetMapCanvasView (web `<MapContainer>{children}</MapContainer>`)

/// The MapKit canvas — the native peer of the web `<MapContainer>`: a rounded, clipped map centered on the
/// resolved ``WidgetMapCanvas`` geometry, with the caller's `content` overlay slot on top (web `children`).
/// `isInteractive` drives the gesture set (web `dragging`/`scrollWheelZoom = !compact`) and `showsControls`
/// drives the compass + scale controls (web `zoomControl = !compact`). The camera re-centers when the
/// geometry changes (a rebind), the native peer of the web map re-fitting to new `center` / `zoom` props.
struct WidgetMapCanvasView<Content: MapContent>: View {
    let canvas: WidgetMapCanvas
    let content: () -> Content

    @State private var camera: MapCameraPosition

    init(canvas: WidgetMapCanvas, content: @escaping () -> Content) {
        self.canvas = canvas
        self.content = content
        _camera = State(initialValue: Self.position(for: canvas))
    }

    var body: some View {
        Map(position: $camera, interactionModes: canvas.isInteractive ? .all : []) {
            content()
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControls {
            if canvas.showsControls {
                MapCompass()
                MapScaleView()
            }
        }
        .background(Color.TS.surface)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: WidgetMapViewStrings.accessibilityLabel))
        .onChange(of: canvas) { _, newCanvas in
            camera = Self.position(for: newCanvas)
        }
    }

    /// Builds the camera position for a resolved geometry — a square `MKCoordinateRegion` of
    /// `spanMeters` centered on the sanitized coordinate. MapKit re-fits the span to the live view's
    /// aspect at render.
    private static func position(for canvas: WidgetMapCanvas) -> MapCameraPosition {
        .region(
            MKCoordinateRegion(
                center: CLLocationCoordinate2D(
                    latitude: canvas.centerLatitude,
                    longitude: canvas.centerLongitude
                ),
                latitudinalMeters: canvas.spanMeters,
                longitudinalMeters: canvas.spanMeters
            )
        )
    }
}
