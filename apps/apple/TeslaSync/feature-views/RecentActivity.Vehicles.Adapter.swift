//
//  RecentActivity.Vehicles.Adapter.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  The testable projection core for the vehicles "Recent Activity" surface — the faithful port of
//  features/vehicles/components/RecentActivity.tsx. Everything here is pure and dependency-free
//  (Foundation only) so the recent-drives + recent-charges rows, the distance / energy / duration /
//  SoC formatting, the timestamp rendering, and the VoiceOver summaries are all unit-tested without
//  a bundle or a rendered view. The value types live in RecentActivity.Vehicles.Types.swift.
//
//  Web parity notes:
//    • Drives panel: `drives.slice(0, 5)` in source order; each row is
//      "{convertDistanceFromSI(distance_m, unit)} {unit}" (1 dp) + `<TimeStamp start_ts>` +
//      "{floor(duration_s/3600)}h {fmtInt(floor((duration_s%3600)/60))}m" + (when both SoC present)
//      "{start}% → {end}%".
//    • Charges panel: `sessions.slice(0, 5)` in source order; each row is
//      "{convertEnergyFromSI(total_energy_added_wh, 'kWh')} kWh" (1 dp) + `<TimeStamp start_ts>` +
//      "{Xh Ym}" + (when end SoC present) "{start}% → {end}%".
//    • Symbols (%, →, h, m, kWh) are locale-neutral literals exactly as the web builds them in
//      template strings; the unit label comes from the user's preference; all words (titles,
//      "View all", empties, relative time) resolve through the injected localizer so the view holds
//      no hardcoded English.
//

import Foundation

// MARK: - Number / time formatting (web fmtInt / AnimatedNumber / convert*FromSI / TimeStamp)

/// Pure formatting helpers reproducing the web `lib/numberFormat.ts` (`safeNumber`, `fmtInt`), the
/// `AnimatedNumber` fixed-decimal body, the `lib/unitConversion.ts` SI converters, and the
/// `<TimeStamp>` relative / absolute bodies.
public enum VehicleRecentActivityFormat {
    public static let emDash = "—"
    public static let kilowattHourSymbol = "kWh"
    public static let percentSymbol = "%"
    public static let socUnknown = "?"
    public static let arrow = "→"
    public static let wattHoursPerKilowattHour = 1000.0

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

    /// Web `fmtNumber(v, decimals)` / `AnimatedNumber`: locale-aware grouped formatting at a fixed
    /// number of fraction digits, half-away-from-zero rounding, non-finite → 0.
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

    /// Web `convertDistanceFromSI(meters, unit)`: meters ÷ the unit's meters-per-unit divisor.
    public static func distanceFromSI(_ meters: Double, divisor: Double) -> Double {
        let safeDivisor = divisor.isFinite && divisor != 0 ? divisor : 1
        return safe(meters) / safeDivisor
    }

    /// Web `convertEnergyFromSI(wh, 'kWh')`.
    public static func energyKwhFromWh(_ wattHours: Double) -> Double {
        safe(wattHours) / wattHoursPerKilowattHour
    }

    /// The "{h}h {m}m" duration body (web `${floor(s/3600)}h ${fmtInt(floor((s%3600)/60))}m`).
    public static func duration(seconds: Double, locale: Locale) -> String {
        let total = safe(seconds)
        let hours = Int((total / 3600).rounded(.down))
        let minutes = Int((total.truncatingRemainder(dividingBy: 3600) / 60).rounded(.down))
        return "\(hours)h \(int(Double(minutes), locale: locale))m"
    }

    /// Web `{soc ?? '?'}%`.
    public static func soc(_ pct: Int?) -> String {
        "\(pct.map(String.init) ?? socUnknown)\(percentSymbol)"
    }

    /// Web `{start}% → {end}%`.
    public static func socRange(start: Int?, end: Int?) -> String {
        "\(soc(start)) \(arrow) \(soc(end))"
    }

    /// Web `formatRelative`: "Just now" / "{m}m ago" / "{h}h ago" / "{d}d ago", else the short date.
    /// The number words resolve through the injected localizer; the format carries a `%d` so a
    /// non-en locale can reorder it.
    public static func relative(
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
        return absolute(date, locale: locale)
    }

    /// Web `formatDateTime`: a locale-aware "MMM d, h:mm a" body (the `<TimeStamp>` absolute view).
    public static func absolute(_ date: Date, locale: Locale) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().hour().minute().locale(locale))
    }
}

// MARK: - Projection (pure, web-parity)

/// The dependency-free projection from the cached snapshot to the two panels' row view models. A
/// faithful port of the web component's read of `drives` / `sessions`.
public enum VehicleRecentActivityProjection {
    /// The web `slice(0, 5)` cap each panel applies.
    public static let rowLimit = 5

    /// Whether either panel has real data — gates the surface's content/empty phase (each panel
    /// still renders its own internal empty for partial data, exactly like the web source).
    public static func hasData(
        drives: [VehicleRecentActivityDrive],
        charges: [VehicleRecentActivityCharge]
    ) -> Bool {
        !drives.isEmpty || !charges.isEmpty
    }

    /// The recent-drives rows (web `drives.slice(0, 5).map(...)`), in source order.
    public static func driveRows(
        drives: [VehicleRecentActivityDrive],
        units: VehicleRecentActivityUnits,
        now: Date,
        localize: (String, String) -> String
    ) -> [VehicleRecentActivityRow] {
        let locale = VehicleRecentActivityFormat.locale(units.localeIdentifier)
        return drives.prefix(rowLimit).map { driveRow($0, units: units, locale: locale, now: now, localize: localize) }
    }

    /// The recent-charges rows (web `sessions.slice(0, 5).map(...)`), in source order.
    public static func chargeRows(
        charges: [VehicleRecentActivityCharge],
        units: VehicleRecentActivityUnits,
        now: Date,
        localize: (String, String) -> String
    ) -> [VehicleRecentActivityRow] {
        let locale = VehicleRecentActivityFormat.locale(units.localeIdentifier)
        return charges.prefix(rowLimit)
            .map { chargeRow($0, units: units, locale: locale, now: now, localize: localize) }
    }

    /// One drive row: "{dist} {unit}" + timestamp + "{Xh Ym}" + (both SoC present) "{start}% → {end}%".
    private static func driveRow(
        _ drive: VehicleRecentActivityDrive,
        units: VehicleRecentActivityUnits,
        locale: Locale,
        now: Date,
        localize: (String, String) -> String
    ) -> VehicleRecentActivityRow {
        let distance = VehicleRecentActivityFormat.distanceFromSI(drive.distanceM, divisor: units.distanceDivisor)
        let amount = VehicleRecentActivityFormat.number(distance, decimals: 1, locale: locale)
        let times = timestamps(drive.startedAt, units: units, locale: locale, now: now, localize: localize)
        let soc = drive.startSocPct != nil && drive.endSocPct != nil
            ? VehicleRecentActivityFormat.socRange(start: drive.startSocPct, end: drive.endSocPct)
            : nil
        return VehicleRecentActivityRow(
            id: "drive-\(drive.id)",
            kind: .drive,
            value: "\(amount) \(units.distanceUnit)",
            timeText: times.primary,
            alternateTimeText: times.alternate,
            durationText: VehicleRecentActivityFormat.duration(seconds: drive.durationS, locale: locale),
            socRange: soc,
            routeID: drive.id
        )
    }

    /// One charge row: "{kWh} kWh" + timestamp + "{Xh Ym}" + (end SoC present) "{start}% → {end}%".
    private static func chargeRow(
        _ charge: VehicleRecentActivityCharge,
        units: VehicleRecentActivityUnits,
        locale: Locale,
        now: Date,
        localize: (String, String) -> String
    ) -> VehicleRecentActivityRow {
        let kwh = VehicleRecentActivityFormat.energyKwhFromWh(charge.energyAddedWh)
        let value = VehicleRecentActivityFormat.number(kwh, decimals: 1, locale: locale)
        let times = timestamps(charge.startedAt, units: units, locale: locale, now: now, localize: localize)
        let soc = charge.endSocPct != nil
            ? VehicleRecentActivityFormat.socRange(start: charge.startSocPct, end: charge.endSocPct)
            : nil
        return VehicleRecentActivityRow(
            id: "charge-\(charge.id)",
            kind: .charge,
            value: "\(value) \(VehicleRecentActivityFormat.kilowattHourSymbol)",
            timeText: times.primary,
            alternateTimeText: times.alternate,
            durationText: VehicleRecentActivityFormat.duration(seconds: charge.durationS, locale: locale),
            socRange: soc,
            routeID: charge.id
        )
    }

    /// The primary + alternate timestamp bodies for a row (web `<TimeStamp>` body + tooltip). When
    /// the instant is absent the web renders the em-dash with no alternate.
    private static func timestamps(
        _ date: Date?,
        units: VehicleRecentActivityUnits,
        locale: Locale,
        now: Date,
        localize: (String, String) -> String
    ) -> (primary: String, alternate: String) {
        guard let date else { return (VehicleRecentActivityFormat.emDash, "") }
        let relative = VehicleRecentActivityFormat.relative(
            from: date,
            relativeTo: now,
            locale: locale,
            localize: localize
        )
        let absolute = VehicleRecentActivityFormat.absolute(date, locale: locale)
        return units.timeStyle == .relative ? (relative, absolute) : (absolute, relative)
    }

    /// Resolves the render phase from the load status + whether either panel has data. Cached data
    /// stays `.content` through a failure so the freshness chip / banner flag staleness rather than
    /// blanking the surface.
    public static func resolvePhase(
        _ status: VehicleRecentActivityLoadStatus,
        hasData: Bool
    ) -> VehicleRecentActivityPhase {
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
public enum VehicleRecentActivityAccessibility {
    /// One row's spoken value: "{value}, {time}, {duration}[, {socRange}]".
    public static func rowLabel(_ row: VehicleRecentActivityRow) -> String {
        [row.value, row.timeText, row.durationText, row.socRange ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }

    /// The container summary: the surface label plus the recent-drive / recent-charge counts, or a
    /// friendly empty message when neither panel has rows.
    public static func summary(
        driveCount: Int,
        chargeCount: Int,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("activity.title", "Recent Activity")
        guard driveCount > 0 || chargeCount > 0 else {
            return "\(title): \(localize("activity.empty", "No recent activity"))"
        }
        let drives = String(format: localize("activity.a11y.drives", "%d recent drives"), driveCount)
        let charges = String(format: localize("activity.a11y.charges", "%d recent charges"), chargeCount)
        return "\(title): \(drives), \(charges)"
    }
}
