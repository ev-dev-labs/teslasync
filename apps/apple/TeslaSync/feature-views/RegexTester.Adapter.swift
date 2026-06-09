//
//  RegexTester.Adapter.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  The testable projection core for the regex devtools utility: the flag set, the
//  match model, the pure evaluator (a faithful port of the web `new RegExp` +
//  `exec` loop + `try/catch` fallback in
//  features/admin/components/devtools/tools/RegexTester.tsx), the surface slug, the
//  label formatters, and the VoiceOver summary builder. Everything here is pure and
//  dependency-free so it can be unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Flags (web `useState('g')` + `flagOptions`)

/// The regex flag presets offered by the web `Select` (`flagOptions`). The raw
/// value is the verbatim JS flag string fed to `new RegExp(pattern, flags)`.
public enum RegexFlags: String, Sendable, Equatable, CaseIterable, Identifiable {
    case global = "g"
    case globalCaseInsensitive = "gi"
    case globalMultiline = "gm"
    case globalAll = "gim"
    case none = ""

    public var id: String {
        rawValue
    }

    /// Whether the `g` flag is set — mirrors the web `flags.includes('g')` branch
    /// that decides between the all-matches loop and a single `exec`.
    public var isGlobal: Bool {
        rawValue.contains("g")
    }

    /// The `NSRegularExpression` options for the non-global flags. `i` →
    /// case-insensitive, `m` → `^`/`$` match line boundaries (the JS multiline
    /// flag). The `g` flag has no option counterpart; it drives the match loop.
    public var options: NSRegularExpression.Options {
        var opts: NSRegularExpression.Options = []
        if rawValue.contains("i") { opts.insert(.caseInsensitive) }
        if rawValue.contains("m") { opts.insert(.anchorsMatchLines) }
        return opts
    }

    /// The i18n key for this option's label (web `Select` option `label`).
    public var labelKey: String {
        switch self {
        case .global: "regex.flag.g"
        case .globalCaseInsensitive: "regex.flag.gi"
        case .globalMultiline: "regex.flag.gm"
        case .globalAll: "regex.flag.gim"
        case .none: "No Flags"
        }
    }

    /// The English fallback for this option's label — verbatim from the web
    /// `flagOptions` array (`t('No Flags')` for the last entry).
    public var labelFallback: String {
        switch self {
        case .global: "g (global)"
        case .globalCaseInsensitive: "gi (global, case-insensitive)"
        case .globalMultiline: "gm (global, multiline)"
        case .globalAll: "gim (all)"
        case .none: "No Flags"
        }
    }
}

// MARK: - Match (web `{ match, index }`)

/// One regex hit, mirroring the web result tuple `{ match, index }` plus a 1-based
/// ordinal for the leading badge (web `{i + 1}`).
public struct RegexMatch: Sendable, Equatable, Identifiable {
    /// 1-based position in the result list (web `i + 1`).
    public let ordinal: Int
    /// UTF-16 offset of the hit in the test string (web `m.index`). UTF-16 because
    /// both JS strings and `NSString` index in UTF-16 code units, so the values
    /// line up exactly.
    public let index: Int
    /// The matched substring (web `m[0]`).
    public let text: String

    public var id: Int {
        ordinal
    }

    public init(ordinal: Int, index: Int, text: String) {
        self.ordinal = ordinal
        self.index = index
        self.text = text
    }
}

// MARK: - Outcome (web `matches` memo + the input-gating early return)

/// The derived state of the tool, distinguishing "no input yet" from "evaluated,
/// zero hits" so every surface renders a friendly state (never a blank box).
public enum RegexOutcome: Sendable, Equatable {
    /// Pattern or test string is empty — the web `if (!pattern || !testStr) return []`
    /// early return. The surface shows an instructional hint.
    case idle
    /// The expression was evaluated. The array may be empty (a valid pattern that
    /// matched nothing, or an invalid pattern — the web `catch` also yields `[]`).
    case evaluated([RegexMatch])

    /// The hits to render, or `[]` for `idle`.
    public var matches: [RegexMatch] {
        switch self {
        case .idle: []
        case let .evaluated(matches): matches
        }
    }

    /// The match count shown in the badge (web `matches.length`). `idle` is 0.
    public var count: Int {
        matches.count
    }

    /// Whether evaluated input produced no hits (drives the "no matches" state).
    public var isNoMatch: Bool {
        if case let .evaluated(matches) = self { return matches.isEmpty }
        return false
    }
}

// MARK: - Evaluator (port of web `new RegExp` + `exec` loop)

/// The pure regex transform. Reproduces the web `useMemo` exactly: blank pattern
/// or test → `[]`; an invalid pattern (the web `catch`) → `[]`; with `g`, all
/// hits via a `lastIndex`-style loop that breaks on the first zero-width match
/// (web `if (!m[0]) break`); without `g`, a single first match.
public enum RegexEvaluator {
    public static func evaluate(pattern: String, flags: RegexFlags, test: String) -> RegexOutcome {
        guard !pattern.isEmpty, !test.isEmpty else { return .idle }
        guard let regex = try? NSRegularExpression(pattern: pattern, options: flags.options) else {
            return .evaluated([])
        }
        let nsTest = test as NSString
        let length = nsTest.length
        var matches: [RegexMatch] = []

        if flags.isGlobal {
            var searchStart = 0
            while searchStart <= length {
                let range = NSRange(location: searchStart, length: length - searchStart)
                // Transparent + non-anchoring bounds make lookaround/`\b` see the
                // whole string and keep `^` anchored to the true string start, so
                // the sub-range search matches JS `exec`-from-`lastIndex` semantics.
                guard let hit = regex.firstMatch(
                    in: test,
                    options: [.withTransparentBounds, .withoutAnchoringBounds],
                    range: range
                ) else { break }
                matches.append(make(ordinal: matches.count + 1, hit: hit, in: nsTest))
                if hit.range.length == 0 { break }
                searchStart = hit.range.location + hit.range.length
            }
        } else if let hit = regex.firstMatch(in: test, range: NSRange(location: 0, length: length)) {
            matches.append(make(ordinal: 1, hit: hit, in: nsTest))
        }

        return .evaluated(matches)
    }

    private static func make(ordinal: Int, hit: NSTextCheckingResult, in test: NSString) -> RegexMatch {
        RegexMatch(ordinal: ordinal, index: hit.range.location, text: test.substring(with: hit.range))
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free projection layer so it is reachable from the unit tests.
public enum RegexSurface {
    public static let slug = "RegexTester"
}

// MARK: - Projection (dynamic label composition)

/// Builds the surface's dynamic, localized labels. Strings resolve through an
/// injected localizer (`(key, fallback) -> String`) so the labels are testable
/// without a bundle, exactly like the view's P1/S10 facade.
public enum RegexProjection {
    /// The match-count badge text — web `{matches.length} {t('Matches')}`.
    public static func countLabel(count: Int, localize: (String, String) -> String) -> String {
        "\(count) \(localize("Matches", "Matches"))"
    }

    /// The per-row position text — web `{t('At Index')} {m.index}`.
    public static func positionLabel(index: Int, localize: (String, String) -> String) -> String {
        "\(localize("At Index", "At Index")) \(index)"
    }
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the combined VoiceOver summary for the surface. Strings resolve through
/// an injected localizer so the summary is testable without a bundle.
public enum RegexAccessibility {
    public static func summary(outcome: RegexOutcome, localize: (String, String) -> String) -> String {
        switch outcome {
        case .idle:
            return localize("regex.a11y.idle", "Enter a pattern and a test string to find matches")
        case let .evaluated(matches):
            let count = RegexProjection.countLabel(count: matches.count, localize: localize)
            guard let first = matches.first else {
                return "\(count). \(localize("regex.empty.title", "No matches"))"
            }
            let position = RegexProjection.positionLabel(index: first.index, localize: localize)
            return "\(count). \(first.text) \(position)"
        }
    }
}
