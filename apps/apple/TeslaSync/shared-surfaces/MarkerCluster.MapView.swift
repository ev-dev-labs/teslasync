//
//  MarkerCluster.MapView.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The native MapKit clustering layer — the SwiftUI/MapKit parity of `leaflet.markercluster`. SwiftUI's
//  `Map` cannot host thousands of declaratively-clustered annotations with custom colouring, so this
//  wraps `MKMapView` in a cross-platform representable (UIKit on iOS/iPadOS, AppKit on macOS) and uses
//  MapKit's built-in annotation clustering (`clusteringIdentifier` + `MKClusterAnnotation`) — the
//  idiomatic iOS 18 / macOS 15 equivalent of the web's leaflet cluster group. The web `useMap()`
//  instance maps onto the bound `MKMapView`; the marker colours come from each point's `color`
//  (`defaultColor` fallback), and the cluster bubble colour follows the resolved colour mode (the web
//  `defaultIconCreate` density palette or the `getClusterColor` dominant-child colour). The
//  `disableClusteringAtZoom` threshold is honoured by toggling the cluster identifier from the slippy
//  zoom recovered off the visible region; selection forwards the original point (web `onMarkerClick`).
//

import MapKit
import SwiftUI

#if canImport(UIKit)
    import UIKit

    /// The platform colour type the MapKit annotation views tint with (UIKit on iOS/iPadOS).
    public typealias MarkerClusterMarkerColor = UIColor
#elseif canImport(AppKit)
    import AppKit

    /// The platform colour type the MapKit annotation views tint with (AppKit on macOS).
    public typealias MarkerClusterMarkerColor = NSColor
#endif

// MARK: - Annotation (web leaflet marker → MapKit annotation)

/// An `MKAnnotation` that carries the originating ``MarkerClusterPoint`` — the native parity of a
/// leaflet marker whose source point is recovered on tap (web stores it in a `WeakMap`). MapKit
/// groups these into `MKClusterAnnotation`s when their views share a clustering identifier.
public final class MarkerClusterAnnotation: NSObject, MKAnnotation {
    public let point: MarkerClusterPoint
    public let coordinate: CLLocationCoordinate2D
    public var title: String?

    public init(point: MarkerClusterPoint) {
        self.point = point
        coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
        title = point.accessibilityLabel
        super.init()
    }
}

// MARK: - Map controller (the main-actor state behind the delegate)

/// The main-actor object that owns the `MKMapView` glue — annotation diffing, selection sync,
/// per-marker / per-cluster colouring, and the zoom-aware cluster toggle. The `MKMapViewDelegate`
/// callbacks (which MapKit invokes on the main thread) hop here through `MainActor.assumeIsolated`, so
/// all map mutation stays on the main actor under Swift 6 strict concurrency.
@MainActor
public final class MarkerClusterMapController {
    private let clusterReuseID = "MarkerClusterBubble"
    private let markerReuseID = "MarkerClusterDot"
    private let clusteringIdentifier = "markerCluster"

    var resolved: MarkerClusterResolved
    var selectedID: String?
    var accessibilityLabel: String
    private let model: MarkerClusterModel

    private var clusteringEnabled = true
    private var didFrameAnnotations = false

    init(model: MarkerClusterModel, accessibilityLabel: String) {
        self.model = model
        resolved = model.resolved
        selectedID = model.selectedPointID
        self.accessibilityLabel = accessibilityLabel
    }

    /// Registers the reusable annotation views and the map's accessibility identity.
    func configure(_ map: MKMapView) {
        map.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: markerReuseID
        )
        map.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: clusterReuseID
        )
        map.showsScale = false
        map.isPitchEnabled = false
        map.pointOfInterestFilter = .excludingAll
    }

    /// Pushes the latest resolved snapshot into the controller and reconciles the map to it.
    func update(resolved: MarkerClusterResolved, selectedID: String?, accessibilityLabel: String, on map: MKMapView) {
        self.resolved = resolved
        self.selectedID = selectedID
        self.accessibilityLabel = accessibilityLabel
        syncAccessibility(map)
        syncAnnotations(on: map)
        syncSelection(on: map)
    }

    // MARK: Delegate hops

    func view(for annotation: MKAnnotation, in map: MKMapView) -> MKAnnotationView? {
        if let cluster = annotation as? MKClusterAnnotation {
            return clusterView(for: cluster, in: map)
        }
        if let pointAnnotation = annotation as? MarkerClusterAnnotation {
            return markerView(for: pointAnnotation, in: map)
        }
        return nil
    }

    func didSelect(_ annotation: MKAnnotation, in map: MKMapView) {
        if let cluster = annotation as? MKClusterAnnotation {
            // Tapping a cluster zooms to its members (web `spiderfyOnMaxZoom` analogue), then clears
            // the transient cluster selection.
            map.showAnnotations(cluster.memberAnnotations, animated: true)
            map.deselectAnnotation(annotation, animated: false)
            return
        }
        if let point = (annotation as? MarkerClusterAnnotation)?.point {
            model.select(point)
        }
    }

    func didDeselect(_ annotation: MKAnnotation) {
        // Only clear when the deselected marker is the one we are tracking (avoids clobbering a
        // selection that a subsequent didSelect is about to set).
        guard let point = (annotation as? MarkerClusterAnnotation)?.point else { return }
        if model.selectedPointID == point.id {
            model.clearSelection()
        }
    }

    func regionChanged(on map: MKMapView) {
        let zoom = MarkerClusterLogic.zoomLevel(forLongitudeDelta: map.region.span.longitudeDelta)
        let enabled = MarkerClusterLogic.shouldCluster(zoom: zoom, disableAtZoom: resolved.disableClusteringAtZoom)
        guard enabled != clusteringEnabled else { return }
        clusteringEnabled = enabled
        // Re-add the point annotations so the new clustering identifier takes effect. Bounded: this
        // only fires when the map crosses the disable-clustering zoom boundary.
        let pointAnnotations = map.annotations.compactMap { $0 as? MarkerClusterAnnotation }
        map.removeAnnotations(pointAnnotations)
        map.addAnnotations(pointAnnotations)
    }

    // MARK: Annotation views

    private func markerView(for annotation: MarkerClusterAnnotation, in map: MKMapView) -> MKAnnotationView? {
        guard
            let view = map.dequeueReusableAnnotationView(
                withIdentifier: markerReuseID,
                for: annotation
            ) as? MKMarkerAnnotationView
        else { return nil }
        view.annotation = annotation
        view.markerTintColor = paletteColor(annotation.point.colorHex ?? resolved.defaultColorHex)
        view.glyphText = ""
        view.titleVisibility = .hidden
        view.subtitleVisibility = .hidden
        view.displayPriority = .required
        view.clusteringIdentifier = clusteringEnabled ? clusteringIdentifier : nil
        view.canShowCallout = false
        applyAccessibility(view, label: markerAccessibilityLabel(for: annotation.point))
        return view
    }

    private func clusterView(for cluster: MKClusterAnnotation, in map: MKMapView) -> MKAnnotationView? {
        guard
            let view = map.dequeueReusableAnnotationView(
                withIdentifier: clusterReuseID,
                for: cluster
            ) as? MKMarkerAnnotationView
        else { return nil }
        view.annotation = cluster
        let count = cluster.memberAnnotations.count
        view.markerTintColor = clusterColor(for: cluster)
        view.glyphText = String(count)
        view.titleVisibility = .hidden
        view.subtitleVisibility = .hidden
        view.displayPriority = .required
        view.canShowCallout = false
        applyAccessibility(view, label: clusterAccessibilityLabel(count: count))
        return view
    }

    // MARK: Sync

    private func syncAnnotations(on map: MKMapView) {
        guard resolved.canRender else {
            removePointAnnotations(on: map)
            didFrameAnnotations = false
            return
        }
        let existing = map.annotations.compactMap { $0 as? MarkerClusterAnnotation }
        let existingByID = Dictionary(existing.map { ($0.point.id, $0) }) { first, _ in first }
        let desiredByID = Dictionary(resolved.points.map { ($0.id, $0) }) { first, _ in first }

        let toRemove = existing.filter { desiredByID[$0.point.id] != $0.point }
        let toAdd = resolved.points
            .filter { existingByID[$0.id]?.point != $0 }
            .map(MarkerClusterAnnotation.init)

        if !toRemove.isEmpty { map.removeAnnotations(toRemove) }
        if !toAdd.isEmpty { map.addAnnotations(toAdd) }

        if !didFrameAnnotations, !resolved.points.isEmpty {
            didFrameAnnotations = true
            let pointAnnotations = map.annotations.compactMap { $0 as? MarkerClusterAnnotation }
            map.showAnnotations(pointAnnotations, animated: false)
        }
    }

    private func syncSelection(on map: MKMapView) {
        let pointAnnotations = map.annotations.compactMap { $0 as? MarkerClusterAnnotation }
        guard let selectedID else {
            for annotation in map.selectedAnnotations where annotation is MarkerClusterAnnotation {
                map.deselectAnnotation(annotation, animated: false)
            }
            return
        }
        let alreadySelected = map.selectedAnnotations.contains {
            ($0 as? MarkerClusterAnnotation)?.point.id == selectedID
        }
        guard !alreadySelected, let target = pointAnnotations.first(where: { $0.point.id == selectedID }) else {
            return
        }
        map.selectAnnotation(target, animated: true)
    }

    private func removePointAnnotations(on map: MKMapView) {
        let pointAnnotations = map.annotations.compactMap { $0 as? MarkerClusterAnnotation }
        if !pointAnnotations.isEmpty { map.removeAnnotations(pointAnnotations) }
    }

    private func syncAccessibility(_ map: MKMapView) {
        #if canImport(UIKit)
            map.accessibilityLabel = accessibilityLabel
        #elseif canImport(AppKit)
            map.setAccessibilityLabel(accessibilityLabel)
        #endif
    }

    /// Sets an annotation view's VoiceOver identity cross-platform — UIKit exposes assignable
    /// accessibility properties, AppKit exposes the setter methods (the `MKAnnotationView` is a
    /// `UIView` on iOS/iPadOS and an `NSView` on macOS).
    private func applyAccessibility(_ view: MKAnnotationView, label: String) {
        #if canImport(UIKit)
            view.isAccessibilityElement = true
            view.accessibilityLabel = label
        #elseif canImport(AppKit)
            view.setAccessibilityElement(true)
            view.setAccessibilityLabel(label)
        #endif
    }

    // MARK: Colour

    private func clusterColor(for cluster: MKClusterAnnotation) -> MarkerClusterMarkerColor {
        switch resolved.colorMode {
        case .countDensity:
            return paletteColor(MarkerClusterDensity.forCount(cluster.memberAnnotations.count).colorHex)
        case .dominantChild:
            let members = cluster.memberAnnotations.compactMap { ($0 as? MarkerClusterAnnotation)?.point }
            let hex = MarkerClusterLogic.dominantColorHex(
                children: members,
                defaultColorHex: resolved.defaultColorHex
            )
            return paletteColor(hex)
        }
    }

    private func paletteColor(_ hex: String) -> MarkerClusterMarkerColor {
        let rgba = MarkerClusterColor.parse(hex)
            ?? MarkerClusterColor.parse(resolved.defaultColorHex)
            ?? MarkerClusterRGBA(red: 0.133, green: 0.827, blue: 0.933)
        #if canImport(UIKit)
            return UIColor(red: rgba.red, green: rgba.green, blue: rgba.blue, alpha: rgba.alpha)
        #elseif canImport(AppKit)
            return NSColor(srgbRed: rgba.red, green: rgba.green, blue: rgba.blue, alpha: rgba.alpha)
        #endif
    }

    // MARK: Accessibility copy

    private func markerAccessibilityLabel(for point: MarkerClusterPoint) -> String {
        point.accessibilityLabel
            ?? MarkerClusterLogic.plainText(point.popupHTML)
            ?? MarkerClusterStrings.string("markerCluster.markerA11y", "Map marker")
    }

    private func clusterAccessibilityLabel(count: Int) -> String {
        let template = MarkerClusterStrings.string("markerCluster.clusterA11y", "Cluster of %d markers")
        return String(format: template, count)
    }
}

// MARK: - Cross-platform representable (web `MapContainer` + `useMap`)

/// Bridges `MKMapView` into SwiftUI on both platforms, owning a ``MarkerClusterMapController`` as its
/// coordinator-side state and reconciling the map to each resolved snapshot. The model is held so the
/// delegate can forward selection (web `onMarkerClick`); the value-typed `resolved` / `selectedID`
/// drive SwiftUI's update diffing so the map re-syncs when the projection changes.
struct MarkerClusterMapRepresentable {
    let model: MarkerClusterModel
    let resolved: MarkerClusterResolved
    let selectedID: String?
    let accessibilityLabel: String

    final class Coordinator: NSObject, MKMapViewDelegate {
        let controller: MarkerClusterMapController

        init(controller: MarkerClusterMapController) {
            self.controller = controller
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            MainActor.assumeIsolated { controller.view(for: annotation, in: mapView) }
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let annotation = view.annotation else { return }
            MainActor.assumeIsolated { controller.didSelect(annotation, in: mapView) }
        }

        func mapView(_: MKMapView, didDeselect view: MKAnnotationView) {
            guard let annotation = view.annotation else { return }
            MainActor.assumeIsolated { controller.didDeselect(annotation) }
        }

        func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) {
            MainActor.assumeIsolated { controller.regionChanged(on: mapView) }
        }
    }

    @MainActor
    func makeCoordinator() -> Coordinator {
        Coordinator(controller: MarkerClusterMapController(model: model, accessibilityLabel: accessibilityLabel))
    }

    @MainActor
    private func makeMap(coordinator: Coordinator) -> MKMapView {
        let map = MKMapView()
        map.delegate = coordinator
        coordinator.controller.configure(map)
        coordinator.controller.update(
            resolved: resolved,
            selectedID: selectedID,
            accessibilityLabel: accessibilityLabel,
            on: map
        )
        return map
    }

    @MainActor
    private func updateMap(_ map: MKMapView, coordinator: Coordinator) {
        coordinator.controller.update(
            resolved: resolved,
            selectedID: selectedID,
            accessibilityLabel: accessibilityLabel,
            on: map
        )
    }
}

#if canImport(UIKit)
    extension MarkerClusterMapRepresentable: UIViewRepresentable {
        func makeUIView(context: Context) -> MKMapView {
            makeMap(coordinator: context.coordinator)
        }

        func updateUIView(_ uiView: MKMapView, context: Context) {
            updateMap(uiView, coordinator: context.coordinator)
        }
    }

#elseif canImport(AppKit)
    extension MarkerClusterMapRepresentable: NSViewRepresentable {
        func makeNSView(context: Context) -> MKMapView {
            makeMap(coordinator: context.coordinator)
        }

        func updateNSView(_ nsView: MKMapView, context: Context) {
            updateMap(nsView, coordinator: context.coordinator)
        }
    }
#endif
