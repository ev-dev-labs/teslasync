//
//  HelpIcon.Adapter.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  The Foundation-only core for the field-level help primitive — the SwiftUI parity of
//  `components/ui/HelpIcon.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the surface's two real `t()` keys (`a11y.helpFor`, `help.tooltip.iconLabel`), the props
//  value type (``HelpIconInput``), the view-ready ``HelpIconProjection``, and the pure ``HelpIconProjector``
//  that resolves the help text (web `i18nKey ? t(i18nKey, {defaultValue: content}) : content`), the
//  trigger's accessibility label (web `ariaLabel ?? (for ? helpFor : iconLabel)`), and the described-by id
//  (web `for ? \(for)-help : undefined`). No SwiftUI and no `@Observable`, so every rule is unit-testable.
//
//  Faithful-parity note: the web `<HelpIcon>` is a PURE presentational primitive. Its only data source is
//  the synchronous `useTranslation` — it takes its props (`i18nKey`, `content`, `for`, `side`, `ariaLabel`)
//  and renders a `(?)` trigger that reveals a tooltip; there is no fetch, no React-Query cache, and no
//  Promise, so it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or
//  lose connectivity to). Inventing such chrome would fabricate states the source does not have, so this
//  surface reproduces only the source's REAL branches — exactly as the sibling presentational primitives
//  Accordion (0203), MetricCard (0095), InlineCallout (0124), and StaggerItem (0194) did. The real branches:
//  the "absent" branch (web `if (!text) return null` → renders nothing, a deliberate zero-footprint absence
//  so adopting call-sites need not gate the icon themselves — NOT a blank box), the resting trigger, and the
//  presented help bubble; plus the per-`side` placement and the override-vs-field-vs-generic a11y label.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum HelpIconSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HelpIcon"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, { defaultValue })`. The
/// production app passes the P1/S10 facade (resolving against the app catalog); tests pass an identity /
/// fake resolver. Kept as a plain closure so the pure core has no dependency on a bundle.
public typealias HelpIconResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Owned i18n keys (the surface's real web `t()` keys)

/// The two i18n keys the web `<HelpIcon>` resolves for its trigger label. Unlike most sibling surfaces
/// (which are anonymous), these mirror real web `t()` calls and have matching entries in the P1/S10 catalog.
public enum HelpIconKey {
    /// Web `t('a11y.helpFor', { field })` — the per-field label, e.g. "Help for Battery health".
    public static let helpFor = "a11y.helpFor"
    /// Web `t('help.tooltip.iconLabel')` — the generic label when no `for` field id is supplied.
    public static let iconLabel = "help.tooltip.iconLabel"
}

/// English fallbacks for the owned keys — the web `defaultValue` peers. `helpFor` carries both the native
/// `%@` token and tolerates the web `{{field}}` named token (see ``HelpIconProjector/interpolateField``).
public enum HelpIconFallback {
    /// Web default `Help for ${for}` — rendered via `%@` (or `{{field}}`) interpolation.
    public static let helpFor = "Help for %@"
    /// Web default `More info`.
    public static let iconLabel = "More info"
}

// MARK: - HelpIconSide (web `side`)

/// The tooltip placement relative to the trigger — the native peer of the web `side` prop
/// (`'top' | 'bottom' | 'left' | 'right'`). The web `left` / `right` map to the layout-direction-aware
/// `leading` / `trailing` so the bubble flips correctly under right-to-left locales.
public enum HelpIconSide: String, Sendable, CaseIterable {
    case top
    case bottom
    case leading
    case trailing

    /// The web default (`side = 'top'`).
    public static let defaultSide: HelpIconSide = .top

    /// Maps a web `side` literal to the native side, folding `left` → `leading` and `right` → `trailing`.
    public static func fromWeb(_ raw: String) -> HelpIconSide {
        switch raw {
        case "bottom": .bottom
        case "left": .leading
        case "right": .trailing
        default: .top
        }
    }
}

// MARK: - HelpIconInput (web props, closure-free)

/// The component's props — the native peer of `HelpIconProps`. A value type so the view, the state-holder,
/// and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply
/// when the page rebinds (e.g. a new `content` or a conditionally-absent help string).
public struct HelpIconInput: Sendable, Equatable {
    /// The i18n key for the help text (web `i18nKey`), preferred over plain `content` when non-empty.
    public let i18nKey: String?
    /// The fallback / one-off help text (web `content`), also the `defaultValue` when `i18nKey` is set.
    public let content: String?
    /// The labelled control's id (web `for`). Surfaces in the trigger label as "Help for {{for}}" and backs
    /// the described-by id `\(for)-help`. An empty string is treated as absent (web truthiness).
    public let forID: String?
    /// The tooltip side relative to the trigger (web `side`, default `top`).
    public let side: HelpIconSide
    /// An explicit override for the trigger's accessibility label (web `ariaLabel`). When non-nil it wins
    /// outright (web nullish `ariaLabel ??`), even if empty.
    public let ariaLabelOverride: String?

    public init(
        i18nKey: String? = nil,
        content: String? = nil,
        forID: String? = nil,
        side: HelpIconSide = .defaultSide,
        ariaLabelOverride: String? = nil
    ) {
        self.i18nKey = i18nKey
        self.content = content
        self.forID = forID
        self.side = side
        self.ariaLabelOverride = ariaLabelOverride
    }
}

// MARK: - HelpIconProjection (view-ready)

/// The resolved, view-ready help affordance — everything the SwiftUI body needs as a pure function of the
/// props + the i18n resolver (no derivation in the view). `hasContent` is the web `!!text` (its negation is
/// the `return null` branch); `text` is the resolved help copy; `accessibilityLabel` is the web trigger
/// `aria-label`; `describedByID` is the web `aria-describedby`; `side` is the placement.
public struct HelpIconProjection: Sendable, Equatable {
    /// Whether any help text resolved — web `!!text`. When `false` the surface renders nothing.
    public let hasContent: Bool
    /// The resolved help copy (web `text`).
    public let text: String
    /// The trigger's accessibility label (web `aria-label`).
    public let accessibilityLabel: String
    /// The described-by id exposed on the help body (web `aria-describedby` target), or `nil`.
    public let describedByID: String?
    /// The tooltip side relative to the trigger (web `side`).
    public let side: HelpIconSide

    public init(
        hasContent: Bool,
        text: String,
        accessibilityLabel: String,
        describedByID: String?,
        side: HelpIconSide
    ) {
        self.hasContent = hasContent
        self.text = text
        self.accessibilityLabel = accessibilityLabel
        self.describedByID = describedByID
        self.side = side
    }
}

// MARK: - HelpIconProjector (web render body)

/// The pure projection from the props + the i18n resolver to the view-ready model — the surface's data
/// adapter in the "state → projection" sense the acceptance calls for: it takes the props a page already
/// holds plus the resolver (no fetch, no clock) and derives the rendered help affordance. Unit tested across
/// the i18nKey-vs-content text resolution, the override / field / generic label rule, the `return null`
/// branch, the described-by id, and the `{{field}}` / `%@` interpolation.
public enum HelpIconProjector {
    /// Resolves the help text — the verbatim port of `i18nKey ? t(i18nKey, {defaultValue: content ?? ''}) :
    /// (content ?? '')`. An empty `i18nKey` is treated as absent (web truthiness), so the bare `content`
    /// wins; a present key resolves through the facade with `content` as the fallback (web `defaultValue`).
    public static func resolvedText(input: HelpIconInput, resolve: HelpIconResolve) -> String {
        let fallback = input.content ?? ""
        if let key = input.i18nKey, !key.isEmpty {
            return resolve(key, fallback)
        }
        return fallback
    }

    /// Whether any help text resolved — web `!!text`. Its negation is the `if (!text) return null` branch.
    public static func hasContent(input: HelpIconInput, resolve: HelpIconResolve) -> Bool {
        !resolvedText(input: input, resolve: resolve).isEmpty
    }

    /// Resolves the trigger's accessibility label — the verbatim port of `ariaLabel ?? (for ?
    /// t('a11y.helpFor', { field: for }) : t('help.tooltip.iconLabel'))`. An override (even empty) wins via
    /// web nullish coalescing; otherwise a non-empty `for` yields the per-field label, falling back to the
    /// generic icon label (web truthiness treats an empty `for` as absent).
    public static func accessibilityLabel(input: HelpIconInput, resolve: HelpIconResolve) -> String {
        if let override = input.ariaLabelOverride {
            return override
        }
        if let field = input.forID, !field.isEmpty {
            let template = resolve(HelpIconKey.helpFor, HelpIconFallback.helpFor)
            return interpolateField(template, field: field)
        }
        return resolve(HelpIconKey.iconLabel, HelpIconFallback.iconLabel)
    }

    /// The described-by id exposed on the help body — web `for ? \(for)-help : undefined`. An empty `for`
    /// is treated as absent (web truthiness).
    public static func describedByID(input: HelpIconInput) -> String? {
        guard let field = input.forID, !field.isEmpty else { return nil }
        return "\(field)-help"
    }

    /// Substitutes the field name into a label template — the native peer of the web i18n interpolation.
    /// Tolerates the web `{{field}}` named token (so a ported web catalog string works verbatim) and the
    /// native `%@` positional token; a template with neither is returned unchanged.
    public static func interpolateField(_ template: String, field: String) -> String {
        if template.contains("{{field}}") {
            return template.replacingOccurrences(of: "{{field}}", with: field)
        }
        if template.contains("%@") {
            return String(format: template, field)
        }
        return template
    }

    /// Resolves the whole help affordance from the props + the resolver — the native peer of the web
    /// component's render decision.
    public static func resolve(input: HelpIconInput, resolve resolver: HelpIconResolve) -> HelpIconProjection {
        let text = resolvedText(input: input, resolve: resolver)
        return HelpIconProjection(
            hasContent: !text.isEmpty,
            text: text,
            accessibilityLabel: accessibilityLabel(input: input, resolve: resolver),
            describedByID: describedByID(input: input),
            side: input.side
        )
    }
}
