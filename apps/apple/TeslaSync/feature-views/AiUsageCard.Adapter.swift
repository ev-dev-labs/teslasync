//
//  AiUsageCard.Adapter.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  The testable, dependency-free projection core for the operator-grade per-call Helix (AI
//  provider) spend + volume card — the SwiftUI parity of
//  features/system/components/status/AiUsageCard.tsx and the shared <UsageCard> primitive it
//  feeds (components/data-display/UsageCard.tsx). Everything here is pure Foundation (no store,
//  no SwiftUI, no bundle) so the number formatting, the micro-cents → dollars scaling, the
//  error-rate intent thresholds, the relative-time bucketing, and the recent-row summary are all
//  unit tested in isolation against the exact web arithmetic.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the arithmetic):
//    • microCentsAsDollars(mc) = (mc == null || !finite) ? 0 : mc / 1_000_000.
//    • fmtCount(n)             = (n == null || !finite) ? "—" : fmtInt(n)  (locale grouping).
//    • errorIntent            = errorCount > 0 && callCount > 0
//                                 ? (errorCount / callCount >= 0.05 ? .danger : .warn)
//                                 : .normal.
//    • formatRelativeTime     = < 60s → "{s}s ago" · < 1h → "{m}m ago" · < 1d → "{h}h ago"
//                                 · else "{d}d ago" · unparseable → the raw ISO string. The web
//                                 magnitudes use bare template-literal numbers (NO grouping), so
//                                 the bucket value is rendered with `plainInt`, not `integer`.
//    • summarizeRecentRow     = "{feature} · {model} · {tokens} tok · {relative}", where tokens
//                                 is fmtInt(input + output) and renders "0 tok" at zero.
//

import Foundation

// MARK: - Number / currency formatting (port of numberFormat.ts + useFormatting)

/// Pure number + currency formatting ported from the web helpers so the rounding, the grouping
/// separators, the integer (`fmtInt`) path, and the `formatCurrency` prefix match the source
/// exactly. The web global precision is 2 and `safeNumber` coerces non-finite input to 0; both
/// are reproduced here. Locale is injectable so the output is deterministic under test.
public enum AiUsageNumber {
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

    /// Native port of the card's `fmtCount(n)` — the em-dash for null / non-finite, else
    /// `fmtInt(n)`. Optional input so the web `n == null` branch is reproduced exactly.
    public static func count(_ value: Double?, locale: Locale = .current) -> String {
        guard let value, value.isFinite else { return dash }
        return integer(value, locale: locale)
    }

    /// A bare, non-grouped integer string — the native peer of a web template-literal number
    /// (`${Math.round(ms)}`). Used for latency milliseconds and relative-time magnitudes, which
    /// the web renders WITHOUT a thousands separator. Non-finite ⇒ 0; rounds half-up.
    public static func plainInt(_ value: Double) -> String {
        String(Int(safe(value).rounded()))
    }

    /// Native port of the card's `microCentsAsDollars(mc)` — `mc / 1_000_000`, with the web
    /// `mc == null || !Number.isFinite(mc) ? 0` guard. The literal divisor mirrors the source.
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
}

// MARK: - Visual intent (web `UsageCardIntent`)

/// The accent intent driving band rings / detail value colour / banner tint — the native port of
/// the web `UsageCardIntent` union (`'normal' | 'warn' | 'danger'`).
public enum AiUsageIntent: String, Sendable, Equatable, CaseIterable {
    case normal
    case warn
    case danger

    /// The card's error-rate heuristic (web `errorIntent`): no errors (or no calls) ⇒ normal; a
    /// non-zero error rate ⇒ `danger` at ≥ 5 %, otherwise `warn`. The `>= 0.05` threshold and the
    /// `callCount > 0` guard are reproduced verbatim.
    public static func forErrorRate(errorCount: Double, callCount: Double) -> AiUsageIntent {
        guard errorCount > 0, callCount > 0 else { return .normal }
        return errorCount / callCount >= 0.05 ? .danger : .warn
    }
}

// MARK: - Input rows (web hook DTOs)

/// Today's aggregate — the native mirror of `AiUsageToday` (useAiUsageToday). Carried as `Double`
/// so the web `number`-typed JSON + the `safeNumber` non-finite guard port exactly.
public struct AiUsageToday: Sendable, Equatable {
    public var callCount: Double
    public var inputTokens: Double
    public var outputTokens: Double
    public var costMicroCents: Double
    public var errorCount: Double
    public var avgLatencyMs: Double

    public init(
        callCount: Double = 0,
        inputTokens: Double = 0,
        outputTokens: Double = 0,
        costMicroCents: Double = 0,
        errorCount: Double = 0,
        avgLatencyMs: Double = 0
    ) {
        self.callCount = callCount
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.costMicroCents = costMicroCents
        self.errorCount = errorCount
        self.avgLatencyMs = avgLatencyMs
    }

    /// Web `today.input_tokens + today.output_tokens`.
    public var totalTokens: Double {
        inputTokens + outputTokens
    }

    /// The all-zero snapshot — the web "absence ⇒ zeroes" contract applied to every field.
    public static let zero = AiUsageToday()
}

/// One per-feature aggregate row — the native mirror of `AiUsageFeatureRow`
/// (useAiUsageByFeature). Only the fields the card reads (`feature_id`, `call_count`) are typed.
public struct AiUsageFeatureRow: Sendable, Equatable, Identifiable {
    public var featureID: String
    public var callCount: Double

    public init(featureID: String, callCount: Double) {
        self.featureID = featureID
        self.callCount = callCount
    }

    public var id: String {
        featureID
    }
}

/// One recent-call row — the native mirror of `AiUsageRecentRow` (useAiUsageRecent). `error` is
/// the web string field where a non-empty value marks a failed call.
public struct AiUsageRecentRow: Sendable, Equatable, Identifiable {
    public var id: Int
    public var featureID: String
    public var model: String
    public var inputTokens: Double
    public var outputTokens: Double
    public var startedAt: String
    public var error: String

    public init(
        id: Int,
        featureID: String,
        model: String,
        inputTokens: Double,
        outputTokens: Double,
        startedAt: String,
        error: String = ""
    ) {
        self.id = id
        self.featureID = featureID
        self.model = model
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.startedAt = startedAt
        self.error = error
    }

    /// Web `row.input_tokens + row.output_tokens`.
    public var totalTokens: Double {
        inputTokens + outputTokens
    }

    /// Web `r.error ? '✗' : '✓'` — the success/failure glyph for the recent top-list value.
    public var statusGlyph: String {
        error.isEmpty ? "✓" : "✗"
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

/// The coarse relative-time bucket the web `formatRelativeTime` resolves. Kept as a value type so
/// the magnitude + unit are unit tested without any localized prose; the localized "{n}{u} ago"
/// template is applied at the projection boundary (P1/S10).
public enum AiUsageRelative: Sendable, Equatable {
    case seconds(Int)
    case minutes(Int)
    case hours(Int)
    case days(Int)
    /// The ISO string could not be parsed — the web returns it unchanged.
    case raw(String)

    /// Buckets an ISO-8601 instant against `now`, mirroring the web thresholds exactly:
    /// `< 60s → seconds (clamped ≥ 0)`, `< 1h → minutes`, `< 1d → hours`, else `days`. An
    /// unparseable timestamp resolves to `.raw(iso)` (web `Number.isNaN(t)` branch).
    public static func bucket(fromISO iso: String, now: Date) -> AiUsageRelative {
        guard let parsed = parseISO(iso) else { return .raw(iso) }
        let ageMs = now.timeIntervalSince(parsed) * 1000
        if ageMs < 60000 { return .seconds(max(0, Int((ageMs / 1000).rounded()))) }
        if ageMs < 3_600_000 { return .minutes(Int((ageMs / 60000).rounded())) }
        if ageMs < 86_400_000 { return .hours(Int((ageMs / 3_600_000).rounded())) }
        return .days(Int((ageMs / 86_400_000).rounded()))
    }

    /// Parses an ISO-8601 instant with or without fractional seconds (Fleet API emits both),
    /// mirroring the lenient `Date.parse` the web relies on.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds VoiceOver strings from already-localised parts, so the spoken content is asserted
/// without rendering the view.
public enum AiUsageAccessibility {
    /// The per-cell spoken label: "{label}: {value}".
    public static func label(_ label: String, _ value: String) -> String {
        "\(label): \(value)"
    }
}
