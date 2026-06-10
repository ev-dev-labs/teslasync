//
//  TeslaApiUsageCard.Adapter.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The testable, dependency-free projection core for the operator-grade Tesla Fleet API spend +
//  volume card — the SwiftUI parity of features/system/components/status/TeslaApiUsageCard.tsx and
//  the shared <UsageCard> primitive it feeds (components/data-display/UsageCard.tsx). Everything
//  here is pure Foundation (no store, no SwiftUI, no bundle) so the number formatting, the
//  billing-window month math, the budget / error-rate intent thresholds, and the by_service /
//  by_method de-duplication are all unit tested in isolation against the exact web arithmetic.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the arithmetic):
//    • fmtNumber(v,d)  = safeNumber(v).toLocaleString(locale, {min/maxFractionDigits: d})
//                        (locale grouping, half-up rounding, non-finite ⇒ 0).
//    • fmtInt(v)       = fmtNumber(v, 0); fmtPercent(v,d) = `${fmtNumber(v,d)}%`.
//    • fmtCount(n)     = (n == null || !finite) ? "—" : fmtInt(n).
//    • formatCurrency  = `${currencySymbol}${fmtNumber(amount, precision)}`.
//    • derived         = month-window math: totalDaysInMonth = ceil((monthEnd-monthStart)/dayMs),
//                        daysElapsed = max(1, ceil((now-monthStart)/dayMs)),
//                        daysRemaining = max(0, total-elapsed),
//                        pctOfBudget = monthlyCredit>0 ? estimatedCost/monthlyCredit*100 : 0,
//                        dailyAvgCost = estimatedCost/elapsed, dailyAvgRequests = totalRequests/elapsed,
//                        forecastFromMtd = dailyAvgCost*total, last24hBurn = (last24h ?? 0)*costPerRequest,
//                        forecastFromRecent = last24hBurn*total.
//    • dedupeMap       = collapses camelCaseKeys()'s snake↔camel clones: drops a camelCase key when
//                        its snake_case alias is present, then de-dups on the underscore-stripped
//                        lowercase normal form, preserving wire order (web Object.entries order).
//

import Foundation

// MARK: - Number / currency formatting (port of numberFormat.ts + useFormatting)

/// Pure number + currency formatting ported from the web helpers so the rounding, the grouping
/// separators, the integer (`fmtInt`) path, the percent suffix, and the `formatCurrency` prefix
/// match the source exactly. The web global precision is 2 and `safeNumber` coerces non-finite
/// input to 0; both are reproduced here. Locale is injectable so the output is deterministic
/// under test.
public enum TeslaApiUsageNumber {
    /// The em-dash sentinel the web renders for a missing-value cell (`fmtCount(null)`).
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits, half-up
    /// rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)`: locale grouping, no fraction digits.
    public static func integer(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Native port of `fmtPercent(v, decimals)` — `${fmtNumber(v, decimals)}%`.
    public static func percent(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        number(value, decimals: decimals, locale: locale) + "%"
    }

    /// Native port of the card's `fmtCount(n)` — the em-dash for null / non-finite, else `fmtInt(n)`.
    /// Optional input so the web `logStats?.last24h != null` guarded calls reproduce exactly.
    public static func count(_ value: Double?, locale: Locale = .current) -> String {
        guard let value, value.isFinite else { return dash }
        return integer(value, locale: locale)
    }

    /// A bare, non-grouped integer string — the native peer of the web `${Math.round(ms)}`
    /// template literal (avg-latency milliseconds), rendered WITHOUT a thousands separator.
    /// Non-finite ⇒ 0; rounds half away from zero (matches `Math.round` for non-negative input).
    public static func plainInt(_ value: Double) -> String {
        String(Int(safe(value).rounded()))
    }

    /// Native port of `useFormatting().formatCurrency(amount, decimals)` —
    /// `${currencySymbol}${fmtNumber(amount, d)}` with the symbol prefixed directly. `precision`
    /// is the resolved `decimals ?? userPrecision` from the web hook (defaults to 2).
    public static func currency(
        _ amount: Double,
        symbol: String,
        precision: Int,
        locale: Locale = .current
    ) -> String {
        symbol + number(amount, decimals: precision, locale: locale)
    }
}

// MARK: - Visual intent (web `UsageCardIntent`)

/// The accent intent driving the budget bar / band rings / detail value colour / banner tint — the
/// native port of the web `UsageCardIntent` union (`'normal' | 'warn' | 'danger'`).
public enum TeslaApiUsageIntent: String, Sendable, Equatable, CaseIterable {
    case normal
    case warn
    case danger

    /// The card's budget heuristic (web `budgetIntent`): over the monthly credit ⇒ `danger`; else
    /// `warn` above 80 % of the credit; else `normal`. The `> 80` threshold + the strict
    /// `estimatedCost > monthlyCredit` over-budget test are reproduced verbatim.
    public static func forBudget(
        estimatedCost: Double,
        monthlyCredit: Double,
        pctOfBudget: Double
    ) -> TeslaApiUsageIntent {
        if estimatedCost > monthlyCredit { return .danger }
        return pctOfBudget > 80 ? .warn : .normal
    }

    /// The card's error-rate heuristic (web `errorIntent`): a percentage already (errorCount/total
    /// × 100). `nil` ⇒ normal; `>= 5` ⇒ danger; `>= 1` ⇒ warn; else normal.
    public static func forErrorRate(_ errorPct: Double?) -> TeslaApiUsageIntent {
        guard let errorPct else { return .normal }
        if errorPct >= 5 { return .danger }
        if errorPct >= 1 { return .warn }
        return .normal
    }
}

// MARK: - Input DTOs (web hook payloads)

/// The bare `/system/api-usage` snapshot — the native mirror of `APIUsage` (api/types.ts). Carried
/// as `Double` so the web `number`-typed JSON + the `safeNumber` non-finite guard port exactly.
public struct TeslaApiUsage: Sendable, Equatable {
    public var totalRequests: Double
    public var skippedPolls: Double
    public var estimatedCost: Double
    public var costPerRequest: Double
    public var monthlyCredit: Double
    public var estimatedRemaining: Double

    public init(
        totalRequests: Double = 0,
        skippedPolls: Double = 0,
        estimatedCost: Double = 0,
        costPerRequest: Double = 0,
        monthlyCredit: Double = 0,
        estimatedRemaining: Double = 0
    ) {
        self.totalRequests = totalRequests
        self.skippedPolls = skippedPolls
        self.estimatedCost = estimatedCost
        self.costPerRequest = costPerRequest
        self.monthlyCredit = monthlyCredit
        self.estimatedRemaining = estimatedRemaining
    }

    /// Web `apiUsage.total_requests - apiUsage.skipped_polls`.
    public var usefulRequests: Double {
        totalRequests - skippedPolls
    }
}

/// One labelled count — the native mirror of a `by_service` / `by_method` map entry. Modelled as an
/// ordered array element (not a Swift `Dictionary`) so the wire order the web `Object.entries`
/// relies on for stable de-dup + tie-break is preserved deterministically.
public struct TeslaApiUsageCountEntry: Sendable, Equatable, Identifiable {
    public let name: String
    public let count: Double

    public init(name: String, count: Double) {
        self.name = name
        self.count = count
    }

    public var id: String {
        name
    }
}

/// The richer `/api-logs/stats` payload the card overlays — the native mirror of `APICallLogStats`
/// (types/admin.ts). Only the fields the card reads are typed; `last24h` / `avgDurationMs` /
/// `errorRate` / `errorCount` are optional so the web `!= null` guards reproduce exactly.
public struct TeslaApiLogStats: Sendable, Equatable {
    public var last24h: Double?
    public var avgDurationMs: Double?
    public var errorRate: Double?
    public var errorCount: Double?
    public var byService: [TeslaApiUsageCountEntry]
    public var byMethod: [TeslaApiUsageCountEntry]

    public init(
        last24h: Double? = nil,
        avgDurationMs: Double? = nil,
        errorRate: Double? = nil,
        errorCount: Double? = nil,
        byService: [TeslaApiUsageCountEntry] = [],
        byMethod: [TeslaApiUsageCountEntry] = []
    ) {
        self.last24h = last24h
        self.avgDurationMs = avgDurationMs
        self.errorRate = errorRate
        self.errorCount = errorCount
        self.byService = byService
        self.byMethod = byMethod
    }
}

// MARK: - Grouped-map de-duplication (web `dedupeMap`)

/// The native port of the card's `dedupeMap`. `camelCaseKeys()` (lib/resilience.ts) mirrors a
/// snake_case map to BOTH snake_case and camelCase keys (e.g. `{tesla_fleet: 28000, teslaFleet:
/// 28000}`); this collapses the camelCase clones so the UI doesn't render duplicate rows. A
/// camelCase key is dropped when its snake_case alias is present, then entries are de-duped on the
/// underscore-stripped lowercase normal form, preserving the input (wire) order.
public enum TeslaApiUsageDedupe {
    public static func collapse(_ entries: [TeslaApiUsageCountEntry]) -> [TeslaApiUsageCountEntry] {
        let snakeKeys = entries.map(\.name).filter { $0.contains("_") }
        let aliases = Set(snakeKeys.map(camelAlias))
        var out: [TeslaApiUsageCountEntry] = []
        var seen = Set<String>()
        for entry in entries {
            let key = entry.name
            if aliases.contains(key), !key.contains("_") { continue }
            let norm = key.lowercased().replacingOccurrences(of: "_", with: "")
            if seen.contains(norm) { continue }
            seen.insert(norm)
            out.append(entry)
        }
        return out
    }

    /// Port of the web regex replace `/_([a-z0-9])/g → uppercase($1)` — drops an underscore that
    /// precedes a lowercase letter or digit and upper-cases that character (`tesla_fleet` →
    /// `teslaFleet`). Other underscores are kept (`a__b` → `a_B`).
    static func camelAlias(_ source: String) -> String {
        var result = ""
        let chars = Array(source)
        var index = 0
        while index < chars.count {
            let char = chars[index]
            if char == "_", index + 1 < chars.count {
                let next = chars[index + 1]
                if next.isLowercaseASCIILetterOrDigit {
                    result.append(Character(next.uppercased()))
                    index += 2
                    continue
                }
            }
            result.append(char)
            index += 1
        }
        return result
    }
}

private extension Character {
    var isLowercaseASCIILetterOrDigit: Bool {
        ("a" ... "z").contains(self) || ("0" ... "9").contains(self)
    }
}

// MARK: - Billing-window math (web `derived`)

/// The month-to-date billing-window derivation — the native mirror of the web `derived` memo. All
/// fields are reproduced (incl. `dailyAvgRequests`, which the web computes but does not render) so
/// the arithmetic is asserted end to end. `now` + `calendar` are injectable for deterministic tests.
public struct TeslaApiUsageDerived: Sendable, Equatable {
    public let daysElapsed: Int
    public let daysRemaining: Int
    public let totalDaysInMonth: Int
    public let pctOfBudget: Double
    public let dailyAvgCost: Double
    public let dailyAvgRequests: Double
    public let forecastFromMtd: Double
    public let forecastFromRecent: Double
    public let last24hBurn: Double

    private static let secondsPerDay = 86400.0

    /// Ports the web `derived` memo verbatim: the billing window runs from the first instant of the
    /// current month to the first instant of the next, day counts are `ceil`-ed, `daysElapsed` is
    /// clamped to ≥ 1, and the budget percentage guards a zero credit.
    public static func derive(
        usage: TeslaApiUsage,
        last24h: Double?,
        now: Date,
        calendar: Calendar = .current
    ) -> TeslaApiUsageDerived {
        let monthStart = startOfMonth(now, calendar: calendar)
        let monthEnd = startOfNextMonth(now, calendar: calendar)

        let total = Int(ceil(monthEnd.timeIntervalSince(monthStart) / secondsPerDay))
        let elapsed = max(1, Int(ceil(now.timeIntervalSince(monthStart) / secondsPerDay)))
        let remaining = max(0, total - elapsed)

        let pct = usage.monthlyCredit > 0 ? usage.estimatedCost / usage.monthlyCredit * 100 : 0
        let dailyCost = usage.estimatedCost / Double(elapsed)
        let dailyRequests = usage.totalRequests / Double(elapsed)
        let burn = (last24h ?? 0) * usage.costPerRequest

        return TeslaApiUsageDerived(
            daysElapsed: elapsed,
            daysRemaining: remaining,
            totalDaysInMonth: total,
            pctOfBudget: pct,
            dailyAvgCost: dailyCost,
            dailyAvgRequests: dailyRequests,
            forecastFromMtd: dailyCost * Double(total),
            forecastFromRecent: burn * Double(total),
            last24hBurn: burn
        )
    }

    /// Web `startOfMonth` — `new Date(year, month, 1)` in the calendar's timezone.
    static func startOfMonth(_ now: Date, calendar: Calendar) -> Date {
        let components = calendar.dateComponents([.year, .month], from: now)
        return calendar.date(from: components) ?? now
    }

    /// Web `endOfMonth` — `new Date(year, month + 1, 1)`: the first instant of the next month.
    static func startOfNextMonth(_ now: Date, calendar: Calendar) -> Date {
        let start = startOfMonth(now, calendar: calendar)
        return calendar.date(byAdding: .month, value: 1, to: start) ?? start
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds VoiceOver strings from already-localised parts, so the spoken content is asserted without
/// rendering the view.
public enum TeslaApiUsageAccessibility {
    /// The per-cell spoken label: "{label}: {value}".
    public static func label(_ label: String, _ value: String) -> String {
        "\(label): \(value)"
    }
}
