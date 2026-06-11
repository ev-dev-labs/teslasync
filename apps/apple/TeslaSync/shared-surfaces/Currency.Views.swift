//
//  Currency.Views.swift
//  TeslaSync — P4 shared surface · 0083 · Currency (Apple)
//
//  The presentational leaf composed by `Currency`: the text run that renders the resolved content and
//  carries the canonical (tooltip) string. Parity with the web `<span className={className}>`: the web
//  span sets no font, colour, or digit traits of its own — it inherits them and lets the caller's
//  `className` style it. The native leaf mirrors that exactly (it sets no `font` / `foregroundStyle` /
//  `monospacedDigit`), so callers tint + size the figure at the use-site with the P1/S9 tokens. The
//  web `title` attribute (present only on the value branch — the fallback span carries none) becomes a
//  `.help(_:)` tooltip surfaced on pointer hover on iPadOS / macOS.
//

import SwiftUI

// MARK: - Text run (web `<span>` content + `title`)

/// The currency text run. Renders `resolved.text` verbatim (so the symbol + grouped figure are never
/// reinterpreted as a localization key) and attaches the canonical tooltip on the value branch.
struct CurrencyText: View {
    let resolved: CurrencyResolved

    var body: some View {
        Text(verbatim: resolved.text)
            .modifier(CurrencyHelp(canonical: resolved.canonical))
    }
}

// MARK: - Canonical tooltip (web `title` attribute)

/// Attaches the web `title` (the locale-neutral `${symbol}${value.toFixed(precision)}`) as a SwiftUI
/// `.help(_:)` tooltip — but only on the value branch. The web fallback span has no `title`, so a
/// `nil` canonical adds no tooltip.
private struct CurrencyHelp: ViewModifier {
    let canonical: String?

    func body(content: Content) -> some View {
        if let canonical {
            content.help(Text(verbatim: canonical))
        } else {
            content
        }
    }
}
