//
//  RecentActivity.Adapter.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  The testable projection core for the dashboard "Recent Activity" surface — the faithful port
//  of features/dashboard/components/RecentActivity.tsx. Everything here is pure and dependency-
//  free (Foundation only) so the unified activity feed, the battery-trend series, the fleet-
//  performance read, the relative-time formatting, and the VoiceOver summaries are all unit-tested
//  without a bundle or a rendered view. The value types live in RecentActivity.Types.swift.
//
//  Web parity notes:
//    • Activity feed: each drive → "{dist} {unit} drive", each charge → "{kWh} kWh charged",
//      merged and sorted newest-first; the timeline shows the first eight.
//    • Battery trend: each drive's end SoC (`?? 50`), mapped then reversed (web `.reverse()`).
//    • Fleet performance: total drives / charge sessions (raw), total cost (Currency, 2 dp), CO₂
//      saved (`energy_kwh * 0.42` kg via fmtInt), + the optional most-efficient highlight.
//    • Symbols (%, →, ·, h, m, kWh, kg) are locale-neutral literals, exactly as the web builds
//      them in template strings and as the QuickMetrics precedent treats "h"/"m"/"kWh". Words
//      (drive / charged / relative time / panel titles / labels / empties) resolve through the
//      injected localizer so the view holds no hardcoded English.
//

import Foundation

// MARK: - Number / time formatting (web fmtNumber / fmtInt / Currency / formatTimeAgo)

/// Pure formatting helpers reproducing the web `lib/numberFormat.ts` (`safeNumber`, `fmtNumber`,
/// `fmtInt`), the `<Currency>` renderer, the `lib/unitConversion.ts` SI converters, the
/// `lib/dateFormat.ts` `formatDateShort`, and the component's local `formatTimeAgo`.
public enum RecentActivityFormat {
    public static let emDash = "—"
    public static let kilowattHourSymbol = "kWh"
    public static let kilogramSymbol = "kg"
    public static let percentSymbol = "%"
    public static let socUnknown = "?"
    public static let arrow = "→"
    public static let separator = "·"
    public static let metersPerMile = 1609.344
    public static let metersPerKilometer = 1000.0
    public static let co2KgPerKwh = 0.42

    /// Resolves a BCP-47 tag to a `Locale`, falling back to en-US for an empty/absent tag (web
    /// `setGlobalLocale` fallback).
    public static func locale(_ identifier: String?) -> Locale {
        guard let identifier, !identifier.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en-US")
        }
        return Locale(identifier: identifier)
    }

    /// Web `safeNumber(v)`: a finite number, else `0`.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of fraction
    /// digits, half-away-from-zero rounding, non-finite → 0.
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let safeValue = safe(value)
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(decimals)f", safeValue)
    }

    /// Web `fmtInt(v)` → `fmtNumber(v, 0)`.
    public static func int(_ value: Double, locale: Locale) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Web `<Currency value precision>`: the symbol prefixed to the grouped amount; the em-dash
    /// (the `Currency` fallback) for a non-finite amount.
    public static func currency(_ value: Double, symbol: String, decimals: Int, locale: Locale) -> String {
        guard value.isFinite else { return emDash }
        return symbol + number(value, decimals: decimals, locale: locale)
    }

    /// Web `convertDistanceFromSI(meters, unit)`: meters → miles or kilometers.
    public static func distanceFromSI(_ meters: Double, unit: String) -> Double {
        unit == "mi" ? safe(meters) / metersPerMile : safe(meters) / metersPerKilometer
    }

    /// Web `convertEnergyFromSI(wh, 'kWh')`.
    public static func energyKwhFromWh(_ wattHours: Double) -> Double {
        safe(wattHours) / 1000
    }

    /// Web `{soc ?? '?'}%`.
    public static func soc(_ pct: Int?) -> String {
        "\(pct.map(String.init) ?? socUnknown)\(percentSymbol)"
    }

    /// Web `{start}% → {end}%`.
    public static func socRange(start: Int?, end: Int?) -> String {
        "\(soc(start)) \(arrow) \(soc(end))"
    }

    /// Web `formatDateShort`: a locale-aware "MMM d" body.
    public static func dateShort(_ date: Date, locale: Locale) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().locale(locale))
    }

    /// Web `formatTimeAgo`: "Just now" / "{m}m ago" / "{h}h ago" / "{d}d ago", else the short
    /// date. The number words resolve through the injected localizer; the format string carries a
    /// `%d` so a non-en locale can reorder it.
    public static func timeAgo(
        from date: Date,
        relativeTo now: Date,
        locale: Locale,
        localize: (String, String) -> String
    ) -> String {
        let minutes = Int((now.timeIntervalSince(date) / 60).rounded(.down))
        if minutes < 1 {
            return localize("activity.relative.justNow", "Just now")
        }
        if minutes < 60 {
            return String(format: localize("activity.relative.minutes", "%dm ago"), minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return String(format: localize("activity.relative.hours", "%dh ago"), hours)
        }
        let days = hours / 24
        if days < 7 {
            return String(format: localize("activity.relative.days", "%dd ago"), days)
        }
        return dateShort(date, locale: locale)
    }
}

// MARK: - Projection (pure, web-parity)

/// The dependency-free projection from the cached snapshot to the three panels' view models. A
/// faithful port of the web component's read of `recentDrives` / `recentCharges` / `analytics`.
public enum RecentActivityProjection {
    /// The web `Timeline` cap (`activityItems.slice(0, 8)`).
    public static let timelineLimit = 8

    /// The web `end_soc_pct ?? 50` battery-trend default.
    public static let batteryDefaultSoc = 50

    /// Whether any of the three panels has real data — gates the surface's content/empty phase
    /// (each panel still renders its own internal empty for partial data).
    public static func hasData(
        drives: [RecentActivityDrive],
        charges: [RecentActivityCharge],
        analytics: RecentActivityAnalytics?
    ) -> Bool {
        !drives.isEmpty || !charges.isEmpty || analytics != nil
    }

    /// Builds the unified, newest-first activity feed (web `activityItems` + sort). Drive and
    /// charge rows are built by focused helpers so each stays small.
    public static func activityItems(
        drives: [RecentActivityDrive],
        charges: [RecentActivityCharge],
        units: RecentActivityUnits,
        now: Date,
        localize: (String, String) -> String
    ) -> [RecentActivityItem] {
        let locale = RecentActivityFormat.locale(units.localeIdentifier)
        var items = drives.map { driveItem($0, units: units, locale: locale, now: now, localize: localize) }
        items += charges.map { chargeItem($0, units: units, locale: locale, now: now, localize: localize) }
        return items.sorted { ($0.timestamp ?? .distantPast) > ($1.timestamp ?? .distantPast) }
    }

    /// One drive feed row: "{dist} {unit} drive" + "{h}h {m}m · {start}% → {end}%".
    private static func driveItem(
        _ drive: RecentActivityDrive,
        units: RecentActivityUnits,
        locale: Locale,
        now: Date,
        localize: (String, String) -> String
    ) -> RecentActivityItem {
        let unit = units.distanceUnit == "mi" ? "mi" : "km"
        let distance = RecentActivityFormat.distanceFromSI(drive.distanceM, unit: unit)
        let word = localize("activity.drive", "drive")
        let amount = RecentActivityFormat.number(distance, decimals: 1, locale: locale)
        let total = RecentActivityFormat.safe(drive.durationS)
        let hours = Int((total / 3600).rounded(.down))
        let minutes = Int((total.truncatingRemainder(dividingBy: 3600) / 60).rounded(.down))
        let minuteText = RecentActivityFormat.int(Double(minutes), locale: locale)
        let range = RecentActivityFormat.socRange(start: drive.startSocPct, end: drive.endSocPct)
        return RecentActivityItem(
            id: "drive-\(drive.id)",
            kind: .drive,
            title: "\(amount) \(units.distanceUnit) \(word)",
            subtitle: "\(hours)h \(minuteText)m \(RecentActivityFormat.separator) \(range)",
            timeAgo: relativeTime(drive.startedAt, locale: locale, now: now, localize: localize),
            timestamp: drive.startedAt
        )
    }

    /// One charge feed row: "{kWh} kWh charged" + "{start}% → {end}%[ · {cost}]".
    private static func chargeItem(
        _ charge: RecentActivityCharge,
        units: RecentActivityUnits,
        locale: Locale,
        now: Date,
        localize: (String, String) -> String
    ) -> RecentActivityItem {
        let kwh = RecentActivityFormat.energyKwhFromWh(charge.energyAddedWh)
        let word = localize("activity.charged", "charged")
        let value = RecentActivityFormat.number(kwh, decimals: 1, locale: locale)
        var subtitle = RecentActivityFormat.socRange(start: charge.startSocPct, end: charge.endSocPct)
        if let cost = charge.cost, cost.isFinite {
            let money = RecentActivityFormat.currency(cost, symbol: units.currencySymbol, decimals: 2, locale: locale)
            subtitle += " \(RecentActivityFormat.separator) \(money)"
        }
        return RecentActivityItem(
            id: "charge-\(charge.id)",
            kind: .charge,
            title: "\(value) \(RecentActivityFormat.kilowattHourSymbol) \(word)",
            subtitle: subtitle,
            timeAgo: relativeTime(charge.startedAt, locale: locale, now: now, localize: localize),
            timestamp: charge.startedAt
        )
    }

    private static func relativeTime(
        _ date: Date?,
        locale: Locale,
        now: Date,
        localize: (String, String) -> String
    ) -> String {
        guard let date else { return RecentActivityFormat.emDash }
        return RecentActivityFormat.timeAgo(from: date, relativeTo: now, locale: locale, localize: localize)
    }

    /// The first `timelineLimit` feed rows (web `activityItems.slice(0, 8)`).
    public static func timeline(_ items: [RecentActivityItem]) -> [RecentActivityItem] {
        Array(items.prefix(timelineLimit))
    }

    /// Builds the battery-trend points (web `map((d, i) => { i, v }).reverse()`). `position` is
    /// the post-reverse plot order; `label` keeps the original index as the web x tick.
    public static func batteryTrend(from drives: [RecentActivityDrive]) -> [RecentActivityBatteryPoint] {
        let mapped = drives.enumerated().map { index, drive in
            (label: String(index), value: Double(drive.endSocPct ?? batteryDefaultSoc))
        }
        return mapped.reversed().enumerated().map { position, point in
            RecentActivityBatteryPoint(id: String(position), position: position, label: point.label, value: point.value)
        }
    }

    /// Builds the fleet-performance view model (web performance panel). The two counts render raw
    /// (web `{value}`); cost via Currency (2 dp); CO₂ via fmtInt; efficiency via fmtInt.
    public static func performance(
        from analytics: RecentActivityAnalytics?,
        units: RecentActivityUnits
    ) -> RecentActivityPerformance {
        let locale = RecentActivityFormat.locale(units.localeIdentifier)
        let energyKwh = RecentActivityFormat.safe(analytics?.totalEnergyKwh ?? 0)
        let co2 = energyKwh * RecentActivityFormat.co2KgPerKwh
        let cost = RecentActivityFormat.currency(
            analytics?.totalCost ?? 0,
            symbol: units.currencySymbol,
            decimals: 2,
            locale: locale
        )
        let metrics = [
            RecentActivityMetric(
                id: "drives",
                labelKey: "perf.drives",
                labelFallback: "Total Drives (30d)",
                value: String(analytics?.totalDrives ?? 0),
                tone: .primary
            ),
            RecentActivityMetric(
                id: "charges",
                labelKey: "perf.charges",
                labelFallback: "Charge Sessions",
                value: String(analytics?.totalChargingSessions ?? 0),
                tone: .primary
            ),
            RecentActivityMetric(
                id: "cost",
                labelKey: "perf.cost",
                labelFallback: "Total Cost",
                value: cost,
                tone: .warning
            ),
            RecentActivityMetric(
                id: "co2",
                labelKey: "perf.co2",
                labelFallback: "CO₂ Saved",
                value: "\(RecentActivityFormat.int(co2, locale: locale)) \(RecentActivityFormat.kilogramSymbol)",
                tone: .success
            )
        ]
        return RecentActivityPerformance(
            metrics: metrics,
            mostEfficient: highlight(analytics, units: units, locale: locale)
        )
    }

    private static func highlight(
        _ analytics: RecentActivityAnalytics?,
        units: RecentActivityUnits,
        locale: Locale
    ) -> RecentActivityEfficientHighlight? {
        guard let vehicle = analytics?.mostEfficientVehicle else { return nil }
        let efficiency = RecentActivityFormat.safe(vehicle.efficiencyWhKm) * units.efficiencyFactor
        let value = "\(RecentActivityFormat.int(efficiency, locale: locale)) \(units.efficiencyUnit)"
        return RecentActivityEfficientHighlight(name: vehicle.name, value: value)
    }

    /// Resolves the render phase from the load status + whether any panel has data. Cached data
    /// stays `.content` through a failure so the freshness chip / banner flag staleness rather
    /// than blanking the surface.
    public static func resolvePhase(_ status: RecentActivityLoadStatus, hasData: Bool) -> RecentActivityPhase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle, exactly like the view's P1/S10 facade.
public enum RecentActivityAccessibility {
    /// One feed row's spoken value: "{title}, {subtitle}, {time}".
    public static func itemLabel(_ item: RecentActivityItem) -> String {
        [item.title, item.subtitle, item.timeAgo]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }

    /// One performance row's spoken value: "{label}: {value}".
    public static func metricLabel(_ metric: RecentActivityMetric, localize: (String, String) -> String) -> String {
        "\(localize(metric.labelKey, metric.labelFallback)): \(metric.value)"
    }

    /// The container summary: the surface label plus a count of feed rows, or the friendly empty
    /// message when there is none.
    public static func summary(itemCount: Int, localize: (String, String) -> String) -> String {
        let title = localize("activity.title", "Recent Activity")
        guard itemCount > 0 else {
            return "\(title): \(localize("activity.empty", "No activity yet. Start driving!"))"
        }
        return "\(title): \(String(format: localize("activity.a11y.count", "%d recent events"), itemCount))"
    }
}
