//
//  VehicleUpgradesWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  Domain value types ported from the web source + its API types
//  (features/dashboard/widgets/VehicleUpgradesWidget.tsx, types/sharing.ts): the
//  raw upgrade envelope the backend returns (`/vehicles/{id}/upgrades` →
//  Record<string, unknown>), the cached share-link DTO input, the display
//  formatting context, the normalized `ParsedUpgrade`, and the merged projection
//  the view renders. No SwiftUI / transport here.
//

import Foundation

// MARK: - Raw upgrade envelope (the untyped shape `parseUpgrades` consumes)

/// One candidate field value inside a raw upgrade object. The web `asString`
/// helper accepts `unknown` and keeps a non-empty string, stringifies a number,
/// and otherwise yields `null`; this enum models exactly those three inbound
/// kinds so the Swift adapter reproduces that coercion byte-for-byte.
public enum UpgradeScalar: Sendable, Equatable {
    case text(String)
    case number(Double)
    case absent

    /// Web `asString(val)` — a non-empty string stays, a number is stringified
    /// (JS `String(n)`), everything else (incl. the empty string) becomes `nil`.
    public var asString: String? {
        switch self {
        case let .text(value):
            value.isEmpty ? nil : value
        case let .number(value):
            UpgradeScalar.jsNumberString(value)
        case .absent:
            nil
        }
    }

    /// JS `String(Number)` semantics: integral values print without a fractional
    /// part, fractional values keep their shortest decimal form.
    static func jsNumberString(_ value: Double) -> String {
        guard value.isFinite else { return value.isNaN ? "NaN" : (value > 0 ? "Infinity" : "-Infinity") }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

/// A raw upgrade object from the envelope, before normalization. Each candidate
/// field is an `UpgradeScalar` so the adapter can apply the web's
/// `name ?? title`, `price ?? cost`, `description ?? summary` fallbacks. `eligible`
/// is a tri-state: `nil` mirrors a missing flag, which the web treats as eligible
/// (`u.eligible !== false`).
public struct RawUpgrade: Sendable, Equatable {
    public var name: UpgradeScalar
    public var title: UpgradeScalar
    public var price: UpgradeScalar
    public var cost: UpgradeScalar
    public var description: UpgradeScalar
    public var summary: UpgradeScalar
    public var eligible: Bool?

    public init(
        name: UpgradeScalar = .absent,
        title: UpgradeScalar = .absent,
        price: UpgradeScalar = .absent,
        cost: UpgradeScalar = .absent,
        description: UpgradeScalar = .absent,
        summary: UpgradeScalar = .absent,
        eligible: Bool? = nil
    ) {
        self.name = name
        self.title = title
        self.price = price
        self.cost = cost
        self.description = description
        self.summary = summary
        self.eligible = eligible
    }
}

/// One entry of the keyed-fallback envelope shape (web `Object.entries(data)`),
/// preserving the key so the adapter can fall back to it for a missing name.
public struct RawUpgradeEntry: Sendable, Equatable {
    public var key: String
    public var upgrade: RawUpgrade

    public init(key: String, upgrade: RawUpgrade) {
        self.key = key
        self.upgrade = upgrade
    }
}

/// The two envelope shapes `parseUpgrades` understands, plus the resolved-empty
/// case. `.list` is the `data.upgrades` array; `.keyed` is the
/// "top-level keys are individual upgrades" fallback; `.none` is a null / absent
/// envelope (the web `if (!data) return []`).
public enum UpgradeEnvelope: Sendable, Equatable {
    case list([RawUpgrade])
    case keyed([RawUpgradeEntry])
    case none
}

// MARK: - Share-link DTO input (web `ShareToken`)

/// Value-typed projection of a `ShareToken` API row (web `ShareToken` in
/// `types/sharing.ts`). The widget only reads `expires_at`, so that is the only
/// field modeled; `id` is carried for stable identity in the projection/tests.
public struct ShareLinkInput: Sendable, Equatable, Identifiable {
    public let id: String
    /// Raw ISO-8601 expiry the web feeds to `new Date(...)`; `nil` = never expires.
    public var expiresAt: String?

    public init(id: String, expiresAt: String? = nil) {
        self.id = id
        self.expiresAt = expiresAt
    }
}

// MARK: - Display-formatting context (web `$`-prefix + useDateFormat)

/// The display context the projection formats through. The web hardcodes a `"$"`
/// price prefix (`<Badge>${upgrade.price}</Badge>`) and renders the nearest-expiry
/// date via `useDateFormat().formatDate` (locale + IANA time-zone). The production
/// source fills this from the shared settings store; previews/tests pass it
/// explicitly so the adapter is deterministic.
public struct UpgradesFormatting: Sendable, Equatable {
    /// Currency symbol prefixed to a price chip (web literal `"$"`).
    public var currencySymbol: String
    /// BCP-47 locale for date rendering (web settings locale).
    public var localeIdentifier: String
    /// IANA time-zone for date rendering (web `tz`).
    public var timeZoneIdentifier: String
    /// "Now" reference for `daysUntil` — injected so expiry math is deterministic
    /// in tests (web uses `Date.now()`).
    public var now: Date

    public init(
        currencySymbol: String = "$",
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC",
        now: Date = Date()
    ) {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
        self.now = now
    }

    /// US default used by previews and the empty model state.
    public static let `default` = UpgradesFormatting()
}

// MARK: - Projection (the merged view-model the view renders)

/// One normalized upgrade row (web `ParsedUpgrade`): a resolved name, the optional
/// price string (already coerced via `asString`, rendered behind the `"$"` chip),
/// an optional description, and the eligibility flag.
public struct ParsedUpgrade: Sendable, Equatable, Identifiable {
    public var name: String
    public var price: String?
    public var detail: String?
    public var eligible: Bool

    /// Stable identity for `ForEach` — the web keys rows by `upgrade.name`.
    public var id: String {
        name
    }

    public init(name: String, price: String? = nil, detail: String? = nil, eligible: Bool) {
        self.name = name
        self.price = price
        self.detail = detail
        self.eligible = eligible
    }
}

/// The fully-projected widget content — the single value the view switches over
/// (web `upgrades` + `eligibleCount` + `activeShareLinks` + `nearestExpiry`).
public struct UpgradesProjection: Sendable, Equatable {
    public var upgrades: [ParsedUpgrade]
    /// Web `eligibleCount = upgrades.filter(u => u.eligible).length`.
    public var eligibleCount: Int
    /// Web `activeShareLinks.length`.
    public var activeShareLinkCount: Int
    /// Pre-formatted nearest-expiry date (web `fmtDate(nearestExpiry.expires_at)`),
    /// present only when an active link carries an expiry.
    public var nearestExpiryText: String?
    /// Currency symbol prefixed to a price chip (web literal `"$"`), threaded so
    /// the view holds no literal glyph.
    public var currencySymbol: String
    public var hasData: Bool

    public init(
        upgrades: [ParsedUpgrade],
        eligibleCount: Int,
        activeShareLinkCount: Int,
        nearestExpiryText: String?,
        currencySymbol: String = "$",
        hasData: Bool
    ) {
        self.upgrades = upgrades
        self.eligibleCount = eligibleCount
        self.activeShareLinkCount = activeShareLinkCount
        self.nearestExpiryText = nearestExpiryText
        self.currencySymbol = currencySymbol
        self.hasData = hasData
    }

    /// Whether any upgrade resolved (web `upgrades.length > 0`).
    public var hasUpgrades: Bool {
        !upgrades.isEmpty
    }

    /// Whether any active share link resolved (web `activeShareLinks.length > 0`).
    public var hasActiveShareLinks: Bool {
        activeShareLinkCount > 0
    }

    /// The resolved-but-empty projection (web no upgrades + no share links).
    public static let empty = UpgradesProjection(
        upgrades: [],
        eligibleCount: 0,
        activeShareLinkCount: 0,
        nearestExpiryText: nil,
        currencySymbol: "$",
        hasData: false
    )
}
