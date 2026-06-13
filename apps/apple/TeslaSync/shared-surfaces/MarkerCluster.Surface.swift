//
//  MarkerCluster.Surface.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The marker-clustering surface — the SwiftUI parity of `components/maps/MarkerCluster.tsx`. Composes
//  the MapKit clustering layer (web leaflet cluster group) with the cluster-density legend (web
//  `defaultIconCreate` palette), the marker-count chip (web 5000 cap), the cluster colour-mode switcher
//  (web default palette vs `getClusterColor`), the selected-marker callout (web `popupHtml` /
//  `onMarkerClick`), the corner fullscreen toggle, the P4 leaf connectivity chip + banner, and the
//  loading / empty / error overlays — every state renders over the map, never a blank box. Bound
//  through `MarkerClusterModel` (P1/S8); no networking lives here. The model emits `view.opened`
//  (P1/S11) on first appear and auto-refreshes once on the stale edge.
//
//  Every state renders — no hidden surface:
//    • loading — feed in flight, no cached markers → centred loading overlay over the map.
//    • empty   — feed resolved with no renderable markers → friendly "No markers" overlay.
//    • error   — feed failed → inline error card + Retry, over any last-known markers.
//    • ready   — the clustered markers fill the map.
//    • stale/offline — the orthogonal connectivity axis → freshness chip + banner with a one-shot
//                      auto-refresh on the stale edge.
//

import SwiftUI

// MARK: - MarkerCluster (the reusable shared surface)

/// The reusable marker-clustering surface. Renders every state from the web source plus the P4 leaf
/// states, binding through `MarkerClusterModel`.
public struct MarkerCluster: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        MarkerClusterMeta.surfaceSlug
    }

    @State private var model: MarkerClusterModel
    @State private var expanded = false

    private let height: CGFloat

    public init(model: MarkerClusterModel, height: CGFloat = 360) {
        _model = State(initialValue: model)
        self.height = height
    }

    public var body: some View {
        let resolved = model.resolved
        mapCard(resolved: resolved, showsFullscreenControl: true)
            .frame(minHeight: height)
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .sheet(isPresented: $expanded) { fullscreenSheet(resolved: resolved) }
    }

    // MARK: Map + overlays

    /// The map plus its overlay chrome. `showsFullscreenControl` is suppressed inside the fullscreen
    /// sheet (which carries its own Exit affordance).
    private func mapCard(resolved: MarkerClusterResolved, showsFullscreenControl: Bool) -> some View {
        MarkerClusterMapRepresentable(
            model: model,
            resolved: resolved,
            selectedID: model.selectedPointID,
            accessibilityLabel: mapLabel(resolved)
        )
        .overlay(alignment: .top) { bannerLayer(resolved: resolved) }
        .overlay(alignment: .topTrailing) {
            controlsLayer(resolved: resolved, showsFullscreenControl: showsFullscreenControl)
        }
        .overlay(alignment: .bottom) { bottomLayer(resolved: resolved) }
        .overlay { stateLayer(resolved: resolved) }
    }

    @ViewBuilder
    private func bannerLayer(resolved: MarkerClusterResolved) -> some View {
        if !resolved.isLive {
            MarkerClusterConnectivityBanner(connection: resolved.connection)
                .padding(TSSpacing.sm)
        }
    }

    private func controlsLayer(resolved: MarkerClusterResolved, showsFullscreenControl: Bool) -> some View {
        VStack(spacing: TSSpacing.xs) {
            MarkerClusterColorModeSwitcher(colorMode: resolved.colorMode) { model.setColorMode($0) }
            if showsFullscreenControl, model.content.fullscreenEnabled {
                MarkerClusterFullscreenButton(expanded: $expanded)
            }
        }
        .padding(TSSpacing.sm)
    }

    private func bottomLayer(resolved: MarkerClusterResolved) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if let point = model.selectedPoint, resolved.canRender {
                MarkerClusterCallout(point: point) { model.clearSelection() }
            }
            HStack(alignment: .bottom) {
                MarkerClusterCountChip(resolved: resolved)
                Spacer(minLength: TSSpacing.sm)
                MarkerClusterConnectivityChip(connection: resolved.connection) { model.refresh() }
            }
            MarkerClusterLegend(colorMode: resolved.colorMode)
        }
        .padding(TSSpacing.sm)
    }

    @ViewBuilder
    private func stateLayer(resolved: MarkerClusterResolved) -> some View {
        switch resolved.status {
        case .loading:
            MarkerClusterLoadingOverlay()
        case .empty:
            MarkerClusterEmptyOverlay()
        case .error:
            MarkerClusterErrorOverlay { model.refresh() }
        case .ready:
            EmptyView()
        }
    }

    // MARK: Fullscreen

    private func fullscreenSheet(resolved: MarkerClusterResolved) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                Text(verbatim: MarkerClusterStrings.string("markerCluster.fullscreenTitle", "Map"))
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button {
                    expanded = false
                } label: {
                    Text(verbatim: MarkerClusterStrings.string("common.fullscreen.exit", "Exit fullscreen"))
                        .font(Font.TS.label)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string(
                    "common.fullscreen.exit",
                    "Exit fullscreen"
                )))
            }
            mapCard(resolved: resolved, showsFullscreenControl: false)
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.lg)
        .frame(minWidth: 320, minHeight: 320)
        .background(Color.TS.bg)
    }

    // MARK: Helpers

    /// The map's accessible summary — the rendered marker count, freshness-suffixed off-live.
    private func mapLabel(_ resolved: MarkerClusterResolved) -> String {
        let template = MarkerClusterStrings.string("markerCluster.mapA11y", "Map with %@ markers")
        var label = String(format: template, resolved.renderedCount.formatted())
        if !resolved.isLive {
            label += ". " + MarkerClusterFreshness.note(for: resolved.connection)
        }
        return label
    }
}

// MARK: - Fullscreen control

/// The corner fullscreen toggle — flips the surface's expanded binding; the surface presents the
/// enlarged map. The accessible label tracks the current state (web `aria-label` flip).
struct MarkerClusterFullscreenButton: View {
    @Binding var expanded: Bool

    var body: some View {
        Button {
            expanded.toggle()
        } label: {
            Image(systemName: expanded
                ? "arrow.down.right.and.arrow.up.left"
                : "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 28, height: 28)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: expanded
                ? MarkerClusterStrings.string("common.fullscreen.exit", "Exit fullscreen")
                : MarkerClusterStrings.string("common.fullscreen.enter", "Enter fullscreen")))
        .accessibilityAddTraits(expanded ? .isSelected : [])
    }
}

// MARK: - Convenience initialiser

public extension MarkerCluster {
    /// Mounts the surface directly over a point list + config, building the source-backed model — the
    /// parity of `<MarkerCluster points=… />` at a call site. `onRefresh` wires the web parent refetch.
    init(
        points: [MarkerClusterPoint],
        content: MarkerClusterContent = MarkerClusterContent(),
        connection: MarkerClusterConnection = .live,
        phase: MarkerClusterLoadPhase = .loaded,
        height: CGFloat = 360,
        onRefresh: @escaping @MainActor () -> Void = {}
    ) {
        let input = MarkerClusterInput(connection: connection, phase: phase, points: points)
        let source = LiveMarkerClusterSource(input: input, onRefresh: onRefresh)
        self.init(model: MarkerClusterModel(content: content, source: source), height: height)
    }
}
