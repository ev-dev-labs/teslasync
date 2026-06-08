//
//  GuardModeWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0054 · GuardModeWidget (Apple)
//
//  The testable projection core: cached guard config / events DTOs → the
//  view-ready `GuardStatus` + `GuardFeedItem` projections, the event-type → visual
//  catalog (parity with the web `EVENT_TYPE_MAP`), the relative-time formatter, and
//  the VoiceOver summary builder. All pure + dependency-free so the adapter can be
//  unit-tested without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Severity (web `EventFeedItem['severity']`)

/// Event severity carried through the projection, mapped to a shared `TSTone` for
/// any tinting/VoiceOver. Mirrors the web `'info' | 'warning' | 'critical'`.
public enum GuardSeverity: Sendable {
    case info
    case warning
    case critical

    public var tone: TSTone {
        switch self {
        case .info: .info
        case .warning: .warning
        case .critical: .danger
        }
    }
}

// MARK: - Event-type → visual catalog (port of the web `EVENT_TYPE_MAP`)

/// Resolves a guard `event_type` to its SF Symbol, English fallback label, dot
/// color, and severity — the native port of the web `EVENT_TYPE_MAP` lookup with
/// a neutral fallback so unknown backend types render with a shield instead of
/// crashing or showing `undefined`. The dot colors reproduce the exact web hex so
/// the feed reads identically on both apps.
public enum GuardEventCatalog {
    /// One resolved event presentation (icon + label + color + severity).
    public struct Visual: Sendable {
        public let systemImage: String
        public let fallbackLabel: String
        public let dotColor: Color
        public let severity: GuardSeverity
    }

    // Web hex parity (EVENT_TYPE_MAP `color`).
    private static let amber = Color(red: 0.961, green: 0.620, blue: 0.043) // #f59e0b
    private static let red = Color(red: 0.937, green: 0.267, blue: 0.267) // #ef4444
    private static let cyan = Color(red: 0.024, green: 0.714, blue: 0.831) // #06b6d4
    private static let purple = Color(red: 0.545, green: 0.361, blue: 0.965) // #8b5cf6
    private static let slate = Color(red: 0.420, green: 0.447, blue: 0.502) // #6b7280

    /// The canonical web `event_type` keys, kept as constants so the catalog, the
    /// i18n keys, and the tests stay in lock-step.
    public static let knownTypes = [
        "vehicle_moved", "unauthorized_unlock", "unauthorized_drive", "sentry_triggered",
        "manual_panic", "test_alert", "locked", "sentry_mode", "valet_mode_enabled"
    ]

    public static func visual(for eventType: String) -> Visual {
        switch eventType {
        case "vehicle_moved":
            Visual(
                systemImage: "arrow.up.and.down.and.arrow.left.and.right",
                fallbackLabel: "Vehicle Moved", dotColor: amber, severity: .warning
            )
        case "unauthorized_unlock":
            Visual(
                systemImage: "lock.open.fill",
                fallbackLabel: "Unauthorized Unlock",
                dotColor: red,
                severity: .critical
            )
        case "unauthorized_drive":
            Visual(systemImage: "car.fill", fallbackLabel: "Unauthorized Drive", dotColor: red, severity: .critical)
        case "sentry_triggered":
            Visual(systemImage: "eye.fill", fallbackLabel: "Sentry Triggered", dotColor: cyan, severity: .warning)
        case "manual_panic":
            Visual(
                systemImage: "bell.and.waves.left.and.right.fill",
                fallbackLabel: "Panic Alert", dotColor: red, severity: .critical
            )
        case "test_alert":
            Visual(systemImage: "testtube.2", fallbackLabel: "Test Alert", dotColor: purple, severity: .info)
        case "locked":
            Visual(
                systemImage: "checkmark.shield.fill",
                fallbackLabel: "Lock State Changed",
                dotColor: cyan,
                severity: .info
            )
        case "sentry_mode":
            Visual(systemImage: "eye.fill", fallbackLabel: "Sentry Mode", dotColor: amber, severity: .warning)
        case "valet_mode_enabled":
            Visual(
                systemImage: "exclamationmark.shield.fill",
                fallbackLabel: "Valet Mode",
                dotColor: cyan,
                severity: .info
            )
        default:
            Visual(
                systemImage: "exclamationmark.shield.fill",
                fallbackLabel: eventType.isEmpty ? "—" : eventType, dotColor: slate, severity: .info
            )
        }
    }
}

// MARK: - Status projection (web `enabled` / `sensitivity` / `autoPanic` / `eventCount`)

/// The guard status the header/compact/standard views render, projected from the
/// cached `GuardConfigInput` with the same null-coalescing the web applies
/// (`enabled ?? false`, `sensitivity ?? '—'`, `auto_panic ?? false`).
public struct GuardStatus: Equatable, Sendable {
    public let enabled: Bool
    public let sensitivity: String
    public let autoPanic: Bool
    public let eventCount: Int

    public init(enabled: Bool, sensitivity: String, autoPanic: Bool, eventCount: Int) {
        self.enabled = enabled
        self.sensitivity = sensitivity
        self.autoPanic = autoPanic
        self.eventCount = eventCount
    }

    /// The neutral status shown before any config resolves (web em-dash sentinel).
    public static let empty = GuardStatus(enabled: false, sensitivity: "—", autoPanic: false, eventCount: 0)

    /// Projects the cached config + the resolved event count into the view status.
    public static func project(config: GuardConfigInput?, eventCount: Int) -> GuardStatus {
        let raw = (config?.sensitivity ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return GuardStatus(
            enabled: config?.enabled ?? false,
            sensitivity: raw.isEmpty ? "—" : raw,
            autoPanic: config?.autoPanic ?? false,
            eventCount: eventCount
        )
    }
}

// MARK: - Feed item projection (web `mapEventToFeedItem`)

/// One row in the guard event feed — the native port of the web `EventFeedItem`,
/// carrying the resolved (localized) title/subtitle, the raw `eventType` so the
/// view can re-derive icon + color, and the metadata for sorting + VoiceOver.
public struct GuardFeedItem: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let eventType: String
    public let title: String
    public let subtitle: String
    public let acknowledged: Bool
    public let timestamp: Date
    public let severity: GuardSeverity

    public init(
        id: Int64,
        eventType: String,
        title: String,
        subtitle: String,
        acknowledged: Bool,
        timestamp: Date,
        severity: GuardSeverity
    ) {
        self.id = id
        self.eventType = eventType
        self.title = title
        self.subtitle = subtitle
        self.acknowledged = acknowledged
        self.timestamp = timestamp
        self.severity = severity
    }
}

/// Builds the sorted, optionally-capped feed projection from the cached events,
/// resolving each label through the injected localizer (so it's bundle-free in
/// tests). Mirrors the web `events.map(mapEventToFeedItem)` + the feed's
/// newest-first sort and `maxItems` slice.
public enum GuardFeedBuilder {
    public static func build(
        events: [GuardEventInput],
        limit: Int? = nil,
        localize: (String, String) -> String
    ) -> [GuardFeedItem] {
        let sorted = events.sorted { $0.timestamp > $1.timestamp }
        let capped = limit.map { Array(sorted.prefix(max(0, $0))) } ?? sorted
        return capped.map { event in
            let visual = GuardEventCatalog.visual(for: event.eventType)
            let acknowledged = event.acknowledgedAt != nil
            return GuardFeedItem(
                id: event.id,
                eventType: event.eventType,
                title: localize("widget.guardEvent.\(event.eventType)", visual.fallbackLabel),
                subtitle: acknowledged
                    ? localize("widget.guardAcknowledged", "Acknowledged")
                    : localize("widget.guardUnacknowledged", "Unacknowledged"),
                acknowledged: acknowledged,
                timestamp: event.timestamp,
                severity: visual.severity
            )
        }
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

/// Locale-aware relative timestamp for a feed row (web `formatRelativeTime`'s
/// "Just now / Nm ago / Nh ago" intent), delegated to the OS so it's localized
/// without hardcoded English. `now` is injectable for deterministic tests.
public enum GuardRelativeTime {
    public static func string(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the status card and event rows. Pure + public
/// so the spoken content can be unit-tested without rendering the view.
public enum GuardAccessibility {
    public static func statusSummary(for status: GuardStatus, localize: (String, String) -> String) -> String {
        var parts = [
            localize("widget.guardMode", "Guard Mode"),
            status.enabled ? localize("widget.guardArmed", "Armed") : localize("widget.guardDisarmed", "Disarmed"),
            "\(localize("widget.guardSensitivity", "Sensitivity")): \(status.sensitivity)"
        ]
        if status.autoPanic { parts.append(localize("widget.guardAutoPanic", "Auto-panic")) }
        parts.append("\(status.eventCount) \(localize("widget.guardEvents", "events"))")
        return parts.joined(separator: ". ")
    }

    public static func eventSummary(for item: GuardFeedItem) -> String {
        "\(item.title). \(item.subtitle)"
    }
}
