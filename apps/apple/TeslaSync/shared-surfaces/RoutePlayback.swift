//
//  RoutePlayback.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The route-playback surface — the SwiftUI parity of `web/src/components/maps/RoutePlayback.tsx`. It
//  composes the MapKit host (web Leaflet `MapContainer` + `useMap`) — the trail polyline, the start /
//  end anchors, and the heading-aware playhead tracking `currentIndex` — with the inline metric chip
//  (web top-right overlay), the floating tile-layer switcher (web `MapLayerSwitcher`), the embedded
//  controlled transport bar (web `PlaybackControls`), the P4 leaf connectivity chip + banner, and the
//  loading / empty / error states — every state renders, never a blank box. Bound through
//  `RoutePlaybackModel` (P1/S8); no networking lives here. The model emits `view.opened` (P1/S11) on
//  first appear and auto-refreshes once on the stale edge.
//
//  Every state renders — no hidden surface:
//    • loading — first fetch in flight, no cached route → centred loading panel.
//    • empty   — route resolved with no plottable GPS points (web `trail.length === 0`) → the friendly
//                "No GPS points to replay for this route." empty state.
//    • error   — route query failed → `QueryError`-equivalent (no cached route) or an inline error
//                overlay + Retry over the cached trail.
//    • ready   — the map + trail + playhead + transport bar; the playhead tracks `currentIndex`.
//    • stale/offline — the orthogonal connectivity axis → freshness chip + banner with a one-shot
//                      auto-refresh on the stale edge.
//

import SwiftUI

// MARK: - RoutePlayback (the reusable shared surface)

/// The reusable route-playback surface. Renders every state from the web source plus the P4 leaf
/// states, binding through `RoutePlaybackModel`.
public struct RoutePlayback: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        RoutePlaybackMeta.surfaceSlug
    }

    @State private var model: RoutePlaybackModel

    public init(model: RoutePlaybackModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        let resolved = model.resolved
        content(resolved: resolved)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    // MARK: State routing

    @ViewBuilder
    private func content(resolved: RoutePlaybackResolved) -> some View {
        if resolved.hasRoute {
            readyPanel(resolved: resolved)
        } else if resolved.status == .error {
            TSGlassPanel {
                TSQueryError(onRetry: { model.refresh() })
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: CGFloat(resolved.content.height))
            }
        } else if resolved.status == .loading {
            TSGlassPanel {
                RoutePlaybackLoadingPanel(height: CGFloat(resolved.content.height))
            }
        } else {
            TSGlassPanel {
                emptyState(content: resolved.content)
            }
        }
    }

    // MARK: Ready panel (map + transport — web GlassPanel with overflow-hidden)

    private func readyPanel(resolved: RoutePlaybackResolved) -> some View {
        let content = resolved.content
        let frame = model.frame
        let mapLabel = content.ariaLabelOverride
            ?? RoutePlaybackStrings.string("maps.routePlayback.mapLabel", "Route playback map")
        let mapValue = RoutePlaybackAccessibility.mapValue(frame: frame, connection: resolved.connection)
        let shape = RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)

        return VStack(spacing: 0) {
            RoutePlaybackMapView(
                route: resolved.route,
                frame: frame,
                trailColor: RoutePlaybackTint.trail(content),
                markerColor: RoutePlaybackTint.marker(content),
                showsLayerSwitcher: content.showsLayerSwitcher,
                initialStyle: content.initialMapStyle,
                accessibilityLabel: mapLabel,
                accessibilityValue: mapValue
            )
            .frame(height: CGFloat(content.height))
            .overlay(alignment: .topTrailing) { metricChip(frame: frame) }
            .overlay(alignment: .bottomLeading) { banner(resolved: resolved) }
            .overlay(alignment: .bottomTrailing) { connectivityChip(resolved: resolved) }
            .overlay { errorOverlay(resolved: resolved) }

            if content.showsControls {
                Divider().overlay(Color.TS.border)
                PlaybackControls(model: model.controlsModel)
            }
        }
        .background(TSMaterial.panel, in: shape)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
    }

    // MARK: Map overlays

    @ViewBuilder
    private func metricChip(frame: RoutePlaybackFrame) -> some View {
        if frame.currentPoint != nil {
            RoutePlaybackMetricChip(frame: frame)
                .padding(TSSpacing.sm)
        }
    }

    @ViewBuilder
    private func banner(resolved: RoutePlaybackResolved) -> some View {
        if !resolved.isLive {
            RoutePlaybackConnectivityBanner(connection: resolved.connection)
                .padding(TSSpacing.sm)
        }
    }

    private func connectivityChip(resolved: RoutePlaybackResolved) -> some View {
        RoutePlaybackConnectivityChip(connection: resolved.connection) { model.refresh() }
            .padding(TSSpacing.sm)
    }

    @ViewBuilder
    private func errorOverlay(resolved: RoutePlaybackResolved) -> some View {
        if resolved.status == .error {
            RoutePlaybackErrorOverlay { model.refresh() }
        }
    }

    // MARK: Empty state (web `EmptyState`)

    private func emptyState(content: RoutePlaybackContent) -> some View {
        let message = content.emptyMessageOverride
            ?? RoutePlaybackStrings.string(
                "maps.routePlayback.empty",
                "No GPS points to replay for this route."
            )
        return TSEmptyState(title: LocalizedStringKey(message), systemImage: "mappin.slash")
            .frame(maxWidth: .infinity)
            .frame(minHeight: CGFloat(content.height))
    }
}

// MARK: - Convenience initialiser

public extension RoutePlayback {
    /// Mounts the surface directly over a content config + a route snapshot, building the source-backed
    /// model — the parity of `<RoutePlayback points=… autoPlay=… trailColor=… />` at a call site.
    /// `onRefresh` wires the web consumers' `refetch`; `onPositionChange` wires the web scrub-sync hook.
    init(
        points: [RoutePlaybackPointRow],
        autoPlay: Bool = false,
        height: Double = 400,
        initialMapStyle: RoutePlaybackMapStyle = .standard,
        showsLayerSwitcher: Bool = true,
        showsControls: Bool = true,
        trailColorHex: String? = nil,
        markerColorHex: String? = nil,
        accessibilityLabel: String? = nil,
        emptyMessage: String? = nil,
        onPositionChange: (@MainActor (RoutePlaybackPoint, Int) -> Void)? = nil,
        onRefresh: @escaping @MainActor () -> Void = {}
    ) {
        let content = RoutePlaybackContent(
            autoPlay: autoPlay,
            showsLayerSwitcher: showsLayerSwitcher,
            showsControls: showsControls,
            height: height,
            initialMapStyle: initialMapStyle,
            trailColorHex: trailColorHex,
            markerColorHex: markerColorHex,
            ariaLabelOverride: accessibilityLabel,
            emptyMessageOverride: emptyMessage
        )
        let source = LiveRoutePlaybackSource(
            input: RoutePlaybackInput(connection: .live, phase: .loaded, rows: points),
            onRefresh: onRefresh
        )
        self.init(model: RoutePlaybackModel(content: content, source: source, onPositionChange: onPositionChange))
    }
}
