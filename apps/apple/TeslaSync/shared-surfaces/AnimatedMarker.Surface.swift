//
//  AnimatedMarker.Surface.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The live-position marker surface — the SwiftUI parity of `components/maps/AnimatedMarker.tsx`.
//  Composes the MapKit host (web leaflet `MapContainer` + `useMap`) with the pulsing heading-aware
//  marker (web `AnimatedMarker` `DivIcon`), the P4 leaf connectivity chip + banner, the marker info
//  chip, and the loading / empty / error overlays — every state renders over the map, never a blank
//  box. Bound through `AnimatedMarkerModel` (P1/S8); no networking lives here. The model emits
//  `view.opened` (P1/S11) on first appear and auto-refreshes once on the stale edge.
//
//  Every state renders — no hidden surface:
//    • loading — first fix in flight, no cached position → centred loading overlay over the map.
//    • empty   — fix resolved with no usable coordinate (web `hasCoords === false`) → friendly
//                "No location" overlay.
//    • error   — position query failed → inline error card + Retry, over the cached marker.
//    • ready   — the pulsing marker tracks the fix; the camera pans only when it leaves bounds.
//    • stale/offline — the orthogonal connectivity axis → freshness chip + banner with a one-shot
//                      auto-refresh on the stale edge.
//

import SwiftUI

// MARK: - AnimatedMarker (the reusable shared surface)

/// The reusable live-position marker surface. Renders every state from the web source plus the P4
/// leaf states, binding through `AnimatedMarkerModel`.
public struct AnimatedMarker: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AnimatedMarkerMeta.surfaceSlug
    }

    @State private var model: AnimatedMarkerModel

    private let height: CGFloat

    public init(model: AnimatedMarkerModel, height: CGFloat = 320) {
        _model = State(initialValue: model)
        self.height = height
    }

    public var body: some View {
        let resolved = model.resolved
        markerCard(resolved: resolved)
            .frame(minHeight: height)
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    // MARK: Map + overlays

    private func markerCard(resolved: AnimatedMarkerResolved) -> some View {
        AnimatedMarkerMapView(
            fix: resolved.fix,
            span: resolved.span,
            showsHeadingIndicator: model.content.showsHeadingIndicator,
            accessibilityLabel: AnimatedMarkerStrings.string("animatedMarker.mapA11y", "Vehicle position map"),
            accessibilityValue: AnimatedMarkerAccessibility.value(for: resolved)
        )
        .overlay(alignment: .top) { bannerLayer(resolved: resolved) }
        .overlay(alignment: .bottom) { infoBar(resolved: resolved) }
        .overlay { stateLayer(resolved: resolved) }
    }

    @ViewBuilder
    private func bannerLayer(resolved: AnimatedMarkerResolved) -> some View {
        if !resolved.isLive {
            AnimatedMarkerConnectivityBanner(connection: resolved.connection)
                .padding(TSSpacing.sm)
        }
    }

    private func infoBar(resolved: AnimatedMarkerResolved) -> some View {
        HStack(alignment: .bottom) {
            if let fix = resolved.fix {
                AnimatedMarkerInfoChip(fix: fix)
            }
            Spacer(minLength: TSSpacing.sm)
            AnimatedMarkerConnectivityChip(connection: resolved.connection) { model.refresh() }
        }
        .padding(TSSpacing.sm)
    }

    @ViewBuilder
    private func stateLayer(resolved: AnimatedMarkerResolved) -> some View {
        switch resolved.status {
        case .loading:
            AnimatedMarkerLoadingOverlay()
        case .empty:
            AnimatedMarkerEmptyOverlay()
        case .error:
            AnimatedMarkerErrorOverlay { model.refresh() }
        case .ready:
            EmptyView()
        }
    }
}

// MARK: - Convenience initialiser

public extension AnimatedMarker {
    /// Mounts the surface directly over a content config + a position snapshot, building the
    /// source-backed model — the parity of `<AnimatedMarker position=… heading=… color=… />` at a
    /// call site. `onRefresh` wires the web consumers' `refetch`.
    init(
        colorHex: String = AnimatedMarkerPalette.defaultHex,
        showsHeadingIndicator: Bool = true,
        span: AnimatedMarkerSpan = .defaultZoom,
        height: CGFloat = 320,
        input: AnimatedMarkerInput = AnimatedMarkerInput(),
        onRefresh: @escaping @MainActor () -> Void = {}
    ) {
        let content = AnimatedMarkerContent(
            defaultColorHex: colorHex,
            showsHeadingIndicator: showsHeadingIndicator,
            span: span
        )
        let source = LiveAnimatedMarkerSource(input: input, onRefresh: onRefresh)
        self.init(model: AnimatedMarkerModel(content: content, source: source), height: height)
    }
}
