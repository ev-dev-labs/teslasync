import Shared
import SwiftUI

// Native parity port of the web dashboard widget
// `web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx`.
//
// This file owns the dashboard-host entry point plus the small surface
// primitives it needs: the grid-footprint size, the registry descriptor, and the
// `view.opened` diagnostics seam. The display logic lives in
// `BatteryGaugeProjection`, the views in `BatteryRadialGaugeContent`, and the
// shared-core binding in `BatteryRadialGaugeModel`.

// MARK: - Surface size & registry metadata

/// Grid footprint of a dashboard-widget instance — the native analogue of the
/// web `WidgetProps.size` (`{ cols, rows }`). Units are grid cells, not points.
public struct TSDashboardWidgetSize: Equatable, Sendable {
    public let cols: Int
    public let rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }

    /// 1×1 tiles render the dense, label-less variant (web `isCompact`).
    public var isCompact: Bool {
        cols == 1 && rows == 1
    }

    /// ≥2×2 tiles render the expanded variant with the stat row (web `isLarge`).
    public var isExpanded: Bool {
        cols >= 2 && rows >= 2
    }
}

/// Static registry descriptor mirroring
/// `web/src/features/dashboard/widgets/registry/battery.ts`. The dashboard grid
/// host registers each surface under [id] and clamps user resizes to
/// [minSize]…[maxSize] (web react-grid-layout `minW/minH/maxW/maxH`).
public struct TSDashboardWidgetMetadata: Equatable, Sendable {
    public let id: String
    public let category: String
    public let defaultSize: TSDashboardWidgetSize
    public let minSize: TSDashboardWidgetSize
    public let maxSize: TSDashboardWidgetSize

    public init(
        id: String,
        category: String,
        defaultSize: TSDashboardWidgetSize,
        minSize: TSDashboardWidgetSize,
        maxSize: TSDashboardWidgetSize
    ) {
        self.id = id
        self.category = category
        self.defaultSize = defaultSize
        self.minSize = minSize
        self.maxSize = maxSize
    }

    /// Clamps a requested footprint to the registered min/max (inclusive), so the
    /// grid host honors the same constraints as the web registry.
    public func clamp(_ size: TSDashboardWidgetSize) -> TSDashboardWidgetSize {
        TSDashboardWidgetSize(
            cols: min(max(size.cols, minSize.cols), maxSize.cols),
            rows: min(max(size.rows, minSize.rows), maxSize.rows)
        )
    }
}

// MARK: - Diagnostics seam (P1/S11)

/// Minimal product-analytics seam for dashboard surfaces (P1/S11 diagnostics
/// contract). The widget reports a `view.opened` when it first appears.
/// Production wiring forwards to the shared `Diagnostics.telemetry` once
/// `AppContainer` exposes it; tests inject a spy; the default is an inert no-op
/// so the surface never hard-depends on diagnostics being connected.
@MainActor
public protocol DashboardWidgetTelemetry: AnyObject {
    /// Records that [surface] became visible (event name `view.opened`).
    func viewOpened(surface: String)
}

/// Inert default used in production until diagnostics is wired, and in previews.
@MainActor
public final class NoopDashboardWidgetTelemetry: DashboardWidgetTelemetry {
    public init() {}
    public func viewOpened(surface _: String) {}
}

// MARK: - Dashboard entry point

/// Native `BatteryRadialGaugeWidget` — the dashboard-host entry point. Owns the
/// `BatteryRadialGaugeModel`, drives its visibility lifecycle, and renders the
/// pure `BatteryRadialGaugeContent`. Register it with `metadata` so the grid
/// honors the same id and size constraints as the web registry.
public struct BatteryRadialGaugeWidget: View {
    /// Stable registry id + size constraints (web `registry/battery.ts`).
    public static let metadata = TSDashboardWidgetMetadata(
        id: "battery-radial-gauge",
        category: "battery",
        defaultSize: TSDashboardWidgetSize(cols: 1, rows: 2),
        minSize: TSDashboardWidgetSize(cols: 1, rows: 2),
        maxSize: TSDashboardWidgetSize(cols: 3, rows: 40)
    )

    /// Telemetry surface slug for the `view.opened` diagnostic (P1/S11).
    public static let surfaceSlug = "BatteryRadialGaugeWidget"

    /// Emits the `view.opened` diagnostic for this surface (P1/S11). Factored out
    /// so the emission path + slug are exercised in isolation by the unit tests.
    @MainActor
    public static func reportOpen(to telemetry: DashboardWidgetTelemetry) {
        telemetry.viewOpened(surface: surfaceSlug)
    }

    private let size: TSDashboardWidgetSize
    @State private var model: BatteryRadialGaugeModel

    public init(
        store: VehiclesStore,
        vehicleID: Int64? = nil,
        size: TSDashboardWidgetSize = BatteryRadialGaugeWidget.metadata.defaultSize,
        telemetry: DashboardWidgetTelemetry = NoopDashboardWidgetTelemetry()
    ) {
        self.size = size
        _model = State(
            initialValue: BatteryRadialGaugeModel(store: store, vehicleID: vehicleID, telemetry: telemetry)
        )
    }

    public var body: some View {
        BatteryRadialGaugeContent(
            renderState: model.renderState,
            size: size,
            onRefresh: { model.refresh() }
        )
        .onAppear { model.start() }
        .onChange(of: model.resolvedVehicleID) { _, id in
            model.bindState(to: id)
        }
        .onDisappear { model.stop() }
    }
}
