//
//  WidgetBigNumber.Adapter.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  The Foundation-only core for the big-number primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetBigNumber.tsx`. This file owns the surface identity (the
//  diagnostics slug + the web prop defaults), the value-color tone (``BigNumberValueTone``, the native
//  peer of the web `valueColor?` className passthrough), the badge value type (``BigNumberBadge`` +
//  ``BigNumberBadgeVariant``, the native peer of the web `badge` + its `badgeVariantMap`), the props
//  (``WidgetBigNumberInput``), the resolved value-state (``BigNumberValueDisplay``), the view-ready
//  projection (``WidgetBigNumberProjection``), the locale-aware number formatting
//  (``BigNumberFormatting``), and the pure ``WidgetBigNumberProjector`` that ports the web render
//  decision (the `value !== null` / `animated` branching, the muted `nullDisplay` fallback). No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note — states. The web `<WidgetBigNumber>` is a PURE presentational widget primitive
//  (a shared building block). It takes its data as plain props (`value`, `unit`, `label`, `subtitle`,
//  `badge`, …) and renders, with no fetch, no React-Query cache, and no Promise — so it has NO loading,
//  error, stale, or offline branch (there is nothing to fetch, fail, age, or lose connectivity to; the
//  host widget that owns the query renders those). Synthesising such chrome would fabricate states the
//  source does not have, so this surface reproduces ONLY the source's REAL branches — exactly as the
//  sibling presentational primitives WidgetComparisonCard (0003), WidgetStatGrid (0010), Delta (0081),
//  and MetricCard (0095) did. The real branches the source has, and this core models, are:
//    • value present, animated  — the web `<AnimatedNumber value={value} className="text-3xl font-bold" />`
//    • value present, static    — the web `<span className="text-3xl font-bold tabular-nums">{value}</span>`
//    • value null (the empty)   — the web `<span className="… text-[var(--text-muted)]">{nullDisplay}</span>`
//  plus the optional `unit` / `label` / `subtitle` / `badge` affixes, which decorate every branch.
//

import Foundation

// MARK: - Surface identity + web defaults (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11) and
/// the web prop defaults. Kept SwiftUI-free so the state-holder can emit telemetry without depending on
/// the view layer.
public enum WidgetBigNumberSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetBigNumber"

    /// The web `nullDisplay = '—'` default — shown (muted) when `value` is `null`.
    public static let defaultNullDisplay = "—"

    /// The web `animated = true` default — the value counts up unless the caller opts out.
    public static let defaultAnimated = true

    /// The web `valueColor = 'text-white'` default — the primary text token is the native peer of white
    /// (it resolves to white in dark and to the high-ink ink color in light/high-contrast).
    public static let defaultValueTone: BigNumberValueTone = .primary
}

// MARK: - BigNumberValueTone (web `valueColor?: string`)

/// The semantic color of the headline value — the native, theme-aware projection of the web
/// `valueColor?: string` className passthrough. The web forwards an arbitrary Tailwind class; porting raw
/// classes is forbidden (no Tailwind ports), so — exactly as ``StatValueTone`` (0010) and `MetricCardColor`
/// (0095) map the web class to design tokens — this enum maps the value's intent to a P1/S9 token so it
/// recolors across light / dark / high-contrast. The `nil`-equivalent default is ``primary`` (web
/// `'text-white'`).
public enum BigNumberValueTone: Sendable, Equatable, CaseIterable {
    case primary
    case secondary
    case muted
    case success
    case danger
    case warning
    case accent
}

// MARK: - BigNumberBadgeVariant (web `badge.variant` + `badgeVariantMap`)

/// The badge's semantic variant — the native peer of the web `badge.variant`
/// (`'success' | 'warning' | 'error' | 'neutral'`). The web maps it through `badgeVariantMap`
/// (`error → 'danger'`) before handing it to the shared `<Badge>`; that mapping to the shared tone is
/// applied natively in the view layer (`BigNumberBadgeVariant.tone`), keeping this enum's vocabulary
/// identical to the web prop.
public enum BigNumberBadgeVariant: Sendable, Equatable, CaseIterable {
    case success
    case warning
    case error
    case neutral
}

// MARK: - BigNumberBadge (web `badge?: { text, variant }`)

/// The optional trailing badge — the native peer of the web `badge?: { text; variant }`. `text` is the
/// caller-supplied, already-localized chip copy (rendered verbatim, like the web children); `variant`
/// selects the tone. A present value is the web "badge present" case; `nil` is "render no badge".
public struct BigNumberBadge: Sendable, Equatable {
    /// The chip copy (web `badge.text`) — caller-supplied + already localized, rendered verbatim.
    public let text: String
    /// The chip's semantic variant (web `badge.variant`).
    public let variant: BigNumberBadgeVariant

    public init(text: String, variant: BigNumberBadgeVariant) {
        self.text = text
        self.variant = variant
    }
}

// MARK: - WidgetBigNumberInput (web props)

/// The component's props — the native peer of `WidgetBigNumberProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a
/// prop change cheaply when a reused surface rebinds. `value` is the web `number | null`; `valueTone`
/// is the web `valueColor?` (defaulting to ``BigNumberValueTone/primary``); `nullDisplay` / `animated`
/// carry the web defaults; `locale` drives the number grouping/decimal conventions the web reads from
/// the global formatter.
public struct WidgetBigNumberInput: Sendable, Equatable {
    /// The headline value (web `value: number | null`); `nil` resolves to the muted `nullDisplay`.
    public let value: Double?
    /// The optional trailing unit affix (web `unit?`); `nil` / empty renders no affix.
    public let unit: String?
    /// The optional uppercase caption under the value (web `label?`); `nil` / empty renders nothing.
    public let label: String?
    /// The optional supporting line under the label (web `subtitle?`); `nil` / empty renders nothing.
    public let subtitle: String?
    /// The optional trailing badge (web `badge?`); `nil` renders no badge.
    public let badge: BigNumberBadge?
    /// The value's semantic color (web `valueColor?`), defaulting to ``BigNumberValueTone/primary``.
    public let valueTone: BigNumberValueTone
    /// The null value shown (muted) when `value` is `nil` (web `nullDisplay = '—'`).
    public let nullDisplay: String
    /// Whether the value counts up on appear (web `animated = true`).
    public let animated: Bool
    /// The locale that drives grouping separators and the decimal mark (web global-formatter read).
    public let locale: Locale

    public init(
        value: Double?,
        unit: String? = nil,
        label: String? = nil,
        subtitle: String? = nil,
        badge: BigNumberBadge? = nil,
        valueTone: BigNumberValueTone = WidgetBigNumberSurface.defaultValueTone,
        nullDisplay: String = WidgetBigNumberSurface.defaultNullDisplay,
        animated: Bool = WidgetBigNumberSurface.defaultAnimated,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.value = value
        self.unit = unit
        self.label = label
        self.subtitle = subtitle
        self.badge = badge
        self.valueTone = valueTone
        self.nullDisplay = nullDisplay
        self.animated = animated
        self.locale = locale
    }
}

// MARK: - BigNumberValueDisplay (resolved value-state)

/// The resolved headline-value render state — the three real branches of the web value slot. `animated`
/// carries the raw target (fed to the native `AnimatedNumber` count-up, the peer of the web
/// `<AnimatedNumber value={value} />`) plus the pre-formatted settled string (for the VoiceOver reading)
/// and the value tone; `staticValue` carries the pre-formatted string (the peer of the web
/// `tabular-nums` span) plus the tone; `nullDisplay` carries the `nullDisplay` text and is always muted
/// (the web null branch hard-codes `text-[var(--text-muted)]` regardless of `valueColor`).
public enum BigNumberValueDisplay: Sendable, Equatable {
    /// Value present + animated — the web `<AnimatedNumber value={value} />`. Carries the raw target +
    /// the `locale` the native `AnimatedNumber` formats its rolling frames with, plus the settled string
    /// (for a11y) and the value tone.
    case animated(raw: Double, settled: String, tone: BigNumberValueTone, locale: Locale)
    /// Value present + not animated — the web `<span className="… tabular-nums">{value}</span>`.
    case staticValue(text: String, tone: BigNumberValueTone)
    /// Value `nil` — the web muted `<span>{nullDisplay}</span>` (always muted).
    case nullDisplay(text: String)

    /// The settled on-screen string for the value — the VoiceOver reading (the meaningful figure, not a
    /// mid-tween frame). For the null branch, the `nullDisplay` text itself.
    public var spokenText: String {
        switch self {
        case let .animated(_, settled, _, _): settled
        case let .staticValue(text, _): text
        case let .nullDisplay(text): text
        }
    }
}

// MARK: - WidgetBigNumberProjection (web render output)

/// The resolved, view-ready render decision — everything the SwiftUI surface needs as a pure function of
/// the props (no derivation in the view). It always renders (the web component always returns markup; a
/// `nil` value renders the muted `nullDisplay`, the source's own "no value" presentation), so this is a
/// struct rather than a populated/empty enum: the value slot (``BigNumberValueDisplay``) carries the
/// real-state discriminator, and the optional `unit` / `label` / `subtitle` / `badge` decorate it.
public struct WidgetBigNumberProjection: Sendable, Equatable {
    /// The resolved headline value slot (animated / static / null value).
    public let value: BigNumberValueDisplay
    /// The optional trailing unit affix (web `unit?`).
    public let unit: String?
    /// The optional uppercase caption (web `label?`).
    public let label: String?
    /// The optional supporting line (web `subtitle?`).
    public let subtitle: String?
    /// The optional trailing badge (web `badge?`).
    public let badge: BigNumberBadge?

    public init(
        value: BigNumberValueDisplay,
        unit: String?,
        label: String?,
        subtitle: String?,
        badge: BigNumberBadge?
    ) {
        self.value = value
        self.unit = unit
        self.label = label
        self.subtitle = subtitle
        self.badge = badge
    }
}

// MARK: - BigNumberFormatting (web `fmtNumber` / raw `{value}`)

/// The locale-aware number formatting for the value — the native shape of the two web value paths. The
/// animated path mirrors the web `<AnimatedNumber>` default precision (`decimals = 0`, locale grouping);
/// the static path mirrors the web raw `{value}` but with locale grouping and natural fraction digits
/// (the native polish over JS `toString`, which omits grouping). Pure value-type formatting (no shared
/// mutable `NumberFormatter`).
public enum BigNumberFormatting {
    /// The upper bound on fraction digits for the static path — wide enough to represent a natural
    /// decimal value while clamping floating-point noise (`0.1 + 0.2` rounds back to `0.3`).
    public static let staticMaxFractionDigits = 6

    /// A non-finite value (NaN / ±Infinity) formats as zero rather than reaching the formatter and
    /// producing "NaN" — the parity of the web `safeNumber`.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// The settled animated string — exactly 0 fraction digits with locale grouping, matching the native
    /// `AnimatedNumber` default precision (the web `<AnimatedNumber value={value} />`).
    public static func animatedSettled(_ value: Double, locale: Locale) -> String {
        safe(value).formatted(
            .number
                .precision(.fractionLength(0))
                .grouping(.automatic)
                .locale(locale)
        )
    }

    /// The static string — locale grouping with natural fraction digits (`0...staticMaxFractionDigits`),
    /// so an integer renders without a decimal mark and a fractional value renders its real digits (the
    /// native peer of the web `tabular-nums` span's raw `{value}`).
    public static func staticDisplay(_ value: Double, locale: Locale) -> String {
        safe(value).formatted(
            .number
                .precision(.fractionLength(0 ... staticMaxFractionDigits))
                .grouping(.automatic)
                .locale(locale)
        )
    }
}

// MARK: - WidgetBigNumberProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no
/// fetch, no clock) and derives the rendered slot. Unit tested across the `nil` → null value fallback,
/// the `animated` branch, the static branch, and the affix passthrough.
public enum WidgetBigNumberProjector {
    /// Resolves the headline value slot — the verbatim port of the web value decision:
    /// `value !== null ? (animated ? <AnimatedNumber/> : <span/>) : <span muted>{nullDisplay}</span>`.
    public static func valueDisplay(_ input: WidgetBigNumberInput) -> BigNumberValueDisplay {
        guard let value = input.value else {
            return .nullDisplay(text: input.nullDisplay)
        }
        if input.animated {
            return .animated(
                raw: value,
                settled: BigNumberFormatting.animatedSettled(value, locale: input.locale),
                tone: input.valueTone,
                locale: input.locale
            )
        }
        return .staticValue(
            text: BigNumberFormatting.staticDisplay(value, locale: input.locale),
            tone: input.valueTone
        )
    }

    /// Resolves the whole render decision from the props — the native peer of the web component's render.
    public static func resolve(_ input: WidgetBigNumberInput) -> WidgetBigNumberProjection {
        WidgetBigNumberProjection(
            value: valueDisplay(input),
            unit: input.unit,
            label: input.label,
            subtitle: input.subtitle,
            badge: input.badge
        )
    }
}
