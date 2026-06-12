//
//  MapTileLayer.Surface.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The map base-layer surface — the SwiftUI parity of `components/maps/MapTileLayer.tsx`. Composes the
//  MapKit tile overlay (web leaflet `TileLayer`) with the attribution control, the corner fullscreen
//  toggle (web `MapFullscreenControl`), the base-map style switcher (web `MapLayerSwitcher`), the P4
//  leaf connectivity chip + banner, and the loading / empty / error overlays — every state renders
//  over the map, never a blank box. Bound through `MapTileLayerModel` (P1/S8); no networking lives
//  here. The model emits `view.opened` (P1/S11) on first appear and auto-refreshes once on the stale
//  edge.
//
//  Every state renders — no hidden surface:
//    • loading — config query in flight, no cached tiles → centred loading overlay over the map.
//    • empty   — no resolvable tile source (defensive) → friendly "Map unavailable" overlay.
//    • error   — config query failed → inline error card + Retry, over the free-fallback tiles.
//    • ready   — the resolved provider/style tiles fill the map.
//    • stale/offline — the orthogonal connectivity axis → freshness chip + banner with a one-shot
//                      auto-refresh on the stale edge.
//

import SwiftUI

// MARK: - MapTileLayer (the reusable shared surface)

/// The reusable map base-layer surface. Renders every state from the web source plus the P4 leaf
/// states, binding through `MapTileLayerModel`.
public struct MapTileLayer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        MapTileLayerMeta.surfaceSlug
    }

    @State private var model: MapTileLayerModel
    @State private var expanded = false

    private let height: CGFloat

    public init(model: MapTileLayerModel, height: CGFloat = 320) {
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
    private func mapCard(resolved: MapTileLayerResolved, showsFullscreenControl: Bool) -> some View {
        MapTileLayerMapRepresentable(
            urlTemplate: resolved.tileDef.url,
            canTile: resolved.canTile,
            accessibilityLabel: mapLabel(resolved)
        )
        .overlay(alignment: .top) { bannerLayer(resolved: resolved) }
        .overlay(alignment: model.content.corner.alignment) {
            controlsLayer(resolved: resolved, showsFullscreenControl: showsFullscreenControl)
        }
        .overlay(alignment: .bottom) { infoBar(resolved: resolved) }
        .overlay { stateLayer(resolved: resolved) }
    }

    @ViewBuilder
    private func bannerLayer(resolved: MapTileLayerResolved) -> some View {
        if !resolved.isLive {
            MapTileLayerConnectivityBanner(connection: resolved.connection)
                .padding(TSSpacing.sm)
        }
    }

    private func controlsLayer(resolved: MapTileLayerResolved, showsFullscreenControl: Bool) -> some View {
        VStack(spacing: TSSpacing.xs) {
            MapTileLayerStyleSwitcher(style: resolved.style) { model.setStyle($0) }
            if showsFullscreenControl, model.content.fullscreenEnabled {
                MapTileLayerFullscreenButton(
                    expanded: $expanded,
                    enterLabel: fullscreenLabel(
                        model.content.ariaLabelEnterKey,
                        key: "common.fullscreen.enter",
                        fallback: "Enter fullscreen"
                    ),
                    exitLabel: fullscreenLabel(
                        model.content.ariaLabelExitKey,
                        key: "common.fullscreen.exit",
                        fallback: "Exit fullscreen"
                    )
                )
            }
        }
        .padding(TSSpacing.sm)
    }

    private func infoBar(resolved: MapTileLayerResolved) -> some View {
        HStack(alignment: .bottom) {
            MapTileLayerAttributionChip(attribution: resolved.attribution)
            Spacer(minLength: TSSpacing.sm)
            MapTileLayerConnectivityChip(connection: resolved.connection) { model.refresh() }
        }
        .padding(TSSpacing.sm)
    }

    @ViewBuilder
    private func stateLayer(resolved: MapTileLayerResolved) -> some View {
        switch resolved.status {
        case .loading:
            MapTileLayerLoadingOverlay()
        case .empty:
            MapTileLayerEmptyOverlay()
        case .error:
            MapTileLayerErrorOverlay { model.refresh() }
        case .ready:
            EmptyView()
        }
    }

    // MARK: Fullscreen (web Fullscreen API)

    private func fullscreenSheet(resolved: MapTileLayerResolved) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                Text(verbatim: MapTileLayerStrings.string("mapTileLayer.fullscreenTitle", "Map"))
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button {
                    expanded = false
                } label: {
                    Text(verbatim: MapTileLayerStrings.string("common.fullscreen.exit", "Exit fullscreen"))
                        .font(Font.TS.label)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: MapTileLayerStrings.string(
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

    /// The map's accessible name — style + effective provider, freshness-suffixed off-live.
    private func mapLabel(_ resolved: MapTileLayerResolved) -> String {
        let base = MapTileLayerStrings.string("mapTileLayer.mapA11y", "Map")
        let styleName = MapTileLayerStrings.string(resolved.style.labelKey, resolved.style.labelFallback)
        let providerName = MapTileLayerStrings.string(resolved.provider.labelKey, resolved.provider.labelFallback)
        var label = "\(base) — \(styleName), \(providerName)"
        if !resolved.isLive {
            label += ". " + MapTileLayerFreshness.note(for: resolved.connection)
        }
        return label
    }

    /// Resolves a fullscreen label from an optional override key, falling back to the web default key.
    private func fullscreenLabel(_ overrideKey: String?, key: String, fallback: String) -> String {
        MapTileLayerStrings.string(overrideKey ?? key, fallback)
    }
}

// MARK: - Convenience initialiser

public extension MapTileLayer {
    /// Mounts the surface directly over a content config + a config snapshot, building the
    /// source-backed model — the parity of `<MapTileLayer style=… />` at a call site. `onRefresh`
    /// wires the web `useQuery` refetch.
    init(
        style: MapTileLayerStyle = .dark,
        corner: MapTileLayerCorner = .topright,
        fullscreenEnabled: Bool = true,
        height: CGFloat = 320,
        input: MapTileLayerInput = MapTileLayerInput(),
        onRefresh: @escaping @MainActor () -> Void = {}
    ) {
        let content = MapTileLayerContent(
            style: style,
            corner: corner,
            fullscreenEnabled: fullscreenEnabled
        )
        let source = LiveMapTileLayerSource(input: input, onRefresh: onRefresh)
        self.init(model: MapTileLayerModel(content: content, source: source), height: height)
    }
}
