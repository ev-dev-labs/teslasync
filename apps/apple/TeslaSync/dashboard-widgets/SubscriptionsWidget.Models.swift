//
//  SubscriptionsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  Domain value types ported from the web source
//  (features/dashboard/widgets/SubscriptionsWidget.tsx): the cached
//  `Record<string, unknown>` envelope (as a closed JSON value), the display
//  context (locale + time-zone), the parsed-subscription intermediate, and the
//  merged projection the view renders. No SwiftUI / transport here.
//

import Foundation

// MARK: - Cached envelope value (web `envelope.data: Record<string, unknown>`)

/// A minimal JSON value mirroring the heterogeneous subscriptions envelope the
/// web source reads. Modeled as a closed, `Sendable`/`Equatable` enum so the
/// cached→projection adapter can port the web's dynamic key reads
/// (`data[key]`, `data[`${key}_expiry_date`]`, the `subscriptions` array)
/// faithfully while still flowing through the state-holder seam.
public enum SubscriptionsValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([SubscriptionsValue])
    case object([String: SubscriptionsValue])
    case null
}

public extension SubscriptionsValue {
    /// Web `asString(val)`: non-empty strings pass through, numbers stringify,
    /// everything else (bool / array / object / null / empty string) → nil.
    var asString: String? {
        switch self {
        case let .string(text): text.isEmpty ? nil : text
        case let .number(value): SubscriptionsValue.numberString(value)
        default: nil
        }
    }

    /// The backing dictionary when this value is a JSON object, else nil.
    var objectValue: [String: SubscriptionsValue]? {
        if case let .object(dict) = self { return dict }
        return nil
    }

    /// The backing element list when this value is a JSON array, else nil.
    var arrayValue: [SubscriptionsValue]? {
        if case let .array(items) = self { return items }
        return nil
    }

    /// Web skip predicate for a known-type flag: `val == null || val === false
    /// || val === ''` — these mean "the vehicle does not have this product".
    var isAbsentFlag: Bool {
        switch self {
        case .null: true
        case let .bool(flag): flag == false
        case let .string(text): text.isEmpty
        default: false
        }
    }

    /// Web `Boolean(val)` truthiness, used for the non-expiry active fallback.
    var isTruthy: Bool {
        switch self {
        case .null: false
        case let .bool(flag): flag
        case let .string(text): !text.isEmpty
        case let .number(value): value != 0
        case .array, .object: true
        }
    }

    /// Web `String(number)` — integral values render without a decimal point.
    static func numberString(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}

// MARK: - Display-formatting context (web useDateFormat: locale + tz)

/// The locale + time-zone context the projection formats dates through,
/// mirroring the web `useDateFormat` hook (`{ locale, tz }`). The production
/// source fills this from the shared settings store; previews / tests pass it
/// explicitly so the adapter is deterministic.
public struct SubscriptionsFormatting: Sendable, Equatable {
    /// BCP-47 locale identifier for date rendering (web settings locale).
    public var localeIdentifier: String
    /// IANA time-zone identifier for date rendering (web `tz`).
    public var timeZoneIdentifier: String

    public init(localeIdentifier: String = "en_US", timeZoneIdentifier: String = "UTC") {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    /// US-English / UTC default used by previews and the empty model state.
    public static let `default` = SubscriptionsFormatting()
}

// MARK: - Parsed subscription (web `ParsedSub`)

/// The intermediate the adapter emits per subscription, faithful to the web
/// `ParsedSub`. `expiryDate` is the raw ISO string the web feeds to
/// `new Date(...)`; `daysLeft` is the resolved `daysUntil(expiryDate)`.
public struct ParsedSubscription: Sendable, Equatable {
    public var name: String
    public var active: Bool
    public var expiryDate: String?
    public var renewalType: String?
    public var daysLeft: Int?

    public init(
        name: String,
        active: Bool,
        expiryDate: String? = nil,
        renewalType: String? = nil,
        daysLeft: Int? = nil
    ) {
        self.name = name
        self.active = active
        self.expiryDate = expiryDate
        self.renewalType = renewalType
        self.daysLeft = daysLeft
    }
}

// MARK: - Projection (the merged view-model the view renders)

/// One detail row of the standard layout (web `DetailEntry`): the subscription
/// name, its pre-formatted value (expiry date or renewal type or `—`), and the
/// active flag the status chip is derived from.
public struct SubscriptionRow: Sendable, Equatable, Identifiable {
    public let id: String
    public var name: String
    public var active: Bool
    public var valueText: String
    public var expiryDate: String?
    public var daysLeft: Int?

    public init(
        id: String,
        name: String,
        active: Bool,
        valueText: String,
        expiryDate: String? = nil,
        daysLeft: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.active = active
        self.valueText = valueText
        self.expiryDate = expiryDate
        self.daysLeft = daysLeft
    }
}

/// The fully-projected widget content — the single value the view switches over
/// (web `parsed` + `activeCount` + `nextExpiry` + the detail `entries`).
public struct SubscriptionsProjection: Sendable, Equatable {
    /// Every parsed subscription, in web discovery order (known types first).
    public var rows: [SubscriptionRow]
    /// Web `activeCount` — the headline number of the compact layout.
    public var activeCount: Int
    /// Web `nextExpiry` — the soonest active expiring subscription (compact).
    public var nextExpiry: SubscriptionRow?
    /// Pre-formatted compact badge date for `nextExpiry` (web `fmtDate(...) ?? '—'`).
    public var nextExpiryText: String?

    public init(
        rows: [SubscriptionRow],
        activeCount: Int,
        nextExpiry: SubscriptionRow?,
        nextExpiryText: String?
    ) {
        self.rows = rows
        self.activeCount = activeCount
        self.nextExpiry = nextExpiry
        self.nextExpiryText = nextExpiryText
    }

    /// Whether any subscription resolved (web `parsed.length > 0`).
    public var hasData: Bool {
        !rows.isEmpty
    }

    /// The resolved-but-empty projection (web `parsed.length === 0`).
    public static let empty = SubscriptionsProjection(
        rows: [],
        activeCount: 0,
        nextExpiry: nil,
        nextExpiryText: nil
    )
}
