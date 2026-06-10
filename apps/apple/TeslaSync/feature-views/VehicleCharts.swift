//
//  VehicleCharts.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The vehicle-charts feature view — the SwiftUI parity of the web
//  features/vehicles/components/VehicleCharts.tsx. Switches over the model's render
//  phase (loading skeleton / loaded composite / friendly empty / hard error) and
//  layers the native freshness chrome when the live feed is stale or offline. The
//  loaded composite reproduces the web sections — the live map (web first
//  GlassPanel), Vehicle Configuration, Car Display Preferences, and the always-on
//  Speed History chart — in a responsive one/two-column grid (web `grid-cols-1
//  lg:grid-cols-2`). Binds through `VehicleChartsModel` (P1/S8); no networking here.
//

import SwiftUI

/// The vehicle-charts surface. Renders every state from the web source plus the
/// native stale/offline chrome, and always shows a surface (never a blank box).
public struct VehicleCharts: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleChartsSurface.slug

    @State private var model: VehicleChartsModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over a `VehicleChartsSource`).
    public init(model: VehicleChartsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.phase)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VehicleChartsSkeleton(localize: model.localize)
        case let .error(message):
            VehicleChartsErrorView(message: message, localize: model.localize) { model.refresh() }
        case .empty:
            VehicleChartsEmptyState(localize: model.localize)
        case .loaded:
            loadedComposite
        }
    }

    // MARK: Loaded composite (web `grid grid-cols-1 lg:grid-cols-2`)

    private var loadedComposite: some View {
        VStack(spacing: TSSpacing.lg) {
            if !model.connection.isLive {
                VehicleChartsFreshnessChip(
                    connection: model.connection,
                    localize: model.localize
                ) { model.refresh() }
            }
            VehicleChartsResponsiveGrid {
                sections
            }
        }
    }

    /// The composite's sections, in web order: live map (when located), Vehicle
    /// Configuration (when present), Car Display Preferences (when present), and
    /// the always-rendered Speed History chart.
    @ViewBuilder
    private var sections: some View {
        if model.projection.hasMap {
            VehicleChartsMapSection(
                projection: model.projection,
                formatting: model.formatting,
                localize: model.localize
            )
        }
        if let config = model.projection.config {
            VehicleChartsConfigSection(config: config, localize: model.localize)
        }
        if let preferences = model.projection.preferences {
            VehicleChartsPreferencesSection(preferences: preferences, localize: model.localize)
        }
        VehicleChartsSpeedSection(
            samples: model.projection.speedSeries,
            units: model.units,
            formatting: model.formatting,
            localize: model.localize
        )
    }
}

// MARK: - Responsive grid (web `grid-cols-1 lg:grid-cols-2`)

/// Lays its sections into one column on a compact width and two columns on a
/// regular/wide width — the native parity of the web `grid-cols-1 lg:grid-cols-2`.
/// Uses the horizontal size class so iPhone portrait stacks and iPad/macOS pair up.
struct VehicleChartsResponsiveGrid<Content: View>: View {
    @ViewBuilder var content: Content

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isWide: Bool {
            horizontalSizeClass == .regular
        }
    #else
        private let isWide = true
    #endif

    private var columns: [GridItem] {
        isWide
            ? [
                GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
                GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top)
            ]
            : [GridItem(.flexible(), alignment: .top)]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            content
        }
    }
}
