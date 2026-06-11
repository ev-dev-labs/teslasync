//
//  MetricCard.Adapter.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  The Foundation-only core for the compact metric card — the SwiftUI parity of
//  components/data-display/MetricCard.tsx. This file holds the surface identity (the diagnostics
//  slug), the props value type (``MetricCardInputs``), the color axis (``MetricCardColor``, the
//  native peer of the web `NeonColor`), the JS-faithful value stringifier, and the three optional
//  composition configs the card forwards — the legacy ``MetricCardChange`` pill, the direction-aware
//  ``MetricCardDelta`` indicator, and the ``MetricCardHelp`` "?" affordance. No SwiftUI and no
//  `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `MetricCard` is a PURE presentational component. It owns no fetch,
//  no React-Query cache, no Promise — it maps its props straight to a `<div>`. It therefore has NO
//  error, stale, or offline branch: there is nothing to load, fail, age, or lose connectivity to.
//  Inventing such chrome would fabricate states the source does not have, so this surface reproduces
//  only the source's REAL branches — exactly as the sibling presentational primitives BatteryDelta
//  (0077) and TimeMarker (0074) did. The real branches are:
//    • value     — always rendered (the headline number / string).
//    • subtitle  — present or absent.
//    • trend     — the legacy ``change`` pill, the richer ``delta`` indicator, or neither. The web
//                  renders the pill ONLY when `change && !delta`, so the delta always wins.
//    • delta     — itself carries the web `<Delta>` loading (skeleton) and missing-comparison
//                  (em-dash) sub-states, which map the prompt's "loading" / "empty" faithfully.
//    • help      — the optional "?" tooltip next to the label.
//    • icon      — the optional colored glyph box.
//    • color     — one of six accents (web `NeonColor`), default cyan.
//
//  Composition seam: the web card composes the `<Delta>` and `<HelpTooltip>` ATOMIC components. Those
//  are owned by the component-library bundle (out of scope here), and the allowed-files rule scopes
//  this prompt to `MetricCard.*`, so their rendering is reproduced inline in this surface. Unit-label
//  resolution (mi/km/kWh/currency) and arbitrary i18n-key lookup are the units / i18n facade's job
//  (web `useUnits()` / `t(key)`), so the delta carries already-resolved affixes and the help carries
//  already-resolved copy — the same boundary the web hooks draw.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `MetricCard`; this surface keeps the same slug here (SwiftUI-free) so
/// the state-holder can emit telemetry without depending on the view layer.
public enum MetricCardSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "MetricCard"
}

// MARK: - MetricCardColor (web `NeonColor`)

/// The accent axis — the native peer of the web `NeonColor` union (`cyan | green | red | purple |
/// amber | blue`). Drives the icon box's tint (web `neonColorMap[color]` → `bg-neon-{c}/10`,
/// `ring-neon-{c}/20`, `text-{c}-300`). Mapped to theme-aware design tokens (P1/S9) in
/// MetricCard.Views.swift so the box recolors across light / dark / high-contrast, where the web's
/// fixed Tailwind shades did not.
public enum MetricCardColor: String, Sendable, Equatable, CaseIterable {
    case cyan
    case green
    case red
    case purple
    case amber
    case blue

    /// The web default (`color = 'cyan'`).
    public static let defaultColor: MetricCardColor = .cyan
}

// MARK: - Value stringification (web `${value}` template-literal)

/// Formats a number the way a JavaScript template literal renders it inside `{value}` (web
/// `<p>{value}</p>`): an integer-valued number prints with no decimals (`48210` → "48210", with NO
/// thousands grouping, matching `${48210}`), a fractional value prints its shortest decimal with
/// trailing zeros trimmed (`0.5` → "0.5"), and the non-finite values print their JS spellings
/// (`NaN` / `Infinity` / `-Infinity`) so a bad numeric prop renders exactly as the web would.
public enum MetricCardNumber {
    public static func string(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value == .infinity { return "Infinity" }
        if value == -.infinity { return "-Infinity" }
        let rounded = value.rounded()
        if value == rounded, abs(value) < 1e15 {
            return String(Int64(rounded))
        }
        var text = String(format: "%.10f", value)
        while text.contains("."), text.hasSuffix("0") {
            text.removeLast()
        }
        if text.hasSuffix(".") {
            text.removeLast()
        }
        return text
    }
}

// MARK: - MetricCardValue (web `value: string | number`)

/// The headline value — the native peer of the web `value: string | number`. `.number` renders via
/// the JS-faithful ``MetricCardNumber`` stringifier and feeds the delta's `current` fallback; `.text`
/// renders verbatim (a pre-formatted string like "48,210 km") and is coerced for that fallback the
/// way the web does (`Number(value)`).
public enum MetricCardValue: Sendable, Equatable {
    case number(Double)
    case text(String)

    /// The visible string — web `{value}`.
    public var displayText: String {
        switch self {
        case let .number(value): MetricCardNumber.string(value)
        case let .text(text): text
        }
    }

    /// The numeric reading used for the delta's `current` fallback — web
    /// `Number.isFinite(numericValue) ? numericValue : null`, where
    /// `numericValue = typeof value === 'number' ? value : Number(value)`. Returns `nil` when the
    /// value is non-finite (a number) or does not coerce to a finite number (a string).
    public var finiteNumericValue: Double? {
        switch self {
        case let .number(value):
            return value.isFinite ? value : nil
        case let .text(text):
            let coerced = MetricCardValue.jsNumber(text)
            return coerced.isFinite ? coerced : nil
        }
    }

    /// The subset of JavaScript `Number(string)` coercion the card relies on: a blank / whitespace
    /// string is `0` (JS `Number('') === 0`), "Infinity" / "-Infinity" map to the infinities, and any
    /// other token parses as a `Double` or is `NaN` (JS `Number('1,234')` / `Number('abc')` → NaN).
    static func jsNumber(_ raw: String) -> Double {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        if trimmed == "Infinity" || trimmed == "+Infinity" { return .infinity }
        if trimmed == "-Infinity" { return -.infinity }
        return Double(trimmed) ?? .nan
    }
}

// MARK: - MetricCardChange (web legacy `change` pill)

/// The legacy change pill — the native peer of the web `change?: { value: string; positive: boolean }`.
/// Renders an up / down arrow plus the caller's pre-formatted `value` text, emerald when `positive`
/// else rose (web `text-emerald-300` / `text-rose-300`). The web shows it ONLY when `change && !delta`
/// — the richer ``MetricCardDelta`` always takes precedence.
public struct MetricCardChange: Sendable, Equatable {
    /// The pre-formatted change text (web `change.value`, e.g. "12%").
    public let value: String
    /// Whether the change is an improvement — drives the emerald / rose tone + the arrow direction.
    public let positive: Bool

    public init(value: String, positive: Bool) {
        self.value = value
        self.positive = positive
    }
}

// MARK: - MetricCardDelta (web `<Delta>` config, current omitted)

/// The direction-aware delta config — the native peer of the web `MetricCardDelta`
/// (`Omit<DeltaProps, 'current'> & { current? }`). It carries everything the footer needs to render
/// the web `<Delta>` indicator: the metric `direction` (which sign is "good"), the comparison
/// endpoints, the `display` form, the trailing `comparedTo` label, the `size`, the arrow toggle, the
/// forced `loading` skeleton, and the already-resolved unit affixes + `precision`. The `current`
/// override is optional — when `nil` the card falls back to its own numeric value (web
/// `delta.current ?? numericValue`).
public struct MetricCardDelta: Sendable, Equatable {
    /// Which direction of change is favorable — web `Direction`.
    public enum Direction: String, Sendable, Equatable, CaseIterable {
        /// A rise is good — colored emerald on a rise (web `higher_better`).
        case higherBetter = "higher_better"
        /// A drop is good — colored emerald on a drop (web `lower_better`).
        case lowerBetter = "lower_better"
        /// Never colored good / bad — always neutral (web `neutral`).
        case neutral
    }

    /// Which form to render — web `display`, default `percent`.
    public enum Display: String, Sendable, Equatable, CaseIterable {
        case percent
        case absolute
        case both

        /// The web default (`display = 'percent'`).
        public static let defaultDisplay: Display = .percent
    }

    /// The text + icon scale — web `size`, default `sm`.
    public enum Size: String, Sendable, Equatable, CaseIterable {
        case sm
        case md

        /// The web default (`size = 'sm'`).
        public static let defaultSize: Size = .sm
    }

    /// Favorable direction (web `metric.direction`).
    public let direction: Direction
    /// Current-period value override; `nil` falls back to the card's own value (web `delta.current`).
    public let current: Double?
    /// Previous-period value; `nil` / non-finite renders the muted em-dash (web `previous`).
    public let previous: Double?
    /// Percent / absolute / both (web `display`).
    public let display: Display
    /// Trailing label such as "vs last week" (web `comparedTo`).
    public let comparedTo: String?
    /// Text + icon scale (web `size`).
    public let size: Size
    /// Hide the directional arrow (web `hideArrow`).
    public let hideArrow: Bool
    /// Force the loading skeleton (web `loading`).
    public let loading: Bool
    /// Resolved unit prefix, e.g. a currency symbol (web `useUnitLabels(...).prefix`).
    public let unitPrefix: String
    /// Resolved unit suffix with no leading space, e.g. "kWh" / "%" (web `useUnitLabels(...).suffix`).
    public let unitSuffix: String
    /// Override the decimal precision (web `precision`; percent defaults to 1).
    public let precision: Int?

    public init(
        direction: Direction,
        current: Double? = nil,
        previous: Double?,
        display: Display = .defaultDisplay,
        comparedTo: String? = nil,
        size: Size = .defaultSize,
        hideArrow: Bool = false,
        loading: Bool = false,
        unitPrefix: String = "",
        unitSuffix: String = "",
        precision: Int? = nil
    ) {
        self.direction = direction
        self.current = current
        self.previous = previous
        self.display = display
        self.comparedTo = comparedTo
        self.size = size
        self.hideArrow = hideArrow
        self.loading = loading
        self.unitPrefix = unitPrefix
        self.unitSuffix = unitSuffix
        self.precision = precision
    }
}

// MARK: - MetricCardHelp (web `HelpTooltipProps`)

/// The "Learn more" link config — the native peer of the web `learnMore: { url; label? }`. The label
/// defaults to the localized "Learn more" (web `t('common.learnMore', 'Learn more')`) when omitted.
public struct MetricCardLearnMore: Sendable, Equatable {
    /// The destination URL (web `learnMore.url`).
    public let url: URL
    /// Optional link label; `nil` resolves to the localized "Learn more" (web `learnMore.label`).
    public let label: String?

    public init(url: URL, label: String? = nil) {
        self.url = url
        self.label = label
    }
}

/// The contextual help config — the native peer of the props the web card forwards to
/// `<HelpTooltip>`. Either `text` (plain copy) or `i18nKey` (+ `defaultValue` fallback) supplies the
/// body; when neither resolves to anything the "?" is not shown (web `if (!resolved) return null`).
/// `placement` mirrors the web tooltip side; `ariaLabel` overrides the default VoiceOver label
/// (web default `More info about {label}`, resolved in the model so it can interpolate the label).
public struct MetricCardHelp: Sendable, Equatable {
    /// Tooltip side relative to the "?" trigger — web `placement`, default `top`.
    public enum Placement: String, Sendable, Equatable, CaseIterable {
        case top
        case bottom
        case leading
        case trailing

        /// The web default (`placement = 'top'`).
        public static let defaultPlacement: Placement = .top
    }

    /// Plain-text body (web `text`); prefer `i18nKey` when localizing.
    public let text: String?
    /// i18n key for the body (web `i18nKey`), paired with `defaultValue` for the English fallback.
    public let i18nKey: String?
    /// Fallback used when `i18nKey` is missing from the catalog (web `defaultValue`).
    public let defaultValue: String?
    /// Optional "Learn more" link rendered below the body (web `learnMore`).
    public let learnMore: MetricCardLearnMore?
    /// Tooltip side (web `placement`).
    public let placement: Placement
    /// Override for the trigger's VoiceOver label (web `ariaLabel`).
    public let ariaLabel: String?

    public init(
        text: String? = nil,
        i18nKey: String? = nil,
        defaultValue: String? = nil,
        learnMore: MetricCardLearnMore? = nil,
        placement: Placement = .defaultPlacement,
        ariaLabel: String? = nil
    ) {
        self.text = text
        self.i18nKey = i18nKey
        self.defaultValue = defaultValue
        self.learnMore = learnMore
        self.placement = placement
        self.ariaLabel = ariaLabel
    }

    /// The resolved tooltip body — web `i18nKey ? t(i18nKey, {defaultValue}) : (text ?? '')`. An
    /// `i18nKey` resolves through the app catalog (P1/S10) with the `defaultValue` fallback; otherwise
    /// the plain `text` is used. Empty means "render no '?'", exactly like the web `return null`.
    public var resolvedBody: String {
        if let i18nKey {
            return NSLocalizedString(
                i18nKey,
                tableName: nil,
                bundle: .main,
                value: defaultValue ?? "",
                comment: ""
            )
        }
        return text ?? ""
    }

    /// Whether the "?" affordance is shown at all — web `!!resolved`.
    public var hasBody: Bool {
        !resolvedBody.isEmpty
    }
}

// MARK: - MetricCardInputs (web props)

/// The component's props — the native peer of `MetricCardProps`. A value type so the view, the
/// state-holder, and the pure projection all agree on one shape, and so a SwiftUI `.onChange` can
/// detect a prop change cheaply when a reused cell rebinds.
public struct MetricCardInputs: Sendable, Equatable {
    /// The metric label shown above the value (web `label`).
    public let label: String
    /// The headline value (web `value`).
    public let value: MetricCardValue
    /// The optional SF Symbol shown in the colored box (web `icon`, a decorative `ReactNode`).
    public let iconSystemName: String?
    /// The accent color (web `color`, default cyan).
    public let color: MetricCardColor
    /// The legacy change pill (web `change`); shown only when `delta == nil`.
    public let change: MetricCardChange?
    /// The direction-aware delta (web `delta`); takes precedence over `change`.
    public let delta: MetricCardDelta?
    /// The optional muted subtitle below the value (web `subtitle`).
    public let subtitle: String?
    /// The optional contextual help "?" next to the label (web `help`).
    public let help: MetricCardHelp?

    public init(
        label: String,
        value: MetricCardValue,
        iconSystemName: String? = nil,
        color: MetricCardColor = .defaultColor,
        change: MetricCardChange? = nil,
        delta: MetricCardDelta? = nil,
        subtitle: String? = nil,
        help: MetricCardHelp? = nil
    ) {
        self.label = label
        self.value = value
        self.iconSystemName = iconSystemName
        self.color = color
        self.change = change
        self.delta = delta
        self.subtitle = subtitle
        self.help = help
    }
}
