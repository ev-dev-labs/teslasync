//
//  GotoIndicator.Adapter.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  The testable, dependency-light core for the goto indicator — the SwiftUI parity of
//  `components/feedback/GotoIndicator.tsx`. Everything here is pure (Foundation only): the localization
//  seam (the web `useTranslation` `t(key, fallback)`), the `{{token}}` interpolation (the web i18next
//  substitution), the keyboard-chord builder (the web `<kbd>g</kbd> + <kbd>?</kbd>` sequence), and the
//  VoiceOver hint/label builders. No store, no bundle, no rendered view, so each piece is unit tested
//  in isolation.
//
//  Parity note: the web surface is a passive controlled indicator. The parent (a keyboard-navigation
//  controller wired to a "press g, then …" chord listener) supplies a single `visible` flag; the
//  banner shows `t('shortcuts.goto','Go to...')` followed by the `g` and `?` key caps when visible and
//  renders nothing otherwise. This core reproduces the pure derivations — the resolved prompt, the
//  ordered key caps + the visual separator, and the spoken accessibility hint — as values and
//  functions; the SwiftUI chrome layers on top in the sibling view files.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias GotoResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - i18next interpolation (web `t(key, { keys })`)

/// Replaces `{{token}}` markers with their values — the native parity of the web i18next interpolation
/// (`{{keys}}`). Pure + public so the substitution is asserted directly.
public enum GotoInterpolation {
    public static func apply(_ template: String, _ values: [String: String]) -> String {
        var output = template
        for (token, value) in values {
            output = output.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return output
    }
}

// MARK: - Keyboard chord (web `<kbd>g</kbd> + <kbd>?</kbd>`)

/// Builds the keyboard chord the indicator renders — the native port of the web key caps. The web
/// hardcodes the `g` and `?` glyphs and the `+` separator in the JSX; here every glyph resolves through
/// the P1/S10 facade so the native code holds no display literals (a key cap is still a localizable
/// presentation token — some scripts shape the "?" or the modifier glyph differently). Pure + public so
/// the ordered caps, the visual separator, and the spoken form are each asserted.
public enum GotoChord {
    /// The ordered key caps, mirroring the web sequence (`g`, then `?`).
    public static func keys(strings: GotoResolve = GotoStrings.string) -> [String] {
        [
            strings("shortcuts.goto.keyGoto", "g"),
            strings("shortcuts.goto.keyHelp", "?")
        ]
    }

    /// The visual separator drawn between the key caps (web `+`).
    public static func separator(strings: GotoResolve = GotoStrings.string) -> String {
        strings("shortcuts.goto.separator", "+")
    }

    /// The spoken form of the chord for VoiceOver — the key caps joined by the localized "then"
    /// conjunction (e.g. "g then ?"), so the shortcut reads naturally instead of "g plus question
    /// mark". Empty caps are dropped so a missing localization never speaks a dangling conjunction.
    public static func spoken(keys: [String], strings: GotoResolve = GotoStrings.string) -> String {
        let conjunction = strings("shortcuts.goto.thenConjunction", "then")
        return keys
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " \(conjunction) ")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the indicator's VoiceOver strings from the resolved chord, so the spoken content is asserted
/// without rendering. The prompt ("Go to…") is the element's spoken label; the hint explains what the
/// chord does, with the spoken chord interpolated into the web-style `{{keys}}` template.
public enum GotoAccessibility {
    /// Collapses internal runs of whitespace and trims the ends, so a wrapped prompt/hint never reads a
    /// double space.
    public static func normalize(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// The spoken hint — the web-style `{{keys}}` template filled with the spoken chord (e.g. "Press g
    /// then ? to jump to a section.").
    public static func hint(spokenChord: String, strings: GotoResolve = GotoStrings.string) -> String {
        let template = strings("shortcuts.goto.a11yHint", "Press {{keys}} to jump to a section.")
        return normalize(GotoInterpolation.apply(template, ["keys": spokenChord]))
    }
}
