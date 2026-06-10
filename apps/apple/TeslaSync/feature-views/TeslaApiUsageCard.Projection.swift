//
//  TeslaApiUsageCard.Projection.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the budget bar, the three bands, the four key/value
//  details, the Top-services / By-method top-lists, the over-budget banner, and the footer) plus
//  the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `TeslaApiUsageCard` render plus the P4 leaf contract. Unit tested across loading / empty / error
/// / data, the budget + error-rate intents, the billing-window caption, the de-duped top-lists, and
/// the over-budget banner.
public enum TeslaApiUsageProjection {
    /// The number of rows the "Top services" list shows (web `.slice(0, 3)`).
    static let topServiceLimit = 3

    public static func resolve(
        _ input: TeslaApiUsageInput,
        locale: Locale = .current,
        calendar: Calendar = .current
    ) -> TeslaApiUsageResolved {
        // P4 leaf contract: a query failure surfaces a retryable error (web has no isError branch;
        // it falls through to the empty message — this is the sanctioned leaf enhancement).
        if let message = input.errorMessage, !message.isEmpty {
            return TeslaApiUsageResolved(phase: .error(message))
        }
        // P4 leaf: keep the card shape with skeletons while the first snapshot is in flight.
        if input.isLoading, input.usage == nil {
            return TeslaApiUsageResolved(phase: .loading)
        }
        // Web `!apiUsage || !derived` — the friendly empty message (derived is null only when usage is).
        guard let usage = input.usage else {
            let message = TeslaApiUsageStrings.string(
                "teslaApiUsage.emptyMessage",
                "Tesla API usage data is not available yet."
            )
            return TeslaApiUsageResolved(phase: .empty(message))
        }

        let derived = TeslaApiUsageDerived.derive(
            usage: usage,
            last24h: input.logStats?.last24h,
            now: input.now,
            calendar: calendar
        )

        return TeslaApiUsageResolved(
            phase: .data,
            budget: budget(usage: usage, derived: derived, input: input, locale: locale),
            bands: bands(usage: usage, derived: derived, input: input, locale: locale),
            details: details(usage: usage, input: input, locale: locale),
            topLists: topLists(input: input, locale: locale),
            banner: banner(usage: usage, input: input, locale: locale),
            footer: footer()
        )
    }
}

// MARK: - Section builders (split out so the projection's type body stays within budget)

extension TeslaApiUsageProjection {
    // MARK: Currency helper

    private static func currency(_ amount: Double, _ input: TeslaApiUsageInput, _ locale: Locale) -> String {
        TeslaApiUsageNumber.currency(
            amount,
            symbol: input.currencySymbol,
            precision: input.decimalPrecision,
            locale: locale
        )
    }

    // MARK: Budget bar (web `budget` prop)

    private static func budget(
        usage: TeslaApiUsage,
        derived: TeslaApiUsageDerived,
        input: TeslaApiUsageInput,
        locale: Locale
    ) -> TeslaApiUsageBudget {
        let intent = TeslaApiUsageIntent.forBudget(
            estimatedCost: usage.estimatedCost,
            monthlyCredit: usage.monthlyCredit,
            pctOfBudget: derived.pctOfBudget
        )
        return TeslaApiUsageBudget(
            headline: TeslaApiUsageStrings.format(
                "teslaApiUsage.budget.headline",
                "%@ of %@",
                currency(usage.estimatedCost, input, locale),
                currency(usage.monthlyCredit, input, locale)
            ),
            rightLabel: TeslaApiUsageStrings.format(
                "teslaApiUsage.budget.rightLabel",
                "%@ of monthly credit",
                TeslaApiUsageNumber.percent(derived.pctOfBudget, decimals: 0, locale: locale)
            ),
            caption: caption(derived: derived),
            pct: derived.pctOfBudget,
            intent: intent,
            accessibilityLabel: TeslaApiUsageStrings.string("teslaApiUsage.budget.ariaLabel", "Tesla API budget used")
        )
    }

    /// Web `Day ${elapsed} of ${total} ·${resets…}` — the day numbers are bare template literals
    /// (no grouping), so they render with `String(Int)` rather than the grouped integer formatter.
    private static func caption(derived: TeslaApiUsageDerived) -> String {
        TeslaApiUsageStrings.format(
            "teslaApiUsage.budget.caption",
            "Day %@ of %@ · %@",
            String(derived.daysElapsed),
            String(derived.totalDaysInMonth),
            resetClause(daysRemaining: derived.daysRemaining)
        )
    }

    /// Web `daysRemaining === 0 ? 'resets tomorrow' : 'resets in N day(s)'` with singular/plural.
    private static func resetClause(daysRemaining: Int) -> String {
        switch daysRemaining {
        case 0:
            TeslaApiUsageStrings.string("teslaApiUsage.resetsTomorrow", "resets tomorrow")
        case 1:
            TeslaApiUsageStrings.string("teslaApiUsage.resetsInOneDay", "resets in 1 day")
        default:
            TeslaApiUsageStrings.format("teslaApiUsage.resetsInDays", "resets in %@ days", String(daysRemaining))
        }
    }

    // MARK: Bands (web `bands` array)

    private static func bands(
        usage: TeslaApiUsage,
        derived: TeslaApiUsageDerived,
        input: TeslaApiUsageInput,
        locale: Locale
    ) -> [TeslaApiUsageBand] {
        let requests = TeslaApiUsageStrings.string("teslaApiUsage.unit.requests", "requests")
        return [
            TeslaApiUsageBand(
                id: "thisMonth",
                label: TeslaApiUsageStrings.string("teslaApiUsage.band.thisMonth", "This month"),
                value: TeslaApiUsageNumber.count(usage.totalRequests, locale: locale),
                unit: requests,
                sub: TeslaApiUsageStrings.format(
                    "teslaApiUsage.perDayAvg",
                    "%@/day avg",
                    currency(derived.dailyAvgCost, input, locale)
                ),
                intent: .normal,
                systemImage: "waveform.path.ecg"
            ),
            TeslaApiUsageBand(
                id: "last24h",
                label: TeslaApiUsageStrings.string("teslaApiUsage.band.last24h", "Last 24h"),
                value: TeslaApiUsageNumber.count(input.logStats?.last24h, locale: locale),
                unit: requests,
                sub: TeslaApiUsageStrings.format(
                    "teslaApiUsage.perDayBurn",
                    "%@/day burn",
                    currency(derived.last24hBurn, input, locale)
                ),
                intent: .normal,
                systemImage: "clock"
            ),
            TeslaApiUsageBand(
                id: "forecastEom",
                label: TeslaApiUsageStrings.string("teslaApiUsage.band.forecastEom", "Forecast EOM"),
                value: currency(derived.forecastFromMtd, input, locale),
                unit: nil,
                sub: TeslaApiUsageStrings.format(
                    "teslaApiUsage.recentRate",
                    "recent rate: %@",
                    currency(derived.forecastFromRecent, input, locale)
                ),
                intent: derived.forecastFromMtd > usage.monthlyCredit ? .danger : .normal,
                systemImage: "chart.line.uptrend.xyaxis"
            )
        ]
    }

    // MARK: Details (web `details` array)

    private static func details(
        usage: TeslaApiUsage,
        input: TeslaApiUsageInput,
        locale: Locale
    ) -> [TeslaApiUsageDetail] {
        [
            TeslaApiUsageDetail(
                id: "useful",
                label: TeslaApiUsageStrings.string("teslaApiUsage.detail.useful", "Useful"),
                value: TeslaApiUsageNumber.count(usage.usefulRequests, locale: locale)
            ),
            TeslaApiUsageDetail(
                id: "skipped",
                label: TeslaApiUsageStrings.string("teslaApiUsage.detail.skipped", "Skipped (asleep)"),
                value: TeslaApiUsageNumber.count(usage.skippedPolls, locale: locale)
            ),
            TeslaApiUsageDetail(
                id: "avgLatency",
                label: TeslaApiUsageStrings.string("teslaApiUsage.detail.avgLatency", "Avg latency"),
                value: latencyValue(input.logStats?.avgDurationMs)
            ),
            errorRateDetail(input: input, locale: locale)
        ]
    }

    /// Web `logStats?.avgDurationMs != null ? '${round(ms)} ms' : '—'` — the rounded milliseconds
    /// are a bare template literal (no grouping), so they render via `plainInt`.
    private static func latencyValue(_ avgDurationMs: Double?) -> String {
        guard let avgDurationMs else { return TeslaApiUsageNumber.dash }
        return TeslaApiUsageStrings.format(
            "teslaApiUsage.msValue",
            "%@ ms",
            TeslaApiUsageNumber.plainInt(avgDurationMs)
        )
    }

    /// Web error-rate cell — `fmtPercent(errorPct, 1)` plus an optional muted `(fmtCount(errorCount))`
    /// suffix; intent is the shared error-rate heuristic.
    private static func errorRateDetail(input: TeslaApiUsageInput, locale: Locale) -> TeslaApiUsageDetail {
        let label = TeslaApiUsageStrings.string("teslaApiUsage.detail.errorRate", "Error rate")
        let intent = TeslaApiUsageIntent.forErrorRate(input.logStats?.errorRate)
        guard let errorPct = input.logStats?.errorRate else {
            return TeslaApiUsageDetail(id: "errorRate", label: label, value: TeslaApiUsageNumber.dash, intent: intent)
        }
        var suffix: String?
        if let errorCount = input.logStats?.errorCount {
            suffix = TeslaApiUsageStrings.format(
                "teslaApiUsage.errorCountParen",
                "(%@)",
                TeslaApiUsageNumber.count(errorCount, locale: locale)
            )
        }
        return TeslaApiUsageDetail(
            id: "errorRate",
            label: label,
            value: TeslaApiUsageNumber.percent(errorPct, decimals: 1, locale: locale),
            suffix: suffix,
            intent: intent
        )
    }

    // MARK: Top-lists (web `topLists` array — appended only when non-empty)

    private static func topLists(input: TeslaApiUsageInput, locale: Locale) -> [TeslaApiUsageTopList] {
        var lists: [TeslaApiUsageTopList] = []

        let services = TeslaApiUsageDedupe.collapse(input.logStats?.byService ?? [])
            .sorted { $0.count > $1.count }
            .prefix(topServiceLimit)
        if !services.isEmpty {
            lists.append(TeslaApiUsageTopList(
                id: "services",
                title: TeslaApiUsageStrings.string("teslaApiUsage.topServices", "Top services"),
                systemImage: "bolt.fill",
                items: services.map { item($0, locale: locale) }
            ))
        }

        let methods = TeslaApiUsageDedupe.collapse(input.logStats?.byMethod ?? [])
            .sorted { $0.count > $1.count }
        if !methods.isEmpty {
            lists.append(TeslaApiUsageTopList(
                id: "methods",
                title: TeslaApiUsageStrings.string("teslaApiUsage.byMethod", "By method"),
                systemImage: "waveform.path.ecg",
                items: methods.map { item($0, locale: locale) }
            ))
        }

        return lists
    }

    private static func item(_ entry: TeslaApiUsageCountEntry, locale: Locale) -> TeslaApiUsageTopListItem {
        TeslaApiUsageTopListItem(
            id: entry.name,
            label: entry.name,
            value: TeslaApiUsageNumber.count(entry.count, locale: locale)
        )
    }

    // MARK: Banner (web `banner` prop — only when over budget)

    private static func banner(
        usage: TeslaApiUsage,
        input: TeslaApiUsageInput,
        locale: Locale
    ) -> TeslaApiUsageBanner? {
        guard usage.estimatedCost > usage.monthlyCredit else { return nil }
        return TeslaApiUsageBanner(
            title: TeslaApiUsageStrings.string("teslaApiUsage.banner.title", "Over monthly credit"),
            description: TeslaApiUsageStrings.format(
                "teslaApiUsage.banner.description",
                "Spend has exceeded the %@ monthly credit by %@. Review polling cadence or vehicle subscriptions.",
                currency(usage.monthlyCredit, input, locale),
                currency(usage.estimatedCost - usage.monthlyCredit, input, locale)
            ),
            intent: .danger
        )
    }

    // MARK: Footer (web `footer` prop — always present)

    private static func footer() -> [TeslaApiUsageFooterLink] {
        [
            TeslaApiUsageFooterLink(
                id: "logs",
                label: TeslaApiUsageStrings.string("teslaApiUsage.footer.apiLogs", "Open API Logs"),
                route: "/api-logs",
                primary: true
            ),
            TeslaApiUsageFooterLink(
                id: "tesla",
                label: TeslaApiUsageStrings.string("teslaApiUsage.footer.teslaAccount", "Tesla account"),
                route: "/tesla-account"
            )
        ]
    }
}
