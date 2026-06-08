import SwiftUI

// MARK: - Dashboard-widget tier primitives

//
// First surface of the P4 dashboard-widget tier (composable, user-draggable
// dashboard panels). These small registry/telemetry primitives are the native
// analogue of the web `WidgetSize` / `WidgetDef` / dashboard registry
// (web/src/features/dashboard/widgets/types.ts + registry/*). They live here
// with the first widget; later widgets reuse them unchanged.

/// A widget's grid footprint in dashboard columns × rows (web `WidgetSize`).
public struct DashboardWidgetSize: Equatable, Sendable {
    public let cols: Int
    public let rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// Runtime inputs a dashboard host hands a widget surface (web `WidgetProps`).
public struct DashboardWidgetProps: Equatable, Sendable {
    /// The vehicle to scope the widget to, or `nil` to fall back to the first.
    public let vehicleID: Int64?
    /// The widget's current grid footprint (drives responsive layout).
    public let size: DashboardWidgetSize

    public init(vehicleID: Int64? = nil, size: DashboardWidgetSize) {
        self.vehicleID = vehicleID
        self.size = size
    }
}

/// The widget catalog category (web `WidgetCategory`).
public enum DashboardWidgetCategory: String, Sendable {
    case vehicle, battery, energy, driving, charging, climate, tires, security
    case commands, media, telemetry, analytics, alerts, automations, system, maps
}

/// Static registry metadata for one widget surface (web `WidgetDef`). The
/// dashboard grid system enumerates these to place + constrain widgets.
public struct DashboardWidgetDescriptor: Equatable, Sendable {
    public let id: String
    /// The catalog key for the widget's display name (resolved at the render
    /// boundary). Stored as a `String` so the descriptor stays `Sendable`.
    public let titleKey: String
    public let category: DashboardWidgetCategory
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    /// The localized display title for the widget catalog.
    public var title: LocalizedStringKey {
        LocalizedStringKey(stringLiteral: titleKey)
    }

    public init(
        id: String,
        titleKey: String,
        category: DashboardWidgetCategory,
        defaultSize: DashboardWidgetSize,
        minSize: DashboardWidgetSize,
        maxSize: DashboardWidgetSize
    ) {
        self.id = id
        self.titleKey = titleKey
        self.category = category
        self.defaultSize = defaultSize
        self.minSize = minSize
        self.maxSize = maxSize
    }
}

/// A surface that can register itself with the dashboard grid system.
public protocol DashboardWidgetSurface {
    /// The canonical registry metadata (id + size constraints) for this surface.
    static var descriptor: DashboardWidgetDescriptor { get }
    /// The stable diagnostics slug emitted with the `view.opened` event.
    static var surfaceSlug: String { get }
}

// MARK: - Diagnostics (P1/S11)

/// A product-analytics event a widget surface emits (P1/S11 diagnostics
/// contract). At the app's diagnostics boundary this maps onto the typed
/// ADR-016 taxonomy (`TelemetryEvent.ScreenView`); the PII-free `name`/`surface`
/// pair is all a feature surface is allowed to construct.
public struct DashboardWidgetTelemetryEvent: Equatable, Sendable {
    public let name: String
    public let surface: String

    public init(name: String, surface: String) {
        self.name = name
        self.surface = surface
    }

    /// A surface becoming visible (`view.opened`).
    public static func viewOpened(surface: String) -> DashboardWidgetTelemetryEvent {
        DashboardWidgetTelemetryEvent(name: "view.opened", surface: surface)
    }
}

/// Sink a dashboard host injects to receive widget telemetry. Main-actor
/// isolated because surfaces emit from the SwiftUI render boundary.
@MainActor
public protocol DashboardWidgetTelemetrySink: AnyObject {
    func record(_ event: DashboardWidgetTelemetryEvent)
}

/// In-memory telemetry sink for hosts and tests (records what a surface emits).
@MainActor
public final class BufferedDashboardWidgetTelemetry: DashboardWidgetTelemetrySink {
    public private(set) var events: [DashboardWidgetTelemetryEvent] = []

    public init() {}

    public func record(_ event: DashboardWidgetTelemetryEvent) {
        events.append(event)
    }
}
