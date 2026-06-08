//
//  MaintenanceTrackerWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  Pure parsers + projection builder — the unit-tested cached→projection adapter,
//  a faithful Swift port of the data pipeline in
//  features/dashboard/widgets/MaintenanceTrackerWidget.tsx (sort, urgency, the
//  distance/currency/number/date formatting, and the timeline mapping). No
//  SwiftUI / transport here — this is the deterministic core both platforms agree
//  on.
//

import Foundation

/// Pure adapters that merge cached maintenance/service DTOs into a
/// `MaintenanceProjection`. Mirrors the web source exactly so iOS, iPadOS, macOS,
/// and the web render the same numbers.
public enum MaintenanceProjectionBuilder {
    // Web `lib/unitConversion.ts` constants — `convertDistanceFromSI` divisors.
    private static let metersPerKm = 1000.0
    private static let metersPerMile = 1609.344
    private static let metersPerFoot = 0.3048

    /// The km→mile factor the web source multiplies odometer/interval kilometres by
    /// *before* handing the value to `convertDistanceFromSI`
    /// (MaintenanceTrackerWidget.tsx L90 + L184). The factor is replicated verbatim
    /// so the native surface renders byte-identical distance numbers to the web —
    /// parity over "correctness", per the per-surface parity covenant.
    private static let webKmToMileFactor = 0.621371

    // MARK: Urgency (web `getUrgency`)

    /// Heuristic urgency from the interval months remaining (web `getUrgency`).
    public static func urgency(forIntervalMonths months: Double) -> MaintenanceUrgency {
        if months <= 0 { return .overdue }
        if months <= 3 { return .soon }
        return .good
    }

    // MARK: Distance (web `convertDistanceFromSI` + the km×factor display path)

    /// Web `convertDistanceFromSI(meters, to)` — the argument is treated as metres
    /// and divided by the unit's metre-count. Unknown units fall back to miles
    /// (the web type only emits `km` / `mi` / `ft`).
    static func convertDistanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "km": meters / metersPerKm
        case "ft": meters / metersPerFoot
        default: meters / metersPerMile
        }
    }

    /// Web `${fmtNumber(toDistanceDisplay(km * 0.621371), 0)} ${distanceUnit}`.
    static func distanceText(fromKm kilometres: Double, format: MaintenanceFormatting) -> String {
        let converted = convertDistanceFromSI(kilometres * webKmToMileFactor, to: format.distanceUnit)
        let number = decimalString(converted, fractionDigits: 0, locale: format.localeIdentifier)
        return "\(number) \(format.distanceUnit)"
    }

    // MARK: Number / currency / date formatting (web fmtNumber / formatCurrency / formatDate)

    /// Web `fmtNumber(value, decimals)` — locale-grouped, fixed-fraction number.
    /// Non-finite input collapses to `0` (web `safeNumber`).
    static func decimalString(_ value: Double, fractionDigits: Int, locale: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: locale)
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? "\(Int(safe))"
    }

    /// Web `formatCurrency(amount)` = `${currencySymbol}${fmtNumber(amount, precision)}`.
    static func currencyText(_ amount: Double, format: MaintenanceFormatting) -> String {
        let number = decimalString(amount, fractionDigits: format.currencyPrecision, locale: format.localeIdentifier)
        return "\(format.currencySymbol)\(number)"
    }

    /// Web `formatDate(date)` — medium localized date, `'—'` for null / invalid
    /// (web `year:'numeric', month:'short', day:'numeric'` ⇒ `DateFormatter.medium`).
    static func dateText(_ iso: String?, format: MaintenanceFormatting) -> String {
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

    // MARK: Projection (web `useMemo` sort + map pipeline)

    /// Builds the full projection from the cached maintenance items + service
    /// records, faithful to the web `MaintenanceTrackerWidget` body.
    public static func build(
        maintenance: [MaintenanceItemInput],
        records: [ServiceRecordInput],
        format: MaintenanceFormatting
    ) -> MaintenanceProjection {
        let next = nextService(from: maintenance, format: format)
        let timeline = recentTimeline(maintenance: maintenance, records: records, format: format)
        let hasData = !maintenance.isEmpty || !records.isEmpty
        return MaintenanceProjection(next: next, timeline: timeline, hasData: hasData)
    }

    /// Web `sortedItems[0]` — the soonest item (ascending interval months).
    static func nextService(
        from maintenance: [MaintenanceItemInput],
        format: MaintenanceFormatting
    ) -> MaintenanceNextService? {
        guard let item = maintenance.min(by: { ($0.intervalMonths ?? 0) < ($1.intervalMonths ?? 0) }) else {
            return nil
        }
        let months = item.intervalMonths ?? 0
        var costText: String?
        if let cost = item.estimatedCostUsd, cost > 0 {
            costText = currencyText(cost, format: format)
        }
        return MaintenanceNextService(
            name: item.name ?? "—",
            urgency: urgency(forIntervalMonths: months),
            intervalMonths: months,
            monthsText: decimalString(months, fractionDigits: 0, locale: format.localeIdentifier),
            distanceText: distanceText(fromKm: item.intervalKm ?? 0, format: format),
            costText: costText
        )
    }

    /// Web `recentRecords` (date desc, top 3) mapped to timeline rows, looking up
    /// each record's item name by `itemId`.
    static func recentTimeline(
        maintenance: [MaintenanceItemInput],
        records: [ServiceRecordInput],
        format: MaintenanceFormatting
    ) -> [MaintenanceTimelineRow] {
        let itemsById = Dictionary(maintenance.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        let recent = records
            .sorted { sortKey($0.date) > sortKey($1.date) }
            .prefix(3)
        return Array(recent.enumerated()).map { index, record in
            let item = record.itemId.flatMap { itemsById[$0] }
            let odometer = decimalString(
                convertDistanceFromSI((record.odometerKm ?? 0) * webKmToMileFactor, to: format.distanceUnit),
                fractionDigits: 0,
                locale: format.localeIdentifier
            )
            let base = "\(odometer) \(format.distanceUnit)"
            let subtitle = (record.notes?.isEmpty == false) ? "\(base) · \(record.notes ?? "")" : base
            return MaintenanceTimelineRow(
                id: "\(record.itemId ?? "record")-\(index)",
                title: item?.name ?? record.itemId ?? "—",
                subtitle: subtitle,
                time: dateText(record.date, format: format)
            )
        }
    }

    /// Sort key for "date desc": a parseable timestamp, with missing / invalid
    /// dates sinking to the bottom (the web's `new Date('').getTime()` is `NaN`,
    /// whose comparator order is undefined — this makes it deterministic).
    private static func sortKey(_ iso: String?) -> Double {
        guard let iso, let date = parseDate(iso) else { return -Double.greatestFiniteMagnitude }
        return date.timeIntervalSince1970
    }
}
