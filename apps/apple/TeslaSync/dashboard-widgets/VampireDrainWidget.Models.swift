//
//  VampireDrainWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  Domain value types ported from features/dashboard/widgets/VampireDrainWidget.tsx:
//  the cached vampire-drain stats + event rows (web `VampireDrainStats` /
//  `VampireDrainEvent` from useEnergy), the projected feed item (web
//  `EventFeedItem`), and the drain-severity tone / duration / relative-time
//  buckets the widget renders. Pure Foundation — no SwiftUI — so the projection
//  is unit-testable and the localized rendering lives at the display boundary.
//

import Foundation

// MARK: - Cached stats DTO (port of the web VampireDrainStats from useVampireDrainStats)

/// One cached vampire-drain summary as delivered by the shared energy state
/// holder — the value-typed projection of the web `VampireDrainStats`. All
/// rates are SI-derived fractions per hour (Phase-42 stores SI); the widget
/// scales `avgDrainRate × 24` for the displayed %/day, mirroring the web memo.
/// Only the fields the web widget reads are modeled (avg rate, event count,
/// total hours); the remaining `VampireDrainStats` members are not surfaced.
public struct VampireDrainStatsInput: Sendable, Equatable {
    /// Average drain rate in percent-of-battery **per hour** (web `avg_drain_rate`).
    public var avgDrainRatePerHour: Double?
    /// Number of detected drain events (web `event_count`).
    public var eventCount: Int?
    /// Total parked hours the events span (web `total_hours`).
    public var totalHours: Double?

    public init(
        avgDrainRatePerHour: Double? = nil,
        eventCount: Int? = nil,
        totalHours: Double? = nil
    ) {
        self.avgDrainRatePerHour = avgDrainRatePerHour
        self.eventCount = eventCount
        self.totalHours = totalHours
    }
}

// MARK: - Cached event DTO (port of the web VampireDrainEvent row)

/// One cached drain event as delivered by the shared energy state holder — the
/// value-typed projection of the web `VampireDrainEvent`. Optional fields mirror
/// the web `?? 0` fallbacks the widget applies in its `eventItems` memo.
public struct VampireDrainEventInput: Sendable, Equatable, Identifiable {
    public let id: Int
    /// Battery percent lost over the event (web `battery_lost`).
    public var batteryLost: Double?
    /// Event duration in hours (web `duration_hours`).
    public var durationHours: Double?
    /// Drain rate in percent-of-battery **per hour** (web `drain_rate_pct_per_hour`).
    public var drainRatePerHour: Double?
    /// Whether Sentry was active during the event (web `sentry_mode`).
    public var sentryMode: Bool
    /// Event start time (web `start_date`) — the feed sort key + relative-time anchor.
    public var startDate: Date?

    public init(
        id: Int,
        batteryLost: Double? = nil,
        durationHours: Double? = nil,
        drainRatePerHour: Double? = nil,
        sentryMode: Bool = false,
        startDate: Date? = nil
    ) {
        self.id = id
        self.batteryLost = batteryLost
        self.durationHours = durationHours
        self.drainRatePerHour = drainRatePerHour
        self.sentryMode = sentryMode
        self.startDate = startDate
    }
}

// MARK: - Drain severity tone (port of the web `drainColor`)

/// The severity bucket the web `drainColor(pctPerDay)` maps a %/day rate into:
/// `< 1` green / `< 3` amber / else red. Kept as a pure value so the bucket
/// logic is unit-testable and the color resolves from the design tokens at the
/// display boundary (no hardcoded hex in the view).
public enum DrainTone: Sendable, Equatable {
    case good
    case warning
    case critical
}

// MARK: - Duration bucket (port of the web `formatDuration`)

/// The duration bucket the web `formatDuration(hours)` renders: `< 1h` shows
/// whole minutes with the "m" unit, otherwise one-decimal hours with the "h"
/// unit. The numeric value is preserved; the localized unit suffix is applied
/// at the display boundary so no English literal lives in code.
public enum DrainDuration: Sendable, Equatable {
    /// `hours < 1` → rounded whole minutes (web `fmtNumber(hours * 60, 0)`).
    case minutes(Double)
    /// `hours >= 1` → one-decimal hours (web `fmtNumber(hours, 1)`).
    case hours(Double)
}

// MARK: - Projection (port of the web eventItems mapping)

/// A fully-resolved drain-event feed entry the view renders — the Swift analogue
/// of the web `EventFeedItem` built in the widget's `eventItems` memo. Every
/// numeric fallback is already applied; the title/subtitle/relative-time strings
/// are composed at the display boundary from these values + the i18n facade.
public struct VampireDrainEventItem: Sendable, Equatable, Identifiable {
    public let id: Int
    /// Battery percent lost (web `ev.battery_lost ?? 0`).
    public var batteryLostPct: Double
    /// Drain rate in percent-of-battery **per day** (web `(drain_rate_pct_per_hour ?? 0) * 24`).
    public var drainPerDay: Double
    /// Event duration bucket (web `formatDuration(ev.duration_hours ?? 0)`).
    public var duration: DrainDuration
    /// Whether Sentry was active (web `ev.sentry_mode`).
    public var sentryMode: Bool
    /// Event start time (web `ev.start_date`) — feed sort key + relative-time anchor.
    public var timestamp: Date
    /// Severity tone driving the marker color + a11y emphasis (web `drainColor(drainDay)`).
    public var tone: DrainTone

    public init(
        id: Int,
        batteryLostPct: Double,
        drainPerDay: Double,
        duration: DrainDuration,
        sentryMode: Bool,
        timestamp: Date,
        tone: DrainTone
    ) {
        self.id = id
        self.batteryLostPct = batteryLostPct
        self.drainPerDay = drainPerDay
        self.duration = duration
        self.sentryMode = sentryMode
        self.timestamp = timestamp
        self.tone = tone
    }
}

// MARK: - Relative time (port of WidgetEventFeed.formatRelativeTime)

/// The relative-time bucket the feed renders for a row, a faithful port of the
/// web `WidgetEventFeed.formatRelativeTime`. Kept pure so the bucket logic is
/// unit-testable and the *localized* rendering lives at the display boundary.
public enum DrainRelativeTime: Sendable, Equatable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case absolute(Date)
}
