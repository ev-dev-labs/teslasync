//
//  WidgetMapView.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  The public API of the map widget primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetMapView.tsx`. Like the web component it is driven entirely by
//  its props (`center`, `zoom`, `compact`, `isEmpty`, `emptyMessage`) plus a content slot (the web
//  `children` → a generic `@MapContentBuilder Content`); there is no fetcher. The view binds through
//  ``WidgetMapViewModel`` for the derived projection + the once-only `view.opened` telemetry (P1/S11),
//  composes the token-driven canvas (P1/S9) over MapKit (web Leaflet → MapKit, ADR-005/009), and pushes
//  prop changes into the holder via `.onChange` so a reused / rebound map re-renders faithfully. No
//  networking, no Tailwind ports.
//

import CoreLocation
import MapKit
import SwiftUI

/// The map widget primitive — the SwiftUI parity of `WidgetMapView.tsx`. Renders, faithfully to the web
/// source, either the friendly empty leaf (web `isEmpty` → `<EmptyState message={emptyMessage} />`) or a
/// clipped, adaptive MapKit canvas centered on `center` at the Leaflet `zoom`, with the caller's map
/// `content` slot on top (web `children`) and `compact` gating interaction + controls (web
/// `dragging`/`scrollWheelZoom`/`zoomControl = !compact`). A shared widget building block — mount it inside
/// a dashboard widget that supplies the center, zoom, and overlays.
///
/// The view emits the P1/S11 `view.opened` diagnostic once on appear and binds no data (the hosting widget
/// supplies every input), matching the web presentational component.
public struct WidgetMapView<Content: MapContent>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        WidgetMapViewSurface.slug
    }

    private let input: WidgetMapInput
    private let emptyMessage: String?
    private let content: () -> Content
    @State private var model: WidgetMapViewModel

    /// The prop-style initializer — the parity of `<WidgetMapView center zoom compact isEmpty
    /// emptyMessage>{children}</WidgetMapView>`. `center` is the web `[lat, lng]` as a coordinate; `zoom`
    /// defaults to the web `13`; `compact` (default `false`) makes a non-interactive preview; `isEmpty`
    /// (default `false`) selects the empty leaf; `emptyMessage` overrides the empty-leaf copy (the web
    /// default is resolved through the P1/S10 facade when `nil`); `content` is the map overlay slot.
    public init(
        center: CLLocationCoordinate2D,
        zoom: Double = WidgetMapGeometry.defaultZoom,
        compact: Bool = false,
        isEmpty: Bool = false,
        emptyMessage: String? = nil,
        telemetry: any WidgetMapViewTelemetry = OSLogWidgetMapViewTelemetry(),
        @MapContentBuilder content: @escaping () -> Content
    ) {
        let resolved = WidgetMapInput(
            centerLatitude: center.latitude,
            centerLongitude: center.longitude,
            zoom: zoom,
            compact: compact,
            isEmpty: isEmpty
        )
        input = resolved
        self.emptyMessage = emptyMessage
        self.content = content
        _model = State(initialValue: WidgetMapViewModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input). The
    /// map `content` slot still lives at the view layer (the web `children`), so it is supplied here.
    public init(
        model: WidgetMapViewModel,
        emptyMessage: String? = nil,
        @MapContentBuilder content: @escaping () -> Content
    ) {
        input = model.input
        self.emptyMessage = emptyMessage
        self.content = content
        _model = State(initialValue: model)
    }

    public var body: some View {
        contentView
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }

    /// The empty leaf or the populated canvas — the native peer of the web render decision
    /// (`isEmpty ? <EmptyState/> : <MapContainer>{children}</MapContainer>`).
    @ViewBuilder
    private var contentView: some View {
        switch model.projection {
        case .empty:
            WidgetMapEmptyState(message: resolvedEmptyMessage)
        case let .map(canvas):
            WidgetMapCanvasView(canvas: canvas, content: content)
        }
    }

    /// Web `emptyMessage ?? 'No location data available'` — the override falls back to the P1/S10 facade.
    private var resolvedEmptyMessage: String {
        emptyMessage ?? WidgetMapViewStrings.emptyMessage
    }
}

// MARK: - No-content convenience (web `<WidgetMapView />` with no children)

public extension WidgetMapView where Content == WidgetMapEmptyContent {
    /// Childless initializer — the parity of a `<WidgetMapView>` with no `children`: a centered map with
    /// no overlays. Mirrors the web optional `children`.
    init(
        center: CLLocationCoordinate2D,
        zoom: Double = WidgetMapGeometry.defaultZoom,
        compact: Bool = false,
        isEmpty: Bool = false,
        emptyMessage: String? = nil,
        telemetry: any WidgetMapViewTelemetry = OSLogWidgetMapViewTelemetry()
    ) {
        self.init(
            center: center,
            zoom: zoom,
            compact: compact,
            isEmpty: isEmpty,
            emptyMessage: emptyMessage,
            telemetry: telemetry
        ) {
            WidgetMapEmptyContent()
        }
    }
}
