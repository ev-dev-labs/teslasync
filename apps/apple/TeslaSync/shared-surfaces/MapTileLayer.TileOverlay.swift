//
//  MapTileLayer.TileOverlay.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The native MapKit base layer — the SwiftUI/MapKit parity of leaflet's `<TileLayer url …>`. SwiftUI's
//  `Map` cannot host an arbitrary XYZ tile source, so this wraps `MKMapView` in a cross-platform
//  representable (UIKit on iOS/iPadOS, AppKit on macOS) and installs an `MKTileOverlay` built from the
//  resolved tile template. The overlay `canReplaceMapContent`, so the third-party tiles fully replace
//  Apple's base map exactly the way leaflet's tile layer replaces its base — the web `MapInvalidator`
//  resize fix is unnecessary here because `MKMapView` re-tiles on its own layout, and the web
//  `useMap()` instance maps onto the bound `MKMapView`.
//

import MapKit
import SwiftUI

// MARK: - Tile overlay (web leaflet `TileLayer`)

/// An `MKTileOverlay` whose tiles come from an XYZ URL template. Overrides `url(forTilePath:)` so the
/// `{s}` subdomain rotation and the `{r}` retina suffix — which `MKTileOverlay` does not substitute
/// itself — are filled by ``MapTileLayerLogic``, matching leaflet's template handling. The stored
/// template + subdomains are immutable, so the tile-path callback (which MapKit may invoke off the
/// main thread) only reads constant state.
public final class MapTileLayerTileOverlay: MKTileOverlay {
    private let template: String
    private let subdomains: [String]

    public init(template: String, subdomains: [String] = MapTileLayerLogic.defaultSubdomains) {
        self.template = template
        self.subdomains = subdomains
        super.init(urlTemplate: template)
        canReplaceMapContent = true
    }

    /// The template this overlay renders — read by the representable to decide whether a swap is
    /// needed when the resolved tile source changes (provider/style/key).
    public var sourceTemplate: String {
        template
    }

    override public func url(forTilePath path: MKTileOverlayPath) -> URL {
        let filled = MapTileLayerLogic.fillTemplate(
            template,
            x: path.x,
            y: path.y,
            zoom: path.z,
            subdomains: subdomains,
            retina: path.contentScaleFactor > 1
        )
        // A valid template always yields a valid URL; `about:blank` is the inert last resort so a
        // malformed source fails the single tile rather than trapping.
        return URL(string: filled) ?? URL(string: "about:blank")!
    }
}

// MARK: - Cross-platform map representable (web `MapContainer` + `useMap`)

/// Bridges `MKMapView` into SwiftUI on both platforms, installing the tile overlay and keeping it in
/// sync as the resolved template changes. `canTile == false` (the defensive empty state) installs no
/// overlay so the surface's empty overlay reads cleanly over Apple's muted base.
struct MapTileLayerMapRepresentable {
    let urlTemplate: String
    let canTile: Bool
    let accessibilityLabel: String

    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let tileOverlay = overlay as? MKTileOverlay {
                return MKTileOverlayRenderer(tileOverlay: tileOverlay)
            }
            return MKOverlayRenderer(overlay: overlay)
        }
    }

    @MainActor
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    @MainActor
    private func makeMap(coordinator: Coordinator) -> MKMapView {
        let map = MKMapView()
        map.delegate = coordinator
        map.showsScale = false
        map.isPitchEnabled = false
        configureAccessibility(map)
        applyOverlay(to: map)
        return map
    }

    @MainActor
    private func updateMap(_ map: MKMapView) {
        configureAccessibility(map)
        applyOverlay(to: map)
    }

    /// Sets the map's VoiceOver element + label cross-platform — UIKit exposes assignable
    /// accessibility properties, AppKit exposes the setter methods.
    @MainActor
    private func configureAccessibility(_ map: MKMapView) {
        #if canImport(UIKit)
            map.isAccessibilityElement = true
            map.accessibilityLabel = accessibilityLabel
        #elseif canImport(AppKit)
            map.setAccessibilityElement(true)
            map.setAccessibilityLabel(accessibilityLabel)
        #endif
    }

    /// Installs / swaps / removes the tile overlay so it always matches the resolved template.
    @MainActor
    private func applyOverlay(to map: MKMapView) {
        let existing = map.overlays.compactMap { $0 as? MapTileLayerTileOverlay }
        guard canTile else {
            map.removeOverlays(existing)
            return
        }
        // No-op when the active overlay already renders this template (avoids re-tiling on every
        // unrelated SwiftUI update).
        if existing.count == 1, existing[0].sourceTemplate == urlTemplate {
            return
        }
        map.removeOverlays(existing)
        map.addOverlay(MapTileLayerTileOverlay(template: urlTemplate), level: .aboveLabels)
    }
}

#if canImport(UIKit)
    extension MapTileLayerMapRepresentable: UIViewRepresentable {
        func makeUIView(context: Context) -> MKMapView {
            makeMap(coordinator: context.coordinator)
        }

        func updateUIView(_ uiView: MKMapView, context _: Context) {
            updateMap(uiView)
        }
    }

#elseif canImport(AppKit)
    extension MapTileLayerMapRepresentable: NSViewRepresentable {
        func makeNSView(context: Context) -> MKMapView {
            makeMap(coordinator: context.coordinator)
        }

        func updateNSView(_ nsView: MKMapView, context _: Context) {
            updateMap(nsView)
        }
    }
#endif
