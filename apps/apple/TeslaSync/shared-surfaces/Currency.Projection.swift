//
//  Currency.Projection.swift
//  TeslaSync — P4 shared surface · 0083 · Currency (Apple)
//
//  The pure projection from the input snapshot to the on-screen view-state — the native port of the
//  web component's two render branches:
//
//      if (value == null || !Number.isFinite(value)) {
//        return <span className={className}>{fallback}</span>;        // fallback branch
//      }
//      const symbol = symbolOverride ?? currencySymbol;
//      const display = fmtNumber(value, precision);
//      return <span title={`${symbol}${value.toFixed(precision)}`}>{symbol}{display}</span>;
//
//  The view is a pure function of `CurrencyResolved`; both branches are unit tested. Keeping the
//  branch selection + formatting here (rather than in the view) lets the rendered text and the
//  canonical (tooltip) string be asserted deterministically, which is how the per-branch "snapshot"
//  coverage is expressed without a pixel snapshot harness.
//

import Foundation

// MARK: - Resolved view-state (web `<span>` content + `title`)

/// The resolved, view-ready content. `text` is the visible string (web span text — the formatted
/// amount, or the fallback glyph); `canonical` is the locale-neutral tooltip string (web `title`),
/// present only on the value branch (the web fallback span carries no `title`); `isFallback` records
/// which branch produced it so the view and tests can distinguish the two.
public struct CurrencyResolved: Sendable, Equatable {
    public let text: String
    public let canonical: String?
    public let isFallback: Bool

    public init(text: String, canonical: String?, isFallback: Bool) {
        self.text = text
        self.canonical = canonical
        self.isFallback = isFallback
    }
}

// MARK: - Projection (branch selection + formatting)

/// Pure projection: the null/non-finite guard, the symbol resolution, the locale-aware display
/// string, and the locale-neutral canonical string. No SwiftUI, no escaped formatter state.
public enum CurrencyProjection {
    /// Resolve the input to its view-state — the fallback branch for a `nil` / non-finite `value`,
    /// otherwise the formatted-value branch with its canonical tooltip string.
    public static func resolve(_ input: CurrencyInput) -> CurrencyResolved {
        guard let value = input.value, value.isFinite else {
            return CurrencyResolved(text: input.fallback, canonical: nil, isFallback: true)
        }
        let symbol = input.effectiveSymbol
        return CurrencyResolved(
            text: CurrencyFormatting.display(
                symbol: symbol,
                value: value,
                precision: input.precision,
                locale: input.locale
            ),
            canonical: CurrencyFormatting.canonical(
                symbol: symbol,
                value: value,
                precision: input.precision
            ),
            isFallback: false
        )
    }
}
