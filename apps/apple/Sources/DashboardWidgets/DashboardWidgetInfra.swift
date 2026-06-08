//
//  DashboardWidgetInfra.swift
//  TeslaSync — shared dashboard-widget grid infrastructure (Apple)
//
//  Canonical home for the value types every dashboard widget surface shares:
//  the grid `DashboardWidgetSize` and the `DashboardWidgetRegistration`
//  metadata (id / catalog keys / category / size envelope). These were
//  previously redefined inside each generated widget's `*.Model.swift`, which
//  collided in the single app module. They live here once so every surface
//  links the same type.
//

import Foundation

/// A widget's grid footprint, in dashboard columns × rows (mirrors the web
/// registry's `{ cols, rows }` size tuples).
public struct DashboardWidgetSize: Equatable, Sendable {
    public let cols: Int
    public let rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// The native counterpart of a web dashboard-widget registry entry: a stable
/// `id`, the catalog `nameKey` / `descriptionKey`, the `category` slug, and the
/// `default…min…max` grid-size envelope the dashboard grid honors.
public struct DashboardWidgetRegistration: Sendable {
    public let id: String
    public let nameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    public init(
        id: String,
        nameKey: String,
        descriptionKey: String,
        category: String,
        defaultSize: DashboardWidgetSize,
        minSize: DashboardWidgetSize,
        maxSize: DashboardWidgetSize
    ) {
        self.id = id
        self.nameKey = nameKey
        self.descriptionKey = descriptionKey
        self.category = category
        self.defaultSize = defaultSize
        self.minSize = minSize
        self.maxSize = maxSize
    }

    /// Clamps a requested grid size into the surface's `min…max` envelope, so the
    /// native grid honors the same constraints as the web registry.
    public func clamp(_ size: DashboardWidgetSize) -> DashboardWidgetSize {
        DashboardWidgetSize(
            cols: min(max(size.cols, minSize.cols), maxSize.cols),
            rows: min(max(size.rows, minSize.rows), maxSize.rows)
        )
    }
}
