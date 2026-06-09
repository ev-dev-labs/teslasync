//
//  FrontendErrorsCard.Adapter.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  The testable, dependency-free projection core for the last-hour rolling summary of
//  browser-reported frontend errors — the SwiftUI parity of
//  features/system/components/status/FrontendErrorsCard.tsx. Everything here is pure Foundation
//  (no store, no SwiftUI, no bundle) so the integer formatting (port of numberFormat.ts `fmtInt`),
//  the name/route em-dash fallback, and the VoiceOver summaries are all unit tested in isolation
//  against the exact web arithmetic.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the arithmetic):
//    • fmtInt(v)        = safeNumber(v).toLocaleString(locale, { min: 0, max: 0 })   (locale grouping,
//                          non-finite ⇒ 0, half-up rounding).
//    • total            = data.total ?? 0       → fmtInt(total).
//    • entry count      = fmtInt(entry.count ?? 0).
//    • entry.name || '—' and entry.route || '—' — an empty string falls back to the em dash.
//

import Foundation

// MARK: - Number formatting (port of numberFormat.ts `fmtInt` / `safeNumber`)

/// Pure integer formatting ported from the web helpers so the locale grouping, the `safeNumber`
/// non-finite guard, and the half-up rounding match `fmtInt` exactly. Locale is injectable so the
/// output is deterministic under test.
public enum FrontendErrorsNumber {
    /// The em dash the web renders for a missing name / route (`entry.name || '—'`).
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)`: locale grouping, no fraction digits, half-up
    /// rounding, `safeNumber` guard. Drives the headline total and every offender count.
    public static func integer(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }
}

// MARK: - Input DTOs (web hook shape `WebErrorsSummary`)

/// One top-offender row — the native mirror of `WebErrorsSummaryEntry`. `count` is carried as
/// `Double` so the web `number` JSON + the `?? 0` / non-finite guard port exactly. The display
/// name / route fallback (`|| '—'`) is applied at the projection boundary.
public struct FrontendErrorEntry: Sendable, Equatable {
    public var name: String
    public var route: String
    public var count: Double

    public init(name: String, route: String, count: Double) {
        self.name = name
        self.route = route
        self.count = count
    }
}

/// The last-hour summary — the native mirror of `WebErrorsSummary`. Only the fields the card reads
/// (`total`, `top`) are typed; the web `window_seconds` / `as_of` are not rendered by the card.
/// `total` defaults to 0 so the web `data.total ?? 0` contract holds when the field is absent.
public struct FrontendErrorsSummary: Sendable, Equatable {
    public var total: Double
    public var top: [FrontendErrorEntry]

    public init(total: Double = 0, top: [FrontendErrorEntry] = []) {
        self.total = total
        self.top = top
    }
}

// MARK: - Display fallback (web `value || '—'`)

/// Resolves the web `entry.name || '—'` / `entry.route || '—'` fallback: an empty (or
/// whitespace-only) string becomes the em dash, otherwise the value is returned unchanged.
public enum FrontendErrorsText {
    public static func orDash(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? FrontendErrorsNumber.dash : value
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted
/// without rendering the view.
public enum FrontendErrorsAccessibility {
    /// The headline spoken label: "{total} {subtitle}" (e.g. "1,234 reported by browser sessions").
    public static func headline(_ total: String, _ subtitle: String) -> String {
        "\(total) \(subtitle)"
    }

    /// The per-offender spoken label: "{name}, {route}: {count}".
    public static func offender(name: String, route: String, count: String) -> String {
        "\(name), \(route): \(count)"
    }
}
