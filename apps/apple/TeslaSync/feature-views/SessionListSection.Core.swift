//
//  SessionListSection.Core.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  Pure, dependency-free support types split out of SessionListSection.Adapter.swift
//  to keep each file within the lint length budget: client-side pagination
//  (web `Pagination`), the export request builder (web `/api/v1/export/charging`
//  download links), the numeric guard, and the diagnostics surface slug. Foundation
//  only, so it stays unit-testable without a rendered view.
//

import Foundation

// MARK: - Pagination (web `Pagination`)

/// A 1-based page window over the filtered items. Client-side here because the
/// native surface receives the full filtered list from its source (the web parent
/// paginated server-side); the math is pure + tested.
public struct SessionPage: Sendable, Equatable {
    public var page: Int
    public var pageSize: Int
    public var total: Int

    public init(page: Int, pageSize: Int, total: Int) {
        self.page = page
        self.pageSize = pageSize
        self.total = total
    }

    /// The number of pages (≥ 1), so the pager never shows "Page 1 of 0".
    public var pageCount: Int {
        guard pageSize > 0 else { return 1 }
        return max(1, Int((Double(total) / Double(pageSize)).rounded(.up)))
    }

    /// The current page clamped into `1...pageCount`.
    public var clampedPage: Int {
        min(max(1, page), pageCount)
    }

    /// The zero-based half-open slice bounds for the current page.
    public var range: Range<Int> {
        guard total > 0, pageSize > 0 else { return 0 ..< 0 }
        let lower = (clampedPage - 1) * pageSize
        let upper = min(lower + pageSize, total)
        return lower ..< max(lower, upper)
    }

    public var hasPrevious: Bool {
        clampedPage > 1
    }

    public var hasNext: Bool {
        clampedPage < pageCount
    }
}

/// Slices an array to a page window without ever crashing on out-of-range bounds.
public enum SessionPaginator {
    public static func slice(_ items: [SessionListItem], page: Int, pageSize: Int) -> [SessionListItem] {
        let window = SessionPage(page: page, pageSize: pageSize, total: items.count)
        guard page >= 1, page <= window.pageCount else { return [] }
        let range = window.range
        guard range.lowerBound < items.count, !range.isEmpty else { return [] }
        return Array(items[range])
    }
}

// MARK: - Export (web `/api/v1/export/charging?…` download link)

/// The export format offered by the two download buttons (web CSV / JSON links).
public enum SessionListExportFormat: String, Sendable, CaseIterable, Identifiable {
    case csv
    case json

    public var id: String {
        rawValue
    }

    public var localizationKey: String {
        switch self {
        case .csv: "charging.sessions.exportCsv"
        case .json: "charging.sessions.exportJson"
        }
    }

    public var fallback: String {
        switch self {
        case .csv: "CSV"
        case .json: "JSON"
        }
    }

    /// The suggested download filename (web `download="teslasync-charging.csv"`).
    public var fileName: String {
        "teslasync-charging.\(rawValue)"
    }
}

/// The date-range + vehicle scope the export inherits from the page filters
/// (web `startDate` / `endDate` / `vehicleId`).
public struct SessionExportContext: Sendable, Equatable {
    public var startDate: String
    public var endDate: String
    public var vehicleID: Int?

    public init(startDate: String = "", endDate: String = "", vehicleID: Int? = nil) {
        self.startDate = startDate
        self.endDate = endDate
        self.vehicleID = vehicleID
    }
}

/// Builds the export request path. A byte-for-byte port of the web template
/// `/api/v1/export/charging?format=…&start=…&end=…&vehicle_id=…`, appending each
/// optional only when truthy (matching the web `${x ? … : ''}`), so the production
/// app can hand it to its authenticated download/share flow.
public enum SessionListExport {
    public static func path(format: SessionListExportFormat, context: SessionExportContext) -> String {
        var query = "format=\(format.rawValue)"
        if !context.startDate.isEmpty { query += "&start=\(context.startDate)" }
        if !context.endDate.isEmpty { query += "&end=\(context.endDate)" }
        if let vehicleID = context.vehicleID, vehicleID != 0 { query += "&vehicle_id=\(vehicleID)" }
        return "/api/v1/export/charging?\(query)"
    }
}

// MARK: - Numeric guard

/// Replaces non-finite values with 0 so formatting never emits "NaN" (the parity of
/// the web `safeNumber`).
public enum SessionListNumeric {
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the
/// dependency-free core so the projection's unit tests can reach it.
public enum SessionListSurface {
    public static let slug = "SessionListSection"
}
