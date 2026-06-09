//
//  AlertDetailTimeline.Adapter.swift
//  TeslaSync — P4 feature view · 0001 · AlertDetailTimeline (Apple)
//
//  The testable projection core for the alert audit timeline — the SwiftUI parity of
//  web/src/features/admin/components/AlertDetailTimeline.tsx. Everything here is pure and
//  dependency-free (no store, no bundle, no rendered view): the event → row projection
//  (web `events.map(...)`), the per-kind SF-Symbol + semantic tint resolution (web
//  `kindIcon` / `KIND_COLOR`), the title resolution (web `defaultTitleWithActor` /
//  `defaultTitleAnonymous` plus the i18next `{{actor}}` interpolation), the timestamp
//  formatting (web `formatDateTime`), and the VoiceOver row summary — so each is unit
//  tested in isolation. The web leaf maps each loaded `AlertEvent` straight to a
//  `<Timeline>` item; that 1:1 projection is reproduced here so it is exercised end-to-end
//  rather than trusted from the caller.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The diagnostics surface slug shared by the view (`AlertDetailTimeline.surfaceSlug`) and
/// the model's `view.opened` telemetry. Kept here, dependency-free, so the model is testable
/// without the SwiftUI view type.
public enum AlertDetailTimelineSurface {
    public static let slug = "AlertDetailTimeline"
}

// MARK: - Alert event kind (web `AlertEventKind`)

/// The audit event kind (web `AlertEventKind = 'created' | 'acknowledged' | 'reopened' |
/// 'commented' | string`). Unknown backend kinds are preserved verbatim as `.other` so the
/// title falls back to the raw kind exactly like the web `default: return kind`.
public enum AlertEventKind: Equatable, Sendable {
    case created
    case acknowledged
    case reopened
    case commented
    case other(String)

    public init(_ rawValue: String) {
        switch rawValue {
        case "created": self = .created
        case "acknowledged": self = .acknowledged
        case "reopened": self = .reopened
        case "commented": self = .commented
        default: self = .other(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .created: "created"
        case .acknowledged: "acknowledged"
        case .reopened: "reopened"
        case .commented: "commented"
        case let .other(value): value
        }
    }
}

// MARK: - Cached alert event (web `AlertEvent`)

/// One alert audit event — the native mirror of the web `AlertEvent` the parent's
/// `useAlertDetail` supplies: the stable `id`, the `occurredAt` instant, the optional
/// `actor`, the `kind`, and the optional `note` subtitle. The production source projects
/// these from the shared alert-detail state holder.
public struct AlertDetailTimelineEvent: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let occurredAt: Date?
    public let actor: String?
    public let kind: AlertEventKind
    public let note: String?

    public init(
        id: Int64,
        occurredAt: Date?,
        actor: String? = nil,
        kind: AlertEventKind,
        note: String? = nil
    ) {
        self.id = id
        self.occurredAt = occurredAt
        self.actor = actor
        self.kind = kind
        self.note = note
    }
}

// MARK: - Derived timeline row (web `<Timeline>` item)

/// One derived timeline row — the native mirror of the web `<Timeline>` item the leaf maps
/// each `AlertEvent` to: the `id`, the `kind`, the normalized `actor` (web's trim-checked
/// value, else nil), the `note` subtitle, and the `timestamp`. The title/icon/tint are
/// resolved from these by the adapter + labels so the row stays value-typed and testable.
public struct AlertDetailTimelineEntry: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let kind: AlertEventKind
    public let actor: String?
    public let note: String?
    public let timestamp: Date?

    public init(
        id: Int64,
        kind: AlertEventKind,
        actor: String?,
        note: String?,
        timestamp: Date?
    ) {
        self.id = id
        self.kind = kind
        self.actor = actor
        self.note = note
        self.timestamp = timestamp
    }
}

// MARK: - Semantic tint (web `KIND_COLOR`)

/// The semantic tint of a row's dot/icon — the native mirror of the web `KIND_COLOR` map.
/// An unknown kind resolves to `.created` (web `KIND_COLOR[ev.kind] ?? KIND_COLOR.created`).
/// Mapped to the concrete design token in the view layer so the adapter stays SwiftUI-free.
public enum AlertDetailTimelineTint: String, Sendable, Equatable, CaseIterable {
    case created
    case acknowledged
    case reopened
    case commented
}

// MARK: - Projection + semantic resolution (port of AlertDetailTimeline.tsx)

/// Pure projection + presentation rules shared by the model and the views. No store, no
/// bundle, no SwiftUI — only value-typed inputs/outputs.
public enum AlertDetailTimelineAdapter {
    /// The em-dash the web renders for an absent timestamp (`formatDateTime(null) === '—'`).
    public static let emDash = "—"

    /// Web `events.map(...)`: project each loaded event to a row, preserving order (the
    /// parent supplies events oldest-first incl. the synthetic `created`). The actor is
    /// trim-checked and the note collapsed exactly like the web leaf.
    public static func project(from events: [AlertDetailTimelineEvent]) -> [AlertDetailTimelineEntry] {
        events.map { event in
            AlertDetailTimelineEntry(
                id: event.id,
                kind: event.kind,
                actor: normalizedActor(event.actor),
                note: normalizedNote(event.note),
                timestamp: event.occurredAt
            )
        }
    }

    /// Web `ev.actor && ev.actor.trim().length > 0 ? ev.actor : null`: keep the raw
    /// (untrimmed) value when it has non-whitespace content, else nil.
    public static func normalizedActor(_ actor: String?) -> String? {
        guard let actor, !actor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return actor
    }

    /// Web `subtitle: ev.note ?? undefined` + `{item.subtitle && …}`: an empty note string
    /// renders nothing, so it collapses to nil; a non-empty note is kept verbatim.
    public static func normalizedNote(_ note: String?) -> String? {
        guard let note, !note.isEmpty else { return nil }
        return note
    }

    /// Web `KIND_COLOR[ev.kind] ?? KIND_COLOR.created`: the semantic tint for a row, by
    /// kind, with unknown kinds falling back to the `created` tint.
    public static func tint(for kind: AlertEventKind) -> AlertDetailTimelineTint {
        switch kind {
        case .created: .created
        case .acknowledged: .acknowledged
        case .reopened: .reopened
        case .commented: .commented
        case .other: .created
        }
    }

    /// Web `kindIcon(ev.kind)`: the SF Symbol for a row, by kind, with unknown kinds using
    /// the info glyph (web `default: return <Icons.info />`). The web icon default (info)
    /// intentionally differs from the tint default (created) — both are reproduced verbatim.
    public static func iconSystemName(for kind: AlertEventKind) -> String {
        switch kind {
        case .created: "bell.fill"
        case .acknowledged: "checkmark.circle.fill"
        case .reopened: "arrow.clockwise"
        case .commented: "square.and.pencil"
        case .other: "info.circle.fill"
        }
    }
}

// MARK: - Localized titles (web `defaultTitle*` + i18next `{{actor}}`)

/// Resolves a row's title, the native port of the web title selection: an actor'd event
/// uses the `alerts.timeline.kind.{kind}` key (the i18next `{{actor}}` expressed as `%@`),
/// an anonymous event uses `alerts.timeline.kindAnonymous.{kind}`, and the web
/// `defaultTitleWithActor` / `defaultTitleAnonymous` strings are the English fallbacks.
/// Pure: the i18n lookup is injected as `localize(key, fallback)` so it is unit-tested
/// without a bundle.
public enum AlertDetailTimelineLabels {
    public static func title(
        for entry: AlertDetailTimelineEntry,
        localize: (String, String) -> String
    ) -> String {
        if let actor = entry.actor {
            return titleWithActor(kind: entry.kind, actor: actor, localize: localize)
        }
        return titleAnonymous(kind: entry.kind, localize: localize)
    }

    private static func titleWithActor(
        kind: AlertEventKind,
        actor: String,
        localize: (String, String) -> String
    ) -> String {
        switch kind {
        case .created:
            // The synthetic `created` row never carries the actor (web `defaultTitleWithActor`).
            localize("alerts.timeline.kind.created", "Alert created")
        case .acknowledged:
            interpolate(localize("alerts.timeline.kind.acknowledged", "Acknowledged by %@"), actor)
        case .reopened:
            interpolate(localize("alerts.timeline.kind.reopened", "Reopened by %@"), actor)
        case .commented:
            interpolate(localize("alerts.timeline.kind.commented", "Comment by %@"), actor)
        case let .other(value):
            localize("alerts.timeline.kind.\(value)", value)
        }
    }

    private static func titleAnonymous(
        kind: AlertEventKind,
        localize: (String, String) -> String
    ) -> String {
        switch kind {
        case .created:
            localize("alerts.timeline.kindAnonymous.created", "Alert created")
        case .acknowledged:
            localize("alerts.timeline.kindAnonymous.acknowledged", "Acknowledged")
        case .reopened:
            localize("alerts.timeline.kindAnonymous.reopened", "Reopened")
        case .commented:
            localize("alerts.timeline.kindAnonymous.commented", "Comment added")
        case let .other(value):
            localize("alerts.timeline.kindAnonymous.\(value)", value)
        }
    }

    /// Applies the `%@` actor interpolation (web i18next `{{actor}}`). Done as a literal
    /// replacement rather than `String(format:)` so an actor value containing `%` can never
    /// corrupt the formatter.
    private static func interpolate(_ template: String, _ actor: String) -> String {
        template.replacingOccurrences(of: "%@", with: actor)
    }
}

// MARK: - Timestamp formatting (web `formatDateTime`)

/// Locale-aware timestamp rendering for a row (web `formatDateTime` → "Apr 4, 2026, 2:30
/// AM"). `nil` → the em-dash sentinel the web formatter returns for nullish input.
public enum AlertDetailTimelineTimestamp {
    /// Absolute, locale-aware date + time body; em-dash when nil.
    public static func absolute(for date: Date?) -> String {
        guard let date else { return AlertDetailTimelineAdapter.emDash }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a timeline row. Pure and public so the spoken content is
/// asserted without rendering the view: the localized title, the note subtitle (omitted
/// when absent), and the absolute timestamp.
public enum AlertDetailTimelineAccessibility {
    public static func rowSummary(
        for entry: AlertDetailTimelineEntry,
        localize: (String, String) -> String
    ) -> String {
        var parts = [AlertDetailTimelineLabels.title(for: entry, localize: localize)]
        if let note = entry.note, !note.isEmpty {
            parts.append(note)
        }
        parts.append(AlertDetailTimelineTimestamp.absolute(for: entry.timestamp))
        return parts.joined(separator: ", ")
    }
}
