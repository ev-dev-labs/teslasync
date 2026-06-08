//
//  AIUsageCard.Adapter.swift
//  TeslaSync — P4 feature view · 0203 · AIUsageCard (Apple)
//
//  The testable projection core for the Helix "Usage today" settings card — the SwiftUI
//  parity of features/settings/components/AIUsageCard.tsx plus the web helpers it is fed by:
//  `useFormatting().formatCurrency` (currency symbol + `fmtNumber`), `lib/numberFormat.ts`'s
//  `fmtInt` / `fmtNumber` (locale grouping at a fixed precision, with the `safeNumber`
//  non-finite → 0 guard), and the card's own `microCentsAsDollars` + `formatCount` helpers.
//  Everything here is pure + dependency-free (no store, no bundle, no rendered view) so the
//  number formatting, the micro-cents → dollars scaling, the three usage cells, and the
//  caption composition are all unit tested in isolation.
//
//  Parity note: the web `microCentsAsDollars(mc)` divides the raw figure by exactly
//  `1_000_000` and coerces null / non-finite to 0; `formatCount(n)` returns the long em-dash
//  for null / non-finite and otherwise `fmtInt(n)`. Both are reproduced verbatim here so the
//  native cells round, group, and degrade identically to the source.
//

import Foundation

// MARK: - Number / integer / currency formatting (port of numberFormat.ts + useFormatting)

/// Pure number + currency formatting ported from the web helpers so the rounding, the
/// grouping separators, the integer (`fmtInt`) path, and the `formatCurrency` prefix match the
/// source exactly. The web global precision is 2 and `safeNumber` coerces non-finite input to
/// 0; both are reproduced here. Locale is injectable so the output is deterministic under test.
public enum AIUsageFormat {
    /// The em-dash sentinel the web renders for a missing-value cell.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits,
    /// half-up rounding (web `toLocaleString` default), `safeNumber` guard.
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

    /// Native port of the card's `formatCount(n)` — the em-dash for null / non-finite, else
    /// `fmtInt(n)`. Kept optional so the web `n == null` branch is reproduced exactly.
    public static func count(_ value: Double?, locale: Locale = .current) -> String {
        guard let value, value.isFinite else { return dash }
        return integer(value, locale: locale)
    }

    /// Native port of the card's `microCentsAsDollars(mc)` — `mc / 1_000_000`, with the web
    /// `mc == null || !Number.isFinite(mc) ? 0` guard. The literal divisor mirrors the source
    /// verbatim (do not "fix" it — parity with the web arithmetic is the contract).
    public static func microCentsAsDollars(_ microCents: Double?) -> Double {
        guard let microCents, microCents.isFinite else { return 0 }
        return microCents / 1_000_000
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

    /// The web live-caption template — `${formatCount(call_count)} ${liveSuffix}`. `callCount`
    /// is the already-formatted count; `suffix` is the localized "Helix calls today." string.
    public static func liveCaption(callCount: String, suffix: String) -> String {
        "\(callCount) \(suffix)"
    }
}

// MARK: - Input data (web `useAiUsageToday().data` subset)

/// The `AiUsageToday` fields the card reads (web `data.input_tokens` / `output_tokens` /
/// `cost_micro_cents` / `call_count`). Carried as `Double` so the web `number` semantics — the
/// `safeNumber` non-finite guard and JS's float-typed JSON numbers — port exactly. A `nil`
/// snapshot resolves to the all-zero `zero` value (the hook doc: the decorator + repo both
/// treat absence as zeroes), so the grid never renders blank.
public struct AIUsageData: Sendable, Equatable {
    /// Web `data.call_count` — number of Helix calls in today's UTC bucket.
    public var callCount: Double
    /// Web `data.input_tokens` — prompt tokens billed today.
    public var inputTokens: Double
    /// Web `data.output_tokens` — completion tokens billed today.
    public var outputTokens: Double
    /// Web `data.cost_micro_cents` — accrued cost in micro-cents (scaled by `microCentsAsDollars`).
    public var costMicroCents: Double

    public init(
        callCount: Double = 0,
        inputTokens: Double = 0,
        outputTokens: Double = 0,
        costMicroCents: Double = 0
    ) {
        self.callCount = callCount
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.costMicroCents = costMicroCents
    }

    /// The all-zero snapshot rendered when today's usage has not been audited yet — the web
    /// "absence ⇒ zeroes" contract applied to every field at once.
    public static let zero = AIUsageData()
}

// MARK: - Metric projection (web `UsageCell` grid)

/// One resolved usage cell — the native mirror of one web `<UsageCell label value />`. The
/// display label is carried as an i18n key + English fallback (resolved in the view); `value`
/// is already locale-formatted so the view is a pure function of this value.
public struct AIUsageMetric: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public init(id: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }
}

/// Builds the three usage cells from an input snapshot + the currency context — the native port
/// of the web grid (`Tokens in`, `Tokens out`, `Estimated cost`), in source order. This is the
/// testable adapter the prompt's "cached → projection" unit test exercises.
public enum AIUsageMetricsBuilder {
    public static func metrics(
        for data: AIUsageData,
        currencySymbol symbol: String,
        precision: Int,
        locale: Locale = .current
    ) -> [AIUsageMetric] {
        [
            tokensIn(data, locale: locale),
            tokensOut(data, locale: locale),
            cost(data, symbol: symbol, precision: precision, locale: locale)
        ]
    }

    private static func tokensIn(_ data: AIUsageData, locale: Locale) -> AIUsageMetric {
        AIUsageMetric(
            id: "tokensIn",
            labelKey: "ai.settings.usage.tokensIn",
            labelFallback: "Tokens in",
            value: AIUsageFormat.count(data.inputTokens, locale: locale)
        )
    }

    private static func tokensOut(_ data: AIUsageData, locale: Locale) -> AIUsageMetric {
        AIUsageMetric(
            id: "tokensOut",
            labelKey: "ai.settings.usage.tokensOut",
            labelFallback: "Tokens out",
            value: AIUsageFormat.count(data.outputTokens, locale: locale)
        )
    }

    private static func cost(
        _ data: AIUsageData,
        symbol: String,
        precision: Int,
        locale: Locale
    ) -> AIUsageMetric {
        let dollars = AIUsageFormat.microCentsAsDollars(data.costMicroCents)
        return AIUsageMetric(
            id: "cost",
            labelKey: "ai.settings.usage.cost",
            labelFallback: "Estimated cost",
            value: AIUsageFormat.currency(dollars, symbol: symbol, precision: precision, locale: locale)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a usage cell from already-localised parts, so the spoken
/// content is asserted without rendering the view.
public enum AIUsageAccessibility {
    /// The per-cell spoken label: "{label}: {value}".
    public static func cellLabel(label: String, value: String) -> String {
        "\(label): \(value)"
    }
}
