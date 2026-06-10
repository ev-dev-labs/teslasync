//
//  RecentDrivesSection.Adapter.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  The testable projection core for the recent-drives section — the faithful port of
//  features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx. The web source is a
//  presentational `GlassPanel` wrapping a four-column `DataTable` (Date / Distance / Duration /
//  Battery) over the parent's `drives` prop, with a "View all" link and an `EmptyState` when
//  the list is empty. Everything here is pure and dependency-free (Foundation only) so the
//  projection — phase resolution, the sortable-distance ordering, the client pagination, and
//  the per-row cell strings — can be unit-tested without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • The web renders `drives && drives.length > 0 ? <DataTable> : <EmptyState>`. `resolvePhase`
//      widens that into the prompt-required loading / empty / error envelopes (driven by the
//      bound source's load status) so no state is ever a blank panel.
//    • Only the Distance column is `sortable` in the web `DataTable`; the native sort orders by
//      the SI `distanceMeters` (the meaningful key behind the rendered value).
//    • The web `DataTable` paginates with its default page size of 25; the native projection
//      reproduces that client-side slice.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free
/// core so the projection's unit tests can reach it.
public enum RecentDrivesSurface {
    public static let slug = "RecentDrivesSection"

    /// The web `DataTable` default page size (`defaultPageSize ?? 25`).
    public static let pageSize = 25
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the drives query (web parent `isLoading` / resolved /
/// failure). The web component receives `drives` as a prop; the native surface models the
/// parent query lifecycle here so every state renders.
public enum RecentDrivesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a
/// cached list is clearly labeled while reconnecting / offline.
public enum RecentDrivesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render at the top level. The web splits only
/// populated-table / empty; the loading + error envelopes are added so the first-load and
/// fetch-failure cases never render a blank panel.
public enum RecentDrivesPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Sort state (web `DataTable` sortable Distance column)

/// The Distance column sort, the only sortable column in the web `DataTable`. `toggled()`
/// mirrors the web `onSort`: the first activation sorts ascending, each subsequent one flips
/// the direction (it never returns to unsorted).
public enum RecentDrivesSort: Sendable, Equatable {
    case unsorted
    case distanceAscending
    case distanceDescending

    /// Advances the sort the way tapping the Distance header does in the web table.
    public func toggled() -> RecentDrivesSort {
        switch self {
        case .unsorted, .distanceDescending: .distanceAscending
        case .distanceAscending: .distanceDescending
        }
    }

    /// Whether the Distance column is currently the sort key (web `sortKey === col.key`).
    public var isActive: Bool {
        self != .unsorted
    }
}

// MARK: - Display-ready drive row (web `Drive`)

/// One drive row — the native parity of the web `Drive` fields the four columns read
/// (`id`, `start_ts`, `distance_m`, `duration_s`, `start_soc_pct`, `end_soc_pct`). Distance is
/// SI meters and duration SI seconds (converted/split at projection time); the SOC pair is an
/// optional percent. Only the fields the table renders are modeled.
public struct RecentDriveItem: Sendable, Equatable, Identifiable {
    public let id: Int64
    /// `drive.start_ts` — the Date column source (web `formatDateTime(start_ts)`).
    public let startTimestamp: Date
    /// `drive.distance_m` — meters (SI). Converted to the display unit by the projection.
    public let distanceMeters: Double
    /// `drive.duration_s` — seconds (SI). Split into `Xh Ym` by the projection.
    public let durationSeconds: Double
    /// `drive.start_soc_pct` — percent; `nil` collapses the Battery cell to the em dash.
    public let startBatteryPercent: Double?
    /// `drive.end_soc_pct` — percent; `nil` collapses the Battery cell to the em dash.
    public let endBatteryPercent: Double?

    public init(
        id: Int64,
        startTimestamp: Date,
        distanceMeters: Double,
        durationSeconds: Double,
        startBatteryPercent: Double?,
        endBatteryPercent: Double?
    ) {
        self.id = id
        self.startTimestamp = startTimestamp
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.startBatteryPercent = startBatteryPercent
        self.endBatteryPercent = endBatteryPercent
    }
}

/// The user's display preferences for this surface (web `useUnits().unitPrefs`). Stores the SI
/// distance label the shared enums round-trip through (`"km"` / `"mi"` / `"ft"`), the decimal
/// precision (web global precision, default 2), and the BCP-47 locale for grouped formatting.
public struct RecentDrivesFormatting: Sendable, Equatable {
    public var distanceUnit: String
    public var precision: Int
    public var locale: String?

    public init(distanceUnit: String = "km", precision: Int = 2, locale: String? = nil) {
        self.distanceUnit = distanceUnit
        self.precision = precision
        self.locale = locale
    }
}

/// The four pre-formatted cell strings one row renders (web `DataTable` column `render`s),
/// rendered verbatim so interpolated values are never re-localized.
public struct RecentDriveDisplay: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let date: String
    public let distance: String
    public let duration: String
    public let battery: String

    public init(id: Int64, date: String, distance: String, duration: String, battery: String) {
        self.id = id
        self.date = date
        self.distance = distance
        self.duration = duration
        self.battery = battery
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: phase resolution, the
/// sortable-distance ordering, the client pagination slice, and the per-row cell strings.
public enum RecentDrivesProjection {
    /// The em dash the Battery cell collapses to when either SOC bound is missing (web
    /// `start_soc_pct != null && end_soc_pct != null ? … : '—'`).
    public static let emDash = "—"

    /// Resolves the render phase. Loading shows only before the first rows arrive; a resolved
    /// empty list shows the empty state; a failure with no cached rows shows the error state —
    /// while cached rows survive a refresh / failure (freshness shown by the chip/banner, the
    /// failure surfaced inline by the content branch).
    public static func resolvePhase(status: RecentDrivesLoadStatus, rowCount: Int) -> RecentDrivesPhase {
        let hasRows = rowCount > 0
        switch status {
        case .loading:
            return hasRows ? .content : .loading
        case .loaded:
            return hasRows ? .content : .empty
        case let .failed(message):
            return hasRows ? .content : .error(message)
        }
    }

    /// Orders the rows for the current sort. `unsorted` preserves the upstream order (web
    /// most-recent-first); the distance sort orders by the SI `distanceMeters` and is stable
    /// for equal distances (ties keep their upstream order).
    public static func sorted(_ items: [RecentDriveItem], by sort: RecentDrivesSort) -> [RecentDriveItem] {
        switch sort {
        case .unsorted:
            items
        case .distanceAscending:
            stableSorted(items) { $0.distanceMeters < $1.distanceMeters }
        case .distanceDescending:
            stableSorted(items) { $0.distanceMeters > $1.distanceMeters }
        }
    }

    /// The number of pages for `total` rows at `pageSize` (≥ 1 so the bar math never divides by
    /// zero, web `Math.ceil(total / pageSize)`).
    public static func pageCount(total: Int, pageSize: Int = RecentDrivesSurface.pageSize) -> Int {
        guard pageSize > 0, total > 0 else { return 1 }
        return (total + pageSize - 1) / pageSize
    }

    /// Clamps a one-based page index into `1...pageCount` so a sort/refresh that shrinks the
    /// list can't strand the view on an empty page.
    public static func clampPage(_ page: Int, total: Int, pageSize: Int = RecentDrivesSurface.pageSize) -> Int {
        min(max(page, 1), pageCount(total: total, pageSize: pageSize))
    }

    /// The rows on a one-based page (web `data.slice((page - 1) * pageSize, page * pageSize)`).
    public static func page(
        _ items: [RecentDriveItem],
        page: Int,
        pageSize: Int = RecentDrivesSurface.pageSize
    ) -> [RecentDriveItem] {
        guard pageSize > 0 else { return items }
        let clamped = clampPage(page, total: items.count, pageSize: pageSize)
        let start = (clamped - 1) * pageSize
        guard start < items.count else { return [] }
        let end = min(start + pageSize, items.count)
        return Array(items[start ..< end])
    }

    /// Builds one row's four cell strings. Distance/duration/battery are pure; the Date cell is
    /// resolved through the injected `formatDate` closure (the date-formatting facade) so the
    /// projection stays bundle-free and testable.
    public static func display(
        for item: RecentDriveItem,
        formatting: RecentDrivesFormatting,
        formatDate: (Date) -> String
    ) -> RecentDriveDisplay {
        RecentDriveDisplay(
            id: item.id,
            date: formatDate(item.startTimestamp),
            distance: RecentDrivesUnitMath.distanceText(
                meters: item.distanceMeters,
                unit: formatting.distanceUnit,
                precision: formatting.precision,
                locale: localeOrDefault(formatting.locale)
            ),
            duration: RecentDrivesUnitMath.durationText(seconds: item.durationSeconds),
            battery: RecentDrivesUnitMath.batteryText(
                start: item.startBatteryPercent,
                end: item.endBatteryPercent,
                empty: emDash
            )
        )
    }

    // MARK: Helpers

    /// A stable sort: decorate with the original index, sort, and break ties by that index so
    /// equal distances retain their upstream order (Swift's `sort` is not guaranteed stable).
    private static func stableSorted(
        _ items: [RecentDriveItem],
        by areInIncreasingOrder: (RecentDriveItem, RecentDriveItem) -> Bool
    ) -> [RecentDriveItem] {
        items.enumerated()
            .sorted { lhs, rhs in
                if areInIncreasingOrder(lhs.element, rhs.element) { return true }
                if areInIncreasingOrder(rhs.element, lhs.element) { return false }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }

    private static func localeOrDefault(_ identifier: String?) -> Locale {
        guard let identifier, !identifier.isEmpty else { return Locale(identifier: "en-US") }
        return Locale(identifier: identifier)
    }
}
