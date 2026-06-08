//
//  EventTimeline.Adapter.swift
//  TeslaSync — P4 feature view · 0043 · EventTimeline (Apple)
//
//  The testable projection core for the Security Event Timeline — the SwiftUI parity
//  of features/admin/components/security-access/EventTimeline.tsx plus the
//  `deriveTimeline` / `isSentryActive` / `doorClosed` / `asNonEmptyString` derivation it
//  is fed by (security-access/helpers.ts). Everything here is pure + dependency-free
//  (no store, no bundle, no rendered view) so the timeline derivation, the semantic
//  icon/label resolution, the timestamp formatting, and the VoiceOver summaries are all
//  unit tested in isolation. The web leaf receives an already-derived `timelineEvents`
//  prop; the parent's `deriveTimeline(history)` is reproduced natively here so it is
//  exercised end-to-end rather than trusted from the caller (the 0009 precedent).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The diagnostics surface slug shared by the view (`EventTimeline.surfaceSlug`) and the
/// model's `view.opened` telemetry. Kept here, dependency-free, so the model is testable
/// without the SwiftUI view type.
public enum EventTimelineSurface {
    public static let slug = "EventTimeline"
}

// MARK: - Semantic timeline value types (web `TimelineEvent`)

/// The kind of state change a timeline row represents (web `TimelineEvent.kind`).
public enum EventTimelineKind: String, Sendable, Equatable, CaseIterable {
    case lock
    case sentry
    case door
}

/// The polarity of a state change, driving the icon + circle tint (web
/// `TimelineEvent.variant`). `deriveTimeline` only emits positive/negative; `neutral`
/// exists for parity with the web type and resolves like `negative` for labels/icon
/// with a muted (gray) tint, exactly as the web `timelineIcon` / circle classes do.
public enum EventTimelineVariant: String, Sendable, Equatable, CaseIterable {
    case positive
    case negative
    case neutral
}

/// One derived timeline row — the native mirror of the web `TimelineEvent` (helpers.ts):
/// `id`, `kind`, `variant`, `detail` (the raw door-state subtitle for door rows), and the
/// `timestamp`. `timestamp` is a `Date?` (the web string is parsed upstream) so the view
/// formats it locale-aware via `EventTimelineTimestamp`.
public struct EventTimelineEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: EventTimelineKind
    public let variant: EventTimelineVariant
    public let detail: String
    public let timestamp: Date?

    public init(
        id: String,
        kind: EventTimelineKind,
        variant: EventTimelineVariant,
        detail: String,
        timestamp: Date?
    ) {
        self.id = id
        self.kind = kind
        self.variant = variant
        self.detail = detail
        self.timestamp = timestamp
    }
}

// MARK: - Security signal value (web `unknown` sentryMode / doorState)

/// A minimal value modeling the three shapes the web `SecurityEvent.sentryMode` /
/// `doorState` arrive as (`boolean | string | absent`). The production source serializes
/// the shared security-store value into this; the adapter inspects it exactly like the
/// web `isSentryActive` / `doorClosed` / `asNonEmptyString` helpers, including the raw
/// inequality `curr !== prev` used to detect a change between consecutive records.
public enum EventTimelineSignal: Sendable, Equatable {
    case bool(Bool)
    case string(String)
    case absent

    /// Web `asNonEmptyString`: a non-empty string value, else `nil` (a bool / absent does
    /// not coerce). Used for the lock + door row `detail`.
    public var coercedString: String? {
        switch self {
        case let .string(value):
            value.isEmpty ? nil : value
        case .bool, .absent:
            nil
        }
    }
}

// MARK: - Cached security record (web `SecurityEvent` subset)

/// One cached security-history record — the native mirror of the fields the web
/// `deriveTimeline` reads from `SecurityEvent`: the stable `id`, the `createdAt` instant,
/// and the `locked` / `sentryMode` / `doorState` signals it diffs between consecutive
/// records. The production source projects these from the shared security-access store.
public struct EventTimelineSecurityEvent: Identifiable, Equatable, Sendable {
    public let id: String
    public let createdAt: Date?
    public let locked: Bool?
    public let sentryMode: EventTimelineSignal
    public let doorState: EventTimelineSignal

    public init(
        id: String,
        createdAt: Date?,
        locked: Bool?,
        sentryMode: EventTimelineSignal = .absent,
        doorState: EventTimelineSignal = .absent
    ) {
        self.id = id
        self.createdAt = createdAt
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorState = doorState
    }
}

// MARK: - Derivation + semantic resolution (port of helpers.ts + EventTimeline.tsx)

/// Pure derivation + presentation rules shared by the model and the views. No store, no
/// bundle, no SwiftUI — only value-typed inputs/outputs.
public enum EventTimelineAdapter {
    /// The em-dash the web renders for an absent lock detail (`?? '—'`).
    public static let emDash = "—"

    /// The web `deriveTimeline` row cap (`timeline.length >= 50`).
    public static let maxEvents = 50

    /// Web `isSentryActive`: a bool is taken as-is; a string is armed unless it contains
    /// "off" (case-insensitive); an empty/absent value is not armed.
    public static func isSentryActive(_ signal: EventTimelineSignal) -> Bool {
        switch signal {
        case let .bool(value):
            value
        case let .string(value):
            value.isEmpty ? false : !value.lowercased().contains("off")
        case .absent:
            false
        }
    }

    /// Web `doorClosed`: absent → closed; a bool is closed when false; a string is closed
    /// for the empty / "closed" / "closedall" / "0" / "false" forms (case-insensitive),
    /// otherwise open. (A numeric door state arrives pre-serialized as its "0"/"1" string.)
    public static func doorClosed(_ signal: EventTimelineSignal) -> Bool {
        switch signal {
        case .absent:
            return true
        case let .bool(value):
            return !value
        case let .string(value):
            let lower = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return ["", "closed", "closedall", "0", "false"].contains(lower)
        }
    }

    /// Web `deriveTimeline`: sort the history newest-first, diff each record against the
    /// next-older one, and emit a lock / sentry / door row for every field that changed —
    /// capped at `maxEvents` and returned newest-first. An empty history yields no rows.
    public static func deriveTimeline(from events: [EventTimelineSecurityEvent]) -> [EventTimelineEntry] {
        guard !events.isEmpty else { return [] }

        let sorted = events.sorted { lhs, rhs in
            (lhs.createdAt ?? .distantPast) > (rhs.createdAt ?? .distantPast)
        }

        var timeline: [EventTimelineEntry] = []
        var index = 0
        while index < sorted.count - 1 {
            let current = sorted[index]
            let previous = sorted[index + 1]

            if current.locked != previous.locked {
                timeline.append(EventTimelineEntry(
                    id: "lock-\(current.id)",
                    kind: .lock,
                    variant: current.locked == true ? .positive : .negative,
                    detail: current.doorState.coercedString ?? emDash,
                    timestamp: current.createdAt
                ))
            }

            if current.sentryMode != previous.sentryMode {
                timeline.append(EventTimelineEntry(
                    id: "sentry-\(current.id)",
                    kind: .sentry,
                    variant: isSentryActive(current.sentryMode) ? .positive : .negative,
                    detail: "",
                    timestamp: current.createdAt
                ))
            }

            if current.doorState != previous.doorState {
                let closed = doorClosed(current.doorState)
                timeline.append(EventTimelineEntry(
                    id: "door-\(current.id)",
                    kind: .door,
                    variant: closed ? .positive : .negative,
                    detail: current.doorState.coercedString ?? (closed ? "Closed" : "Open"),
                    timestamp: current.createdAt
                ))
            }

            if timeline.count >= maxEvents { break }
            index += 1
        }

        return timeline.sorted { lhs, rhs in
            (lhs.timestamp ?? .distantPast) > (rhs.timestamp ?? .distantPast)
        }
    }

    /// Web `timelineIcon`: the SF Symbol for a row, by kind + polarity. A non-positive
    /// variant (negative / neutral) uses the "open"/"alert" glyph, matching the web
    /// `variant === 'positive' ? … : …` ternary.
    public static func iconSystemName(kind: EventTimelineKind, variant: EventTimelineVariant) -> String {
        let positive = variant == .positive
        switch kind {
        case .lock:
            return positive ? "lock.fill" : "lock.open.fill"
        case .sentry:
            return positive ? "checkmark.shield.fill" : "exclamationmark.shield.fill"
        case .door:
            return positive ? "door.left.hand.closed" : "door.left.hand.open"
        }
    }
}

// MARK: - Localized labels (web `useTimelineLabels`)

/// Resolves a row's title + subtitle, the native port of the web `useTimelineLabels`
/// hook. Pure: the i18n lookup is injected as `localize(key, fallback)` so the mapping is
/// unit-tested without a bundle. Door subtitles use the raw `detail` (web `ev.detail`);
/// lock/sentry subtitles are localized descriptions. A non-positive variant resolves to
/// the negative labels, matching the web `variant === 'positive'` switch.
public enum EventTimelineLabels {
    public struct Resolved: Equatable, Sendable {
        public let title: String
        public let subtitle: String

        public init(title: String, subtitle: String) {
            self.title = title
            self.subtitle = subtitle
        }
    }

    public static func resolve(
        for entry: EventTimelineEntry,
        localize: (String, String) -> String
    ) -> Resolved {
        let positive = entry.variant == .positive
        switch entry.kind {
        case .lock:
            return Resolved(
                title: positive
                    ? localize("admin.security.timeline.lock.positive", "Vehicle Locked")
                    : localize("admin.security.timeline.lock.negative", "Vehicle Unlocked"),
                subtitle: positive
                    ? localize("admin.security.timeline.lock.positiveDesc", "Doors secured")
                    : localize("admin.security.timeline.lock.negativeDesc", "Doors accessible")
            )
        case .sentry:
            return Resolved(
                title: positive
                    ? localize("admin.security.timeline.sentry.positive", "Sentry Mode Activated")
                    : localize("admin.security.timeline.sentry.negative", "Sentry Mode Deactivated"),
                subtitle: positive
                    ? localize("admin.security.timeline.sentry.positiveDesc", "Camera surveillance enabled")
                    : localize("admin.security.timeline.sentry.negativeDesc", "Camera surveillance disabled")
            )
        case .door:
            return Resolved(
                title: positive
                    ? localize("admin.security.timeline.door.positive", "Doors Closed")
                    : localize("admin.security.timeline.door.negative", "Door Opened"),
                subtitle: entry.detail
            )
        }
    }
}

// MARK: - Timestamp formatting (web `TimeStamp`)

/// Locale-aware timestamp rendering for a row (web `TimeStamp`): an absolute body plus a
/// relative alternate for the accessibility hint. `nil` → the em-dash sentinel.
public enum EventTimelineTimestamp {
    /// Absolute, locale-aware "Apr 4, 2:30 AM" body; em-dash when nil.
    public static func absolute(for date: Date?) -> String {
        guard let date else { return EventTimelineAdapter.emDash }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Relative "2h ago" alternate, delegated to the OS so it is localized without
    /// hardcoded English. `now` is injectable for deterministic tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a timeline row. Pure + public so the spoken content is
/// asserted without rendering the view. The localized title + subtitle (subtitle omitted
/// when empty, e.g. sentry rows) plus the absolute timestamp.
public enum EventTimelineAccessibility {
    public static func rowSummary(
        for entry: EventTimelineEntry,
        localize: (String, String) -> String
    ) -> String {
        let labels = EventTimelineLabels.resolve(for: entry, localize: localize)
        var parts = [labels.title]
        if !labels.subtitle.isEmpty {
            parts.append(labels.subtitle)
        }
        parts.append(EventTimelineTimestamp.absolute(for: entry.timestamp))
        return parts.joined(separator: ", ")
    }
}
