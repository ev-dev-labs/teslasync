//
//  VehicleUpgradesWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  Pure parsers + projection builder — the unit-tested cached→projection adapter,
//  a faithful Swift port of the data pipeline in
//  features/dashboard/widgets/VehicleUpgradesWidget.tsx (`parseUpgrades`,
//  `daysUntil`, the active-share-link filter, the nearest-expiry sort, and the
//  date formatting). No SwiftUI / transport here — this is the deterministic core
//  iOS, iPadOS, macOS, and the web all agree on.
//

import Foundation

/// Pure adapters that normalize the raw upgrade envelope + cached share links into
/// an `UpgradesProjection`. Mirrors the web source exactly so every platform shows
/// the same upgrade rows, eligible count, active-link count, and nearest expiry.
public enum UpgradesProjectionBuilder {
    private static let secondsPerDay = 86400.0
    private static let unknownUpgradeName = "Unknown Upgrade"

    // MARK: parseUpgrades (web `parseUpgrades(data)`)

    /// Normalizes the raw envelope into display rows. The `.list` branch resolves
    /// `name ?? title ?? "Unknown Upgrade"`; the `.keyed` fallback resolves
    /// `name ?? key` (the web fallback never consults `title`). Both resolve
    /// `price ?? cost`, `description ?? summary`, and `eligible !== false`.
    public static func parseUpgrades(_ envelope: UpgradeEnvelope) -> [ParsedUpgrade] {
        switch envelope {
        case .none:
            []
        case let .list(rawUpgrades):
            rawUpgrades.map { raw in
                ParsedUpgrade(
                    name: raw.name.asString ?? raw.title.asString ?? unknownUpgradeName,
                    price: raw.price.asString ?? raw.cost.asString,
                    detail: raw.description.asString ?? raw.summary.asString,
                    eligible: raw.eligible != false
                )
            }
        case let .keyed(entries):
            entries.map { entry in
                ParsedUpgrade(
                    name: entry.upgrade.name.asString ?? entry.key,
                    price: entry.upgrade.price.asString ?? entry.upgrade.cost.asString,
                    detail: entry.upgrade.description.asString ?? entry.upgrade.summary.asString,
                    eligible: entry.upgrade.eligible != false
                )
            }
        }
    }

    /// Web `eligibleCount = upgrades.filter(u => u.eligible).length`.
    static func eligibleCount(_ upgrades: [ParsedUpgrade]) -> Int {
        upgrades.reduce(into: 0) { count, upgrade in
            if upgrade.eligible { count += 1 }
        }
    }

    // MARK: Share links (web `daysUntil` + active filter + nearest-expiry sort)

    /// Web `daysUntil(dateStr)` — whole days until expiry (`Math.ceil`), `nil` for a
    /// missing or unparseable date.
    static func daysUntil(_ iso: String?, now: Date) -> Int? {
        guard let iso, let expiry = parseDate(iso) else { return nil }
        let days = (expiry.timeIntervalSince(now) / secondsPerDay).rounded(.up)
        return Int(days)
    }

    /// Web active predicate: kept when there is no expiry, an unparseable expiry
    /// (`days == null`), or a positive remaining-days count (`days > 0`).
    static func isActive(_ link: ShareLinkInput, now: Date) -> Bool {
        guard let expiresAt = link.expiresAt, !expiresAt.isEmpty else { return true }
        guard let days = daysUntil(expiresAt, now: now) else { return true }
        return days > 0
    }

    /// Web `activeShareLinks` — the share links still considered live.
    static func activeShareLinks(_ links: [ShareLinkInput], now: Date) -> [ShareLinkInput] {
        links.filter { isActive($0, now: now) }
    }

    /// Web `nearestExpiry` — among active links *with* an expiry, the soonest one
    /// (ascending remaining days; unparseable expiries sink to the bottom).
    static func nearestExpiry(_ activeLinks: [ShareLinkInput], now: Date) -> ShareLinkInput? {
        activeLinks
            .filter { ($0.expiresAt?.isEmpty == false) }
            .min { lhs, rhs in
                expirySortKey(lhs, now: now) < expirySortKey(rhs, now: now)
            }
    }

    /// Web `daysUntil(...) ?? Infinity` sort key — unparseable expiries compare last.
    private static func expirySortKey(_ link: ShareLinkInput, now: Date) -> Double {
        guard let days = daysUntil(link.expiresAt, now: now) else { return .greatestFiniteMagnitude }
        return Double(days)
    }

    // MARK: Date formatting (web `useDateFormat().formatDate`)

    /// Web `formatDate(date)` — `{year:'numeric', month:'short', day:'numeric'}`
    /// (`DateFormatter.medium`), `"—"` for null / invalid (web `?? '—'`).
    static func dateText(_ iso: String?, format: UpgradesFormatting) -> String {
        guard let iso, let date = parseDate(iso) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: format.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: format.timeZoneIdentifier) ?? .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
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

    // MARK: Projection (web body)

    /// Builds the full projection from the raw upgrade envelope + cached share
    /// links, faithful to the web `VehicleUpgradesWidget` body.
    public static func build(
        envelope: UpgradeEnvelope,
        shareLinks: [ShareLinkInput],
        format: UpgradesFormatting
    ) -> UpgradesProjection {
        let upgrades = parseUpgrades(envelope)
        let active = activeShareLinks(shareLinks, now: format.now)
        let nearest = nearestExpiry(active, now: format.now)
        let nearestText = nearest.map { dateText($0.expiresAt, format: format) }
        let hasData = !upgrades.isEmpty || !shareLinks.isEmpty
        return UpgradesProjection(
            upgrades: upgrades,
            eligibleCount: eligibleCount(upgrades),
            activeShareLinkCount: active.count,
            nearestExpiryText: nearestText,
            currencySymbol: format.currencySymbol,
            hasData: hasData
        )
    }
}
