//
//  TripReplayMap.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  The trip-replay route map — the SwiftUI parity of
//  features/trips/components/TripReplayMap.tsx. A frosted, full-bleed map panel that
//  switches over the model's render phase (loading skeleton / friendly empty / hard
//  error / loaded map) and overlays the native freshness chrome plus the stationary-GPS
//  banner. The loaded map draws the speed-colored route (web `Polyline`s), the start /
//  end / stationary-anchor pins (web `CircleMarker`s), the heading-aware playhead that
//  tracks `currentIndex` (web `AnimatedMarker`), frames the camera to fit them (web
//  `FitBounds`), and routes a polyline-tap back to the page (web `onSeekToIndex`).
//  Binds through `TripReplayMapModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - Shared metrics

/// Layout metrics for the surface. `canvasHeight` mirrors the web `height = 450` prop
/// default so every state fills the same panel (never a collapsed box).
enum TripReplayMapMetrics {
    static let canvasHeight: CGFloat = 450
}

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension TripReplayMapStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TripReplayMap (the trip-replay route map)

/// The trip-replay route map. Renders every state from the web source plus the native
/// stale/offline chrome, and always shows a surface (never a blank box).
public struct TripReplayMap: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TripReplayMapSurface.slug

    @State private var model: TripReplayMapModel
    @State private var mapStyle: TSMapStyle = .standard
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    /// - Parameter model: the bound view-model (built over a `TripReplayMapSource`).
    public init(model: TripReplayMapModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity)
            .onAppear {
                model.start()
                model.autoRefreshIfStale()
            }
            .onDisappear { model.stop() }
            .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
            .animation(TSAnimation.standard(reduceMotion: effectiveReduceMotion), value: model.phase)
            .accessibilityElement(children: .contain)
    }

    /// The web `reduceMotion` prop OR the system Reduce Motion setting — either
    /// suppresses the playhead pulse + the camera/phase animation.
    private var effectiveReduceMotion: Bool {
        model.reduceMotion || systemReduceMotion
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            shell { TripReplaySkeleton() }
        case let .error(message):
            shell { TripReplayErrorView(message: message) { model.refresh() } }
        case .empty:
            shell { TripReplayEmptyView() }
        case .data:
            loadedMap
        }
    }

    // MARK: Non-map shell (web GlassPanel for the loading / empty / error bodies)

    private func shell(@ViewBuilder _ inner: () -> some View) -> some View {
        inner()
            .frame(maxWidth: .infinity)
            .frame(height: TripReplayMapMetrics.canvasHeight)
            .tsGlassPanel(cornerRadius: TSRadius.lg)
    }

    // MARK: Loaded map (web positions.length > 0 branch)

    private var loadedMap: some View {
        TripReplayMapCanvas(
            route: model.route,
            positions: model.positions,
            mapStyle: mapStyle,
            reduceMotion: effectiveReduceMotion,
            localize: model.localize,
            onSeek: { model.seek(to: $0) }
        )
        .frame(maxWidth: .infinity)
        .frame(height: TripReplayMapMetrics.canvasHeight)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .top) { topOverlays }
        .overlay(alignment: .bottom) {
            TripReplayLayerSwitcher(style: $mapStyle)
                .padding(TSSpacing.md)
        }
    }

    /// The stacked top overlays: the freshness chip (when fetching or not live) and the
    /// stationary-GPS banner (web `AlertBanner`, when there is no plottable route).
    private var topOverlays: some View {
        VStack(spacing: TSSpacing.sm) {
            if showsFreshnessChip {
                TripReplayFreshnessChip(
                    connection: model.connection,
                    isFetching: model.isFetching
                ) { model.refresh() }
            }
            if model.route.showStationaryBanner {
                TripReplayStationaryBanner()
            }
        }
        .padding(TSSpacing.md)
    }

    /// The chip appears only while fetching or when the bound source is stale/offline; a
    /// live, idle map is chrome-free.
    private var showsFreshnessChip: Bool {
        model.isFetching || !model.connection.isLive
    }
}

// MARK: - Layer switcher (web `MapLayerSwitcher`)

/// A compact map-style switcher (web `MapLayerSwitcher`) over the shared `TSMapStyle`,
/// with its labels resolved through this surface's P1/S10 table so the control needs no
/// shared catalog edit (the same surface-scoped pattern the sibling `RouteMapSection`
/// uses).
struct TripReplayLayerSwitcher: View {
    @Binding var style: TSMapStyle

    var body: some View {
        Picker(selection: $style) {
            ForEach(TSMapStyle.allCases) { option in
                Text(verbatim: label(for: option)).tag(option)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 260)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityLabel(TripReplayMapStrings.text("replay.map.styleLabel", "Map style"))
    }

    private func label(for style: TSMapStyle) -> String {
        switch style {
        case .standard: TripReplayMapStrings.string("replay.map.style.standard", "Standard")
        case .hybrid: TripReplayMapStrings.string("replay.map.style.hybrid", "Hybrid")
        case .imagery: TripReplayMapStrings.string("replay.map.style.satellite", "Satellite")
        }
    }
}
