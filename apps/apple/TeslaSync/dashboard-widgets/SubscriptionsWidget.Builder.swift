//
//  SubscriptionsWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  Pure parsers + projection builder — the unit-tested cached→projection adapter,
//  a faithful Swift port of the data pipeline in
//  features/dashboard/widgets/SubscriptionsWidget.tsx (asString, daysUntil, the
//  known-type extraction, the generic `subscriptions` array fallback with
//  case-insensitive de-duplication, and the active / next-expiry derivation).
//  No SwiftUI / transport here — this is the deterministic core both platforms
//  agree on.
//

import Foundation

/// Resolves an i18n key to its localized string (web `t(key, default)`). Injected
/// so the adapter stays free of the SwiftUI localization facade and is testable
/// against the English fallbacks.
public typealias SubscriptionsLocalize = (_ key: String, _ fallback: String) -> String

/// Pure adapters that merge the cached subscriptions envelope into a
/// `SubscriptionsProjection`. Mirrors the web source exactly so iOS, iPadOS,
/// macOS, and the web render the same rows, counts, and dates.
public enum SubscriptionsProjectionBuilder {
    /// The known subscription products extracted from the envelope, in the web
    /// `SUBSCRIPTION_TYPES` order.
    struct KnownType {
        let key: String
        let labelKey: String
        let fallback: String
    }

    static let knownTypes: [KnownType] = [
        KnownType(
            key: "premium_connectivity",
            labelKey: "widget.subscriptions.premiumConnectivity",
            fallback: "Premium Connectivity"
        ),
        KnownType(
            key: "full_self_driving",
            labelKey: "widget.subscriptions.fsd",
            fallback: "Full Self-Driving"
        ),
        KnownType(
            key: "enhanced_autopilot",
            labelKey: "widget.subscriptions.enhancedAutopilot",
            fallback: "Enhanced Autopilot"
        ),
        KnownType(
            key: "standard_connectivity",
            labelKey: "widget.subscriptions.standardConnectivity",
            fallback: "Standard Connectivity"
        ),
        KnownType(
            key: "data_sharing",
            labelKey: "widget.subscriptions.dataSharing",
            fallback: "Data Sharing"
        ),
        KnownType(
            key: "satellite_connectivity",
            labelKey: "widget.subscriptions.satellite",
            fallback: "Satellite Connectivity"
        )
    ]

    // MARK: Days-until (web `daysUntil`)

    /// Web `Math.ceil((expiry - now) / 86_400_000)` — whole days until expiry,
    /// `nil` for a missing / unparseable date.
    static func daysUntil(_ iso: String?, now: Date) -> Int? {
        guard let iso, let expiry = parseDate(iso) else { return nil }
        let days = expiry.timeIntervalSince(now) / 86400.0
        return Int(days.rounded(.up))
    }

    /// Parses the ISO-8601 (or date-only) string the web hands to `new Date(...)`.
    static func parseDate(_ iso: String) -> Date? {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFraction.date(from: trimmed) { return parsed }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let parsed = plain.date(from: trimmed) { return parsed }

        let dateOnly = DateFormatter()
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        return dateOnly.date(from: trimmed)
    }

    // MARK: Date formatting (web `formatDate`)

    /// Web `formatDate(iso)` — medium localized date, `'—'` for null / invalid
    /// (web `year:'numeric', month:'short', day:'numeric'` ⇒ medium style).
    static func dateText(_ iso: String?, format: SubscriptionsFormatting) -> String {
        guard let iso, let date = parseDate(iso) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: format.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: format.timeZoneIdentifier) ?? .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    // MARK: Parsing (web `parseSubscriptions`)

    /// Web `parseSubscriptions(data, t)` — the known-type extraction followed by
    /// the generic `subscriptions` array fallback (deduplicated by name).
    public static func parseSubscriptions(
        _ data: [String: SubscriptionsValue]?,
        now: Date,
        localize: SubscriptionsLocalize
    ) -> [ParsedSubscription] {
        guard let data else { return [] }
        var subs = parseKnownTypes(data, now: now, localize: localize)
        appendArrayItems(from: data, into: &subs, now: now, localize: localize)
        return subs
    }

    /// Web first loop — the six `SUBSCRIPTION_TYPES` read off the envelope root.
    private static func parseKnownTypes(
        _ data: [String: SubscriptionsValue],
        now: Date,
        localize: SubscriptionsLocalize
    ) -> [ParsedSubscription] {
        knownTypes.compactMap { type in
            let flag = data[type.key] ?? .null
            if flag.isAbsentFlag { return nil }

            let expiry = (data["\(type.key)_expiry_date"]?.asString)
                ?? data["\(type.key)_expiry"]?.asString
            let days = daysUntil(expiry, now: now)
            let active = expiry != nil ? (days != nil && days! > 0) : flag.isTruthy
            let renewal = (data["\(type.key)_renewal"]?.asString)
                ?? data["\(type.key)_renewal_type"]?.asString

            return ParsedSubscription(
                name: localize(type.labelKey, type.fallback),
                active: active,
                expiryDate: expiry,
                renewalType: renewal,
                daysLeft: days
            )
        }
    }

    /// Web fallback loop — any generic `subscriptions: [...]` array on the
    /// envelope, skipping entries whose name already resolved above.
    private static func appendArrayItems(
        from data: [String: SubscriptionsValue],
        into subs: inout [ParsedSubscription],
        now: Date,
        localize: SubscriptionsLocalize
    ) {
        guard let items = data["subscriptions"]?.arrayValue else { return }
        for item in items {
            guard let record = item.objectValue else { continue }
            let name = (record["name"]?.asString)
                ?? record["type"]?.asString
                ?? localize("widget.subscriptions.unknown", "Unknown")
            if subs.contains(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
                continue
            }

            let expiry = (record["expiry_date"]?.asString)
                ?? record["expiry"]?.asString
                ?? record["end_date"]?.asString
            let days = daysUntil(expiry, now: now)
            subs.append(ParsedSubscription(
                name: name,
                active: activeForArrayItem(status: record["status"]?.asString, expiry: expiry, days: days),
                expiryDate: expiry,
                renewalType: (record["renewal_type"]?.asString) ?? record["renewal"]?.asString,
                daysLeft: days
            ))
        }
    }

    /// Web array-item active rule: an explicit `status` wins (`=== 'active'`),
    /// else an expiry decides, else the entry is treated as active.
    private static func activeForArrayItem(status: String?, expiry: String?, days: Int?) -> Bool {
        if let status {
            return status.lowercased() == "active"
        }
        if expiry != nil {
            return days != nil && days! > 0
        }
        return true
    }

    // MARK: Projection (web `useMemo` derivations)

    /// Builds the full projection from the cached envelope, faithful to the web
    /// `SubscriptionsWidget` body (rows + activeCount + nextExpiry + entries).
    public static func build(
        data: [String: SubscriptionsValue]?,
        now: Date,
        format: SubscriptionsFormatting,
        localize: SubscriptionsLocalize
    ) -> SubscriptionsProjection {
        let parsed = parseSubscriptions(data, now: now, localize: localize)
        let rows = parsed.map { sub in
            SubscriptionRow(
                id: sub.name,
                name: sub.name,
                active: sub.active,
                valueText: valueText(for: sub, format: format),
                expiryDate: sub.expiryDate,
                daysLeft: sub.daysLeft
            )
        }
        let next = parsed
            .filter { $0.active && ($0.daysLeft ?? 0) > 0 }
            .min { ($0.daysLeft ?? .max) < ($1.daysLeft ?? .max) }

        return SubscriptionsProjection(
            rows: rows,
            activeCount: parsed.filter(\.active).count,
            nextExpiry: next.flatMap { sub in rows.first { $0.id == sub.name } },
            nextExpiryText: next.map { dateText($0.expiryDate, format: format) }
        )
    }

    /// Web detail `entry.value`: the expiry date when present, else the renewal
    /// type, else `—`.
    static func valueText(for sub: ParsedSubscription, format: SubscriptionsFormatting) -> String {
        if let expiry = sub.expiryDate {
            return dateText(expiry, format: format)
        }
        return sub.renewalType ?? "—"
    }
}
