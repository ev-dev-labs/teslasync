//
//  AiUsageCard.Projection.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the three bands, the four key/value details,
//  and the by-feature / recent top-lists) plus the off-mode gate and the P4 leaf contract stay
//  unit testable in isolation (no store, no SwiftUI).
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the
/// web `AiUsageCardInner` render plus the off-mode gate and the P4 leaf contract. Unit tested
/// across gated / loading / empty / error / data, the error-rate intents, the by-feature sort +
/// cap, and the recent-row summary.
public enum AiUsageProjection {
    /// The number of rows each top-list shows (web `.slice(0, 5)`).
    static let topListLimit = 5

    public static func resolve(_ input: AiUsageInput, locale: Locale = .current) -> AiUsageResolved {
        // Web ADR-015 §I4: AI fully off ⇒ the surface renders nothing.
        if input.aiModeOff {
            return AiUsageResolved(phase: .gated)
        }
        // P4 leaf contract: a query failure surfaces a retryable error (web has no isError branch;
        // it falls through to the empty message — this is the sanctioned leaf enhancement).
        if let message = input.errorMessage, !message.isEmpty {
            return AiUsageResolved(phase: .error(message))
        }
        // Web `isLoading && !today` — keep the card shape with skeletons.
        if input.isLoading, input.today == nil {
            return AiUsageResolved(phase: .loading)
        }
        // Web `!today || today.call_count === 0` — the friendly empty message.
        guard let today = input.today, today.callCount > 0 else {
            let message = AiUsageStrings.string(
                "aiUsage.emptyMessage",
                "No Helix calls yet — turn on a feature to start."
            )
            return AiUsageResolved(phase: .empty(message))
        }
        return AiUsageResolved(
            phase: .data,
            bands: bands(for: today, input: input, locale: locale),
            details: details(for: today, locale: locale),
            topLists: topLists(for: input, locale: locale)
        )
    }

    // MARK: Bands (web `bands` array)

    private static func bands(
        for today: AiUsageToday,
        input: AiUsageInput,
        locale: Locale
    ) -> [AiUsageBand] {
        let errorCount = today.errorCount
        let errorSub = errorCount == 1
            ? AiUsageStrings.format("aiUsage.errorsOne", "%@ error", AiUsageNumber.count(errorCount, locale: locale))
            : AiUsageStrings.format("aiUsage.errorsOther", "%@ errors", AiUsageNumber.count(errorCount, locale: locale))

        let cost = AiUsageNumber.microCentsAsDollars(today.costMicroCents)
        let costValue = AiUsageNumber.currency(
            cost,
            symbol: input.currencySymbol,
            precision: input.decimalPrecision,
            locale: locale
        )

        return [
            AiUsageBand(
                id: "today",
                label: AiUsageStrings.string("aiUsage.band.today", "Today"),
                value: AiUsageNumber.count(today.callCount, locale: locale),
                unit: AiUsageStrings.string("aiUsage.unit.calls", "calls"),
                sub: errorSub,
                intent: AiUsageIntent.forErrorRate(errorCount: errorCount, callCount: today.callCount),
                systemImage: "waveform.path.ecg"
            ),
            AiUsageBand(
                id: "tokens",
                label: AiUsageStrings.string("aiUsage.band.tokens", "Tokens"),
                value: AiUsageNumber.count(today.totalTokens, locale: locale),
                unit: AiUsageStrings.string("aiUsage.unit.total", "total"),
                sub: AiUsageStrings.format(
                    "aiUsage.tokensInOut",
                    "%@ in · %@ out",
                    AiUsageNumber.count(today.inputTokens, locale: locale),
                    AiUsageNumber.count(today.outputTokens, locale: locale)
                ),
                intent: .normal,
                systemImage: "cpu"
            ),
            AiUsageBand(
                id: "cost",
                label: AiUsageStrings.string("aiUsage.band.cost", "Cost / latency"),
                value: costValue,
                unit: nil,
                sub: AiUsageStrings.format("aiUsage.msAvg", "%@ ms avg", AiUsageNumber.plainInt(today.avgLatencyMs)),
                intent: .normal,
                systemImage: "clock"
            )
        ]
    }

    // MARK: Details (web `details` array)

    private static func details(for today: AiUsageToday, locale: Locale) -> [AiUsageDetail] {
        [
            AiUsageDetail(
                id: "avgLatency",
                label: AiUsageStrings.string("aiUsage.detail.avgLatency", "Avg latency"),
                value: AiUsageStrings.format("aiUsage.msValue", "%@ ms", AiUsageNumber.plainInt(today.avgLatencyMs))
            ),
            AiUsageDetail(
                id: "errors",
                label: AiUsageStrings.string("aiUsage.detail.errors", "Errors"),
                value: AiUsageNumber.count(today.errorCount, locale: locale),
                intent: today.errorCount > 0 ? .danger : .normal
            ),
            AiUsageDetail(
                id: "inputTokens",
                label: AiUsageStrings.string("aiUsage.detail.inputTokens", "Input tokens"),
                value: AiUsageNumber.count(today.inputTokens, locale: locale)
            ),
            AiUsageDetail(
                id: "outputTokens",
                label: AiUsageStrings.string("aiUsage.detail.outputTokens", "Output tokens"),
                value: AiUsageNumber.count(today.outputTokens, locale: locale)
            )
        ]
    }

    // MARK: Top-lists (web `topLists` array — only appended when non-empty)

    private static func topLists(for input: AiUsageInput, locale: Locale) -> [AiUsageTopList] {
        var lists: [AiUsageTopList] = []

        if !input.byFeature.isEmpty {
            let top = input.byFeature
                .sorted { $0.callCount > $1.callCount }
                .prefix(topListLimit)
            lists.append(AiUsageTopList(
                id: "features",
                title: AiUsageStrings.string("aiUsage.topList.byFeature", "By feature (7 days)"),
                systemImage: "bolt.fill",
                items: top.map { row in
                    AiUsageTopListItem(
                        id: row.featureID,
                        label: row.featureID,
                        value: AiUsageNumber.count(row.callCount, locale: locale)
                    )
                }
            ))
        }

        if !input.recent.isEmpty {
            let rows = input.recent.prefix(topListLimit)
            lists.append(AiUsageTopList(
                id: "recent",
                title: AiUsageStrings.string("aiUsage.topList.recent", "Recent calls"),
                systemImage: "clock",
                items: rows.map { row in
                    AiUsageTopListItem(
                        id: String(row.id),
                        label: summarize(row, now: input.now, locale: locale),
                        value: row.statusGlyph
                    )
                }
            ))
        }

        return lists
    }

    /// The native port of `summarizeRecentRow` — `"{feature} · {model} · {tokens} tok · {ago}"`.
    static func summarize(_ row: AiUsageRecentRow, now: Date, locale: Locale = .current) -> String {
        let tokens = AiUsageStrings.format(
            "aiUsage.tokShort",
            "%@ tok",
            AiUsageNumber.integer(row.totalTokens, locale: locale)
        )
        let ago = relativeLabel(AiUsageRelative.bucket(fromISO: row.startedAt, now: now))
        return [row.featureID, row.model, tokens, ago].joined(separator: " · ")
    }

    /// Maps a relative bucket to its localized "{n}{unit} ago" label (web `formatRelativeTime`).
    static func relativeLabel(_ bucket: AiUsageRelative) -> String {
        switch bucket {
        case let .seconds(value):
            AiUsageStrings.format("aiUsage.relative.seconds", "%@s ago", String(value))
        case let .minutes(value):
            AiUsageStrings.format("aiUsage.relative.minutes", "%@m ago", String(value))
        case let .hours(value):
            AiUsageStrings.format("aiUsage.relative.hours", "%@h ago", String(value))
        case let .days(value):
            AiUsageStrings.format("aiUsage.relative.days", "%@d ago", String(value))
        case let .raw(iso):
            iso
        }
    }
}
