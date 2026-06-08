//
//  MaintenanceTrackerWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  Domain value types ported from the web source + its API types
//  (features/dashboard/widgets/MaintenanceTrackerWidget.tsx,
//  types/vehicle-systems.ts): the cached maintenance / service-record DTO inputs,
//  the display-formatting context (units + locale), the urgency enum, and the
//  merged projection the view renders. No SwiftUI / transport here.
//

import Foundation

// MARK: - Cached DTO inputs (the shapes the adapter consumes)

/// Value-typed projection of a `MaintenanceItem` API row (web `MaintenanceItem`
/// in `types/vehicle-systems.ts`). Every numeric field is optional to mirror the
/// web source's `?? 0` / `?? '—'` null-coalescing — the backend may omit any of
/// them and the projection must still render.
public struct MaintenanceItemInput: Sendable, Equatable, Identifiable {
    public let id: String
    public var name: String?
    public var intervalKm: Double?
    public var intervalMonths: Double?
    public var estimatedCostUsd: Double?

    public init(
        id: String,
        name: String? = nil,
        intervalKm: Double? = nil,
        intervalMonths: Double? = nil,
        estimatedCostUsd: Double? = nil
    ) {
        self.id = id
        self.name = name
        self.intervalKm = intervalKm
        self.intervalMonths = intervalMonths
        self.estimatedCostUsd = estimatedCostUsd
    }
}

/// Value-typed projection of a `ServiceRecord` API row (web `ServiceRecord`).
/// `date` is the raw ISO-8601 string the web feeds to `new Date(...)`.
public struct ServiceRecordInput: Sendable, Equatable {
    public var itemId: String?
    public var date: String?
    public var odometerKm: Double?
    public var notes: String?

    public init(itemId: String? = nil, date: String? = nil, odometerKm: Double? = nil, notes: String? = nil) {
        self.itemId = itemId
        self.date = date
        self.odometerKm = odometerKm
        self.notes = notes
    }
}

// MARK: - Display-formatting context (web useUnits / useFormatting / useDateFormat)

/// The display-unit + locale context the projection formats through, mirroring
/// the web `useUnits` (`unitPrefs.distance`), `useFormatting` (`currencySymbol`,
/// `userPrecision`) and `useDateFormat` (`locale`, `tz`) hooks. The production
/// source fills this from the shared settings store; previews/tests pass it
/// explicitly so the adapter is deterministic.
public struct MaintenanceFormatting: Sendable, Equatable {
    /// Distance display unit label — `"km"` / `"mi"` / `"ft"` (web `unitPrefs.distance`).
    public var distanceUnit: String
    /// Currency symbol prefix (web `settings.currency_symbol`, default `"$"`).
    public var currencySymbol: String
    /// Fixed fraction digits for currency (web `userPrecision`).
    public var currencyPrecision: Int
    /// BCP-47 locale for number grouping + date rendering (web settings locale).
    public var localeIdentifier: String
    /// IANA time-zone for date rendering (web `tz`).
    public var timeZoneIdentifier: String

    public init(
        distanceUnit: String = "mi",
        currencySymbol: String = "$",
        currencyPrecision: Int = 0,
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC"
    ) {
        self.distanceUnit = distanceUnit
        self.currencySymbol = currencySymbol
        self.currencyPrecision = currencyPrecision
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    /// US-imperial default used by previews and the empty model state.
    public static let `default` = MaintenanceFormatting()
}

// MARK: - Projection (the merged view-model the view renders)

/// Service urgency derived from the interval months remaining (web `getUrgency`).
public enum MaintenanceUrgency: String, Sendable, Equatable, CaseIterable {
    case overdue
    case soon
    case good
}

/// The "Next Service" card view-model (web top panel of the standard layout, and
/// the headline number of the compact layout).
public struct MaintenanceNextService: Sendable, Equatable {
    public var name: String
    public var urgency: MaintenanceUrgency
    /// Numeric months remaining (web `nextItem.intervalMonths ?? 0`), kept for the
    /// accessibility summary and tests.
    public var intervalMonths: Double
    /// Pre-formatted integer months (web `fmtInt(intervalMonths)`).
    public var monthsText: String
    /// Pre-formatted "{number} {unit}" interval distance (web interval line).
    public var distanceText: String
    /// Pre-formatted currency, present only when the cost is known and positive.
    public var costText: String?

    public init(
        name: String,
        urgency: MaintenanceUrgency,
        intervalMonths: Double,
        monthsText: String,
        distanceText: String,
        costText: String? = nil
    ) {
        self.name = name
        self.urgency = urgency
        self.intervalMonths = intervalMonths
        self.monthsText = monthsText
        self.distanceText = distanceText
        self.costText = costText
    }
}

/// One recent-service row (web timeline item: title / subtitle / time).
public struct MaintenanceTimelineRow: Sendable, Equatable, Identifiable {
    public let id: String
    public var title: String
    public var subtitle: String
    public var time: String

    public init(id: String, title: String, subtitle: String, time: String) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.time = time
    }
}

/// The fully-projected widget content — the single value the view switches over
/// (web `nextItem` + `timelineItems` + `hasData`).
public struct MaintenanceProjection: Sendable, Equatable {
    public var next: MaintenanceNextService?
    public var timeline: [MaintenanceTimelineRow]
    public var hasData: Bool

    public init(next: MaintenanceNextService?, timeline: [MaintenanceTimelineRow], hasData: Bool) {
        self.next = next
        self.timeline = timeline
        self.hasData = hasData
    }

    /// Whether any recent service record resolved (web `recentRecords.length > 0`).
    public var hasRecords: Bool {
        !timeline.isEmpty
    }

    /// The resolved-but-empty projection (web `hasData === false`).
    public static let empty = MaintenanceProjection(next: nil, timeline: [], hasData: false)
}
