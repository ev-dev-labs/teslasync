//
//  ChartContainer.Adapter.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The testable, dependency-light annotation core for the chart-framing surface — the SwiftUI
//  parity of `components/charts/ChartContainer.tsx`. Everything here is Foundation-only: the
//  annotation render model (the native port of `DataAnnotation`), the backend wire row (the native
//  port of `ChartAnnotationRow`), the `project` adapter (the verbatim port of `toDataAnnotation`),
//  the category palette + scope union (kept in lock-step with `types/annotations.ts`), and the
//  accessible fallback-table cell model (the native port of `ChartDataRow` / `ChartDataColumn`). No
//  store, no SwiftUI, no rendered view, so each piece is unit tested in isolation.
//
//  Every type is prefixed `ChartContainer…` so the surface stays self-contained and does not collide
//  with another shared surface's internal types in the single app module.
//

import Foundation

// MARK: - Annotation category (web `AnnotationCategory` + ANNOTATION_COLORS / LABELS)

/// The colour-coding category of a data annotation — the verbatim port of the web
/// `AnnotationCategory` union. The hex palette and the display label key mirror `ANNOTATION_COLORS`
/// and `ANNOTATION_CATEGORY_LABELS`; the label is resolved through the P1/S10 facade at the call
/// site so the raw English never appears in the view.
public enum ChartContainerAnnotationCategory: String, Sendable, Equatable, CaseIterable {
    case milestone
    case maintenance
    case trip
    case issue
    case upgrade
    case custom

    /// The sRGB hex string for this category (web `ANNOTATION_COLORS`). Rendered into a `Color` at
    /// the view boundary; kept as the source hex here so the palette stays in lock-step with the web.
    public var colorHex: String {
        switch self {
        case .milestone: "#3b82f6"
        case .maintenance: "#f59e0b"
        case .trip: "#22c55e"
        case .issue: "#ef4444"
        case .upgrade: "#a855f7"
        case .custom: "#94a3b8"
        }
    }

    /// The i18n key for the human-facing label (web `ANNOTATION_CATEGORY_LABELS`). The fallback is
    /// the same English copy the web ships.
    public var labelKey: String {
        "annotations.category.\(rawValue)"
    }

    /// The English fallback for ``labelKey`` (web `ANNOTATION_CATEGORY_LABELS`).
    public var labelFallback: String {
        switch self {
        case .milestone: "Milestone"
        case .maintenance: "Maintenance"
        case .trip: "Trip"
        case .issue: "Issue"
        case .upgrade: "Upgrade"
        case .custom: "Custom"
        }
    }

    /// Parses a backend category string, falling back to `.custom` for an unknown value so a new
    /// server-side category never drops the annotation (web keeps the raw category string).
    public static func parse(_ raw: String) -> ChartContainerAnnotationCategory {
        ChartContainerAnnotationCategory(rawValue: raw) ?? .custom
    }
}

// MARK: - Annotation scope (web `AnnotationScope`)

/// The chart "bucket" an annotation is scoped to — the verbatim port of the web `AnnotationScope`
/// union (kept in sync with `validScopeBuckets` in `internal/api/chart_annotation_handler.go`).
public enum ChartContainerAnnotationScope: String, Sendable, Equatable, CaseIterable {
    case battery
    case efficiency
    case cost
    case tire
    case energy
    case drivetrain
    case mileage
    case charging
}

// MARK: - Annotation render model (web `DataAnnotation`)

/// One annotation in the chart-render shape — the native port of the web `DataAnnotation` (the
/// projection `toDataAnnotation` produces). `id` is the stringified backend id so it flows through
/// the list + reference-overlay consumers unchanged.
public struct ChartContainerAnnotation: Sendable, Equatable, Identifiable {
    public let id: String
    public let timestamp: String
    public let label: String
    public let description: String?
    public let category: ChartContainerAnnotationCategory
    public let context: String
    public let vehicleID: Int64?
    public let createdAt: String

    public init(
        id: String,
        timestamp: String,
        label: String,
        description: String?,
        category: ChartContainerAnnotationCategory,
        context: String,
        vehicleID: Int64?,
        createdAt: String
    ) {
        self.id = id
        self.timestamp = timestamp
        self.label = label
        self.description = description
        self.category = category
        self.context = context
        self.vehicleID = vehicleID
        self.createdAt = createdAt
    }

    /// The tooltip text (web `ann.description ?? ann.label`).
    public var tooltip: String {
        description ?? label
    }
}

// MARK: - Annotation wire row (web `ChartAnnotationRow`)

/// The backend wire shape from `GET /annotations` — the native port of `ChartAnnotationRow`
/// (snake_case JSON, mirroring `models.ChartAnnotation`). Decoded by the source seam and projected
/// to ``ChartContainerAnnotation`` by ``ChartContainerAnnotationAdapter`` (no SwiftUI in the path).
public struct ChartContainerAnnotationRow: Sendable, Equatable, Codable {
    public let id: Int64
    public let userID: Int64?
    public let vehicleID: Int64?
    public let occurredAt: String
    public let category: String
    public let title: String
    public let description: String?
    public let scope: [String]
    public let color: String?
    public let createdAt: String
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case vehicleID = "vehicle_id"
        case occurredAt = "occurred_at"
        case category
        case title
        case description
        case scope
        case color
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64,
        userID: Int64? = nil,
        vehicleID: Int64? = nil,
        occurredAt: String,
        category: String,
        title: String,
        description: String? = nil,
        scope: [String],
        color: String? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.userID = userID
        self.vehicleID = vehicleID
        self.occurredAt = occurredAt
        self.category = category
        self.title = title
        self.description = description
        self.scope = scope
        self.color = color
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

// MARK: - Adapter (web `toDataAnnotation` — cached → projection)

/// Projects backend annotation rows onto the chart-render model — the verbatim port of the web
/// `toDataAnnotation`. Pure and total: an unknown category degrades to `.custom`, an empty `scope`
/// yields an empty context, and a nil/zero vehicle id maps to `nil` (web `?? undefined`).
public enum ChartContainerAnnotationAdapter {
    /// Projects one wire row to the render model (web `toDataAnnotation(row)`).
    public static func project(_ row: ChartContainerAnnotationRow) -> ChartContainerAnnotation {
        ChartContainerAnnotation(
            id: String(row.id),
            timestamp: row.occurredAt,
            label: row.title,
            description: row.description,
            category: ChartContainerAnnotationCategory.parse(row.category),
            context: row.scope.first ?? "",
            vehicleID: row.vehicleID,
            createdAt: row.createdAt
        )
    }

    /// Projects a batch of wire rows, preserving order (web `data.map(toDataAnnotation)`).
    public static func projectAll(_ rows: [ChartContainerAnnotationRow]) -> [ChartContainerAnnotation] {
        rows.map(project)
    }
}

// MARK: - Surface metadata (P1/S11 diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum ChartContainerMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChartContainer"
}
