//
//  WidgetMapView.Adapter.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  The Foundation-only core for the map widget primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetMapView.tsx`. This file owns the surface identity (the
//  diagnostics slug), the props (``WidgetMapInput``), the resolved view-ready geometry
//  (``WidgetMapCanvas``), the ``WidgetMapProjection`` render decision, the pure geometry helpers
//  (``WidgetMapGeometry`` — the Leaflet-zoom → MapKit-span conversion + the `compact` interaction /
//  controls decisions that port the web `scrollWheelZoom={!compact}` / `zoomControl={!compact}` /
//  `dragging={!compact}`), and the pure ``WidgetMapViewProjector`` that ports the web render branch
//  (`isEmpty ? <EmptyState/> : <MapContainer/>`). No SwiftUI, no MapKit, no `@Observable`, so every rule
//  is unit-testable in isolation on a plain host.
//
//  Faithful-parity note: the web `<WidgetMapView>` is a PURE presentational primitive — a shared widget
//  building block. It takes its data as plain props (`center`, `zoom`, `compact`, `isEmpty`,
//  `emptyMessage`, `children`) and renders a clipped map with a content slot, with no fetch, no
//  React-Query cache, and no Promise, so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to — the host widget that owns the query renders
//  those). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces only the source's REAL branches — exactly as the sibling presentational primitives
//  WidgetChartSummary (0002) and WidgetComparisonCard (0003) did. The real branches: the empty leaf (web
//  `isEmpty` → `<EmptyState message={emptyMessage} />`) and the populated map (web `<MapContainer>` with a
//  dark tile layer + the `children` content slot). `compact` is a real interaction/controls branch.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetMapViewSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetMapView"
}

// MARK: - WidgetMapInput (web props)

/// The map primitive's props — the native peer of the web `WidgetMapViewProps`. `centerLatitude` /
/// `centerLongitude` are the two halves of the web `center: [number, number]` (Leaflet `[lat, lng]`);
/// `zoom` is the Leaflet zoom level (web default `13`); `compact` gates interaction + controls (web
/// `scrollWheelZoom` / `zoomControl` / `dragging` = `!compact`); `isEmpty` selects the empty leaf (web
/// `isEmpty`). Equatable so a rebind re-renders only on a real change; Sendable so it crosses actors. The
/// `emptyMessage` is NOT held here — it is resolved at the view boundary through the P1/S10 facade, the
/// same way the web default `emptyMessage = 'No location data available'` is applied at render.
public struct WidgetMapInput: Equatable, Sendable {
    /// Latitude half of the web `center[0]`, in degrees.
    public let centerLatitude: Double
    /// Longitude half of the web `center[1]`, in degrees.
    public let centerLongitude: Double
    /// Leaflet zoom level (web `zoom`, default `13`).
    public let zoom: Double
    /// Whether the map is a non-interactive preview (web `compact`): no drag / scroll-zoom / controls.
    public let compact: Bool
    /// Whether to render the empty leaf instead of the map (web `isEmpty`).
    public let isEmpty: Bool

    public init(
        centerLatitude: Double,
        centerLongitude: Double,
        zoom: Double = WidgetMapGeometry.defaultZoom,
        compact: Bool = false,
        isEmpty: Bool = false
    ) {
        self.centerLatitude = centerLatitude
        self.centerLongitude = centerLongitude
        self.zoom = zoom
        self.compact = compact
        self.isEmpty = isEmpty
    }
}

// MARK: - WidgetMapCanvas (resolved, view-ready geometry)

/// The resolved, view-ready map geometry — a pure value the SwiftUI canvas turns into an
/// `MKCoordinateRegion` + `MapInteractionModes`. `centerLatitude` / `centerLongitude` are the sanitized
/// (finite, in-range) center; `spanMeters` is the Leaflet-zoom-derived square viewport span in meters;
/// `isInteractive` ports `dragging`/`scrollWheelZoom = !compact`; `showsControls` ports
/// `zoomControl = !compact`. Equatable so the canvas re-centers only on a real geometry change; Sendable
/// so it crosses actors.
public struct WidgetMapCanvas: Equatable, Sendable {
    public let centerLatitude: Double
    public let centerLongitude: Double
    public let spanMeters: Double
    public let isInteractive: Bool
    public let showsControls: Bool

    public init(
        centerLatitude: Double,
        centerLongitude: Double,
        spanMeters: Double,
        isInteractive: Bool,
        showsControls: Bool
    ) {
        self.centerLatitude = centerLatitude
        self.centerLongitude = centerLongitude
        self.spanMeters = spanMeters
        self.isInteractive = isInteractive
        self.showsControls = showsControls
    }
}

// MARK: - WidgetMapProjection (web render decision)

/// The resolved render decision — the native peer of the web `isEmpty ? <EmptyState/> : <MapContainer/>`.
/// Only the source's REAL branches exist (see the faithful-parity note above): the empty leaf and the
/// populated map. Equatable + Sendable so it is a pure, testable read.
public enum WidgetMapProjection: Equatable, Sendable {
    /// Web `isEmpty` → the friendly empty leaf (peer of `<EmptyState message={emptyMessage} />`).
    case empty
    /// Web populated map (`<MapContainer …>{children}</MapContainer>`), carrying the resolved geometry.
    case map(WidgetMapCanvas)
}

// MARK: - WidgetMapGeometry (pure Leaflet-zoom → MapKit-span math + decisions)

/// Pure geospatial helpers for the primitive, mirroring the web component's behavior so they can be
/// unit-tested without MapKit or SwiftUI. The Leaflet web map sizes its viewport from an integer `zoom`
/// over Web-Mercator 256-px tiles; MapKit sizes a region from a metric span. ``spanMeters`` bridges the
/// two via the standard Web-Mercator ground resolution (`metersPerPixel`), and the `compact` decisions
/// port the web interaction props (`scrollWheelZoom` / `zoomControl` / `dragging` = `!compact`).
public enum WidgetMapGeometry {
    /// Web-Mercator tile edge (256 pt) — one tile's worth of ground is the nominal region span.
    public static let tilePoints: Double = 256
    /// Ground resolution at the equator at zoom 0 for 256-px tiles (meters per pixel) — the Web-Mercator
    /// constant `2 * π * 6_378_137 / 256`.
    public static let baseMetersPerPixel: Double = 156_543.033_928_041
    /// Leaflet's practical zoom floor used for clamping (whole-world-ish).
    public static let minZoom: Double = 1
    /// Leaflet's practical zoom ceiling used for clamping (building level).
    public static let maxZoom: Double = 22
    /// The web default `zoom = 13` (neighborhood level).
    public static let defaultZoom: Double = 13
    /// Lower bound on the resolved span so a degenerate zoom never collapses the region.
    public static let minSpanMeters: Double = 50
    /// Upper bound on the resolved span so a tiny zoom never overflows the region.
    public static let maxSpanMeters: Double = 20_000_000

    /// Clamps a latitude into the valid Web-Mercator-safe range, mapping a non-finite value to the
    /// equator so the downstream region is always well-formed (the web Leaflet center is assumed valid;
    /// the native peer is defensive).
    public static func sanitizeLatitude(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(max(value, -90), 90)
    }

    /// Clamps a longitude into `[-180, 180]`, mapping a non-finite value to the prime meridian.
    public static func sanitizeLongitude(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(max(value, -180), 180)
    }

    /// Clamps a Leaflet zoom into `[minZoom, maxZoom]`, mapping a non-finite value to the web default.
    public static func sanitizeZoom(_ value: Double) -> Double {
        guard value.isFinite else { return defaultZoom }
        return min(max(value, minZoom), maxZoom)
    }

    /// Web-Mercator ground resolution (meters per pixel) at a latitude + zoom — narrows with latitude
    /// (the `cos(lat)` term) and halves each zoom step. Non-negative for any sanitized input.
    public static func metersPerPixel(latitude: Double, zoom: Double) -> Double {
        let latitudeRadians = sanitizeLatitude(latitude) * .pi / 180
        let resolution = baseMetersPerPixel * cos(latitudeRadians) / pow(2, sanitizeZoom(zoom))
        return max(resolution, 0)
    }

    /// The nominal square region span (meters) for a Leaflet zoom — one 256-px tile's worth of ground,
    /// clamped into `[minSpanMeters, maxSpanMeters]`. MapKit re-fits this to the live view's aspect at
    /// render, so the figure is a resolution-independent, deterministic peer of the web zoom level.
    public static func spanMeters(latitude: Double, zoom: Double) -> Double {
        let raw = metersPerPixel(latitude: latitude, zoom: zoom) * tilePoints
        return min(max(raw, minSpanMeters), maxSpanMeters)
    }

    /// Web `dragging={!compact}` + `scrollWheelZoom={!compact}` — the map is interactive only outside
    /// compact mode.
    public static func isInteractive(compact: Bool) -> Bool {
        !compact
    }

    /// Web `zoomControl={!compact}` — the map shows its controls only outside compact mode.
    public static func showsControls(compact: Bool) -> Bool {
        !compact
    }
}

// MARK: - WidgetMapViewProjector (pure render-decision port)

/// Ports the web render decision (`isEmpty ? <EmptyState/> : <MapContainer/>`) to a pure, testable
/// projection, and resolves the populated branch's geometry from the props. No SwiftUI / MapKit, so the
/// derivation is verified in isolation.
public enum WidgetMapViewProjector {
    /// The web render branch: the empty leaf when `isEmpty`, else the populated map with resolved
    /// geometry.
    public static func resolve(_ input: WidgetMapInput) -> WidgetMapProjection {
        guard !input.isEmpty else { return .empty }
        return .map(canvas(input))
    }

    /// The resolved geometry for the populated branch — the sanitized center, the zoom-derived span, and
    /// the `compact`-driven interaction + controls decisions.
    public static func canvas(_ input: WidgetMapInput) -> WidgetMapCanvas {
        WidgetMapCanvas(
            centerLatitude: WidgetMapGeometry.sanitizeLatitude(input.centerLatitude),
            centerLongitude: WidgetMapGeometry.sanitizeLongitude(input.centerLongitude),
            spanMeters: WidgetMapGeometry.spanMeters(latitude: input.centerLatitude, zoom: input.zoom),
            isInteractive: WidgetMapGeometry.isInteractive(compact: input.compact),
            showsControls: WidgetMapGeometry.showsControls(compact: input.compact)
        )
    }
}
