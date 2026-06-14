//
//  Typography.Adapter.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  The Foundation-only core for the typographic role system — the SwiftUI parity of
//  `components/ui/Typography.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the value types that mirror the web token unions (``TypographyRole`` — the 13 composed
//  roles of `typography.role`; ``TypographyHeadingLevel`` — the web `HeadingLevel`; the granular
//  ``TypographySize`` / ``TypographyWeight`` / ``TypographyColor`` of `typography.{size,weight,color}`),
//  the resolved, view-ready ``TypographyStyle`` projection, and the pure ``TypographyProjector`` that maps
//  a role (or a granular size/weight/color/mono composition, or a heading level) into a style. No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<Typography>` family (`Heading`, `Text`, and the `PageTitle` … `Code`
//  convenience peers) is a PURE presentational primitive. It maps `(role | size/weight/color/mono) →
//  styled text` with no fetch, no React-Query cache, and no Promise — so it has NO loading, error, stale,
//  or offline branch (there is nothing to fetch, fail, age, or lose connectivity to; the hosted text is a
//  caller-supplied, already-localized prop, exactly like the web `children`). Inventing such chrome would
//  fabricate states the source does not have, so this surface reproduces only the source's REAL branches —
//  exactly as the sibling presentational primitives Delta (0081), MetricCard (0095), InlineCallout (0124),
//  ActiveFilterChips (0147), StaggerItem (0194), and Accordion (0203) did. The real branches are: the four
//  heading levels, the thirteen composed roles, the granular size × weight × color × mono composition, and
//  the native "never a blank box" empty leaf when a host passes empty text.
//
//  The Dynamic-Type mapping is deliberate: rather than the fixed-point `Font.TS` ramp, each role resolves to
//  the closest semantic `Font.TextStyle` (in ``TypographyTextStyle``) so the text scales with the user's
//  preferred content size per Apple HIG, while weight / tracking / colour stay token-driven (P1/S9).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum TypographySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Typography"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<Typography>` family is anonymous (its text is a caller-supplied, already-localized prop and it calls no
/// `t()` of its own), so the only strings this surface owns are the native a11y additions (the empty-leaf
/// copy). Kept as a plain closure so the pure core has no dependency on a bundle: the production app passes
/// the P1/S10 facade, tests an identity resolver.
public typealias TypographyResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - TypographyRole (web `keyof typography.role`)

/// The composed text role — the native peer of the web `TypographyRole` union, the 13 canonical "kinds" of
/// text the app renders (`pageTitle` … `error`). Each resolves to a complete ``TypographyStyle`` via
/// ``TypographyProjector``. Raw values are byte-identical to the web token keys so a parity table can
/// round-trip them.
public enum TypographyRole: String, Sendable, Equatable, CaseIterable {
    case pageTitle
    case sectionTitle
    case panelTitle
    case subhead
    case body
    case bodySm
    case caption
    case label
    case metricValue
    case metricLabel
    case code
    case helper
    case error
}

// MARK: - TypographyHeadingLevel (web `HeadingLevel`)

/// The heading level — the native peer of the web `HeadingLevel` union (`page` / `section` / `panel` /
/// `sub`). Maps onto a heading ``TypographyRole`` (the web `HEADING_ROLE` table) and carries the semantic
/// rank used for the VoiceOver heading trait (the web `HEADING_TAG` h1–h4).
public enum TypographyHeadingLevel: String, Sendable, Equatable, CaseIterable {
    case page
    case section
    case panel
    case sub

    /// The composed role for this level — the web `HEADING_ROLE[level]`.
    public var role: TypographyRole {
        switch self {
        case .page: .pageTitle
        case .section: .sectionTitle
        case .panel: .panelTitle
        case .sub: .subhead
        }
    }

    /// The semantic heading rank 1…4 — the web `HEADING_TAG` h1…h4, surfaced to VoiceOver as the heading
    /// level so assistive tech can navigate by heading.
    public var headingRank: Int {
        switch self {
        case .page: 1
        case .section: 2
        case .panel: 3
        case .sub: 4
        }
    }
}

// MARK: - Granular tokens (web `typography.{size,weight,color}`)

/// The granular type scale — the native peer of the web `TypographySize` union (`typography.size`). The case
/// names avoid leading digits (a Swift identifier rule); the raw values carry the web token keys
/// (`2xs` … `3xl`). The cases are declared in ascending size order.
public enum TypographySize: String, Sendable, Equatable, CaseIterable {
    case twoXs = "2xs"
    case xs
    case sm
    case base
    case lg
    case xl
    case twoXl = "2xl"
    case threeXl = "3xl"
}

/// The granular weight scale — the native peer of the web `TypographyWeight` union (`typography.weight`).
public enum TypographyWeight: String, Sendable, Equatable, CaseIterable {
    case regular
    case medium
    case semibold
    case bold
}

/// The granular colour scale — the native peer of the web `TypographyColor` union (`typography.color`).
/// Each maps onto a theme-aware ``TypographyColorToken`` so the surface stays token-driven (P1/S9) with no
/// raw `text-white/N` shades.
public enum TypographyColor: String, Sendable, Equatable, CaseIterable {
    case primary
    case secondary
    case muted
    case subtle
    case disabled
    case inverse

    /// The resolved colour token (the View bridges this to a `Color.TS.*`).
    public var token: TypographyColorToken {
        switch self {
        case .primary: .primary
        case .secondary: .secondary
        case .muted: .muted
        case .subtle: .subtle
        case .disabled: .disabled
        case .inverse: .inverse
        }
    }
}

// MARK: - Resolved descriptors (bridged to SwiftUI in Typography.Views.swift)

/// The resolved, theme-aware colour slot a style paints with — the View maps each onto a `Color.TS.*`
/// design token. ``danger`` is the role-only slot the web `error` role uses (`text-rose-300`); it is not
/// reachable through the public granular ``TypographyColor`` API, matching the web (where `error` is a
/// composed role, not a granular colour).
public enum TypographyColorToken: String, Sendable, Equatable, CaseIterable {
    case primary
    case secondary
    case muted
    case subtle
    case disabled
    case inverse
    case danger
}

/// The resolved Dynamic-Type text style a role/size maps to — the native peer of the web px size, expressed
/// as a semantic `Font.TextStyle` so the text scales with the user's preferred content size (Apple HIG). The
/// cases are declared in ascending nominal size so ``scaleRank`` yields a monotonic ordinal for the size
/// ramp without a large `switch`.
public enum TypographyTextStyle: String, Sendable, Equatable, CaseIterable {
    case caption2
    case caption
    case footnote
    case subheadline
    case callout
    case body
    case headline
    case title3
    case title2
    case title
    case largeTitle

    /// The position of this style in the ascending-size declaration order — used to assert the granular
    /// size ramp maps to a non-decreasing text-style sequence.
    public var scaleRank: Int {
        Self.allCases.firstIndex(of: self) ?? 0
    }
}

/// The resolved font family axis — the native peer of the web `typography.family` (`sans` / `mono`).
public enum TypographyDesign: String, Sendable, Equatable, CaseIterable {
    case standard
    case monospaced
}

/// The resolved letter-spacing slot — the native peer of the web `tracking-*` utility, named after the
/// `TSTypeMetrics` tracking constant the View resolves it to (P1/S9), so no point literals live here.
public enum TypographyTracking: String, Sendable, Equatable, CaseIterable {
    case display
    case title
    case section
    case panel
    case body
    case bodySm
    case caption
    case label
}

// MARK: - TypographyStyle (view-ready)

/// The resolved, view-ready style — everything the SwiftUI body needs as a pure function of a role (or a
/// granular composition) with no derivation in the view. Mirrors one composed `typography.role` string:
/// `textStyle` + `weight` are the web `text-*` + `font-*`; `design` is the web `font-mono`; `color` is the
/// web `text-[var(--text-*)]`; `tracking` is the web `tracking-*`; `monospacedDigit` is the web
/// `tabular-nums`; `isUppercased` is the web `uppercase`; `isAccessibilityHeader` is the native VoiceOver
/// trait for the heading roles (the web semantic `<h1>`…`<h4>`).
public struct TypographyStyle: Sendable, Equatable {
    public let textStyle: TypographyTextStyle
    public let weight: TypographyWeight
    public let design: TypographyDesign
    public let color: TypographyColorToken
    public let tracking: TypographyTracking
    public let monospacedDigit: Bool
    public let isUppercased: Bool
    public let isAccessibilityHeader: Bool

    public init(
        textStyle: TypographyTextStyle,
        weight: TypographyWeight,
        design: TypographyDesign = .standard,
        color: TypographyColorToken,
        tracking: TypographyTracking,
        monospacedDigit: Bool = false,
        isUppercased: Bool = false,
        isAccessibilityHeader: Bool = false
    ) {
        self.textStyle = textStyle
        self.weight = weight
        self.design = design
        self.color = color
        self.tracking = tracking
        self.monospacedDigit = monospacedDigit
        self.isUppercased = isUppercased
        self.isAccessibilityHeader = isAccessibilityHeader
    }
}

// MARK: - TypographyProjector (web render body)

/// The pure projection from a role (or a granular composition, or a heading level) to the view-ready
/// ``TypographyStyle`` — the surface's data adapter in the "input → projection" sense the acceptance calls
/// for: it takes the props a host already holds (no fetch, no clock) and derives the rendered style. Unit
/// tested across every role, the granular composition, the heading-level table, and the size ramp.
public enum TypographyProjector {
    /// The composed-role table — the native port of `typography.role`. A dictionary (not a `switch`) so the
    /// 13-way mapping stays declarative; ``roleStyles`` completeness is asserted in the adapter tests.
    static let roleStyles: [TypographyRole: TypographyStyle] = [
        .pageTitle: TypographyStyle(
            textStyle: .largeTitle, weight: .bold, color: .primary,
            tracking: .display, isAccessibilityHeader: true
        ),
        .sectionTitle: TypographyStyle(
            textStyle: .title3, weight: .semibold, color: .primary,
            tracking: .section, isAccessibilityHeader: true
        ),
        .panelTitle: TypographyStyle(
            textStyle: .headline, weight: .semibold, color: .primary,
            tracking: .panel, isAccessibilityHeader: true
        ),
        .subhead: TypographyStyle(
            textStyle: .subheadline, weight: .medium, color: .secondary,
            tracking: .body, isAccessibilityHeader: true
        ),
        .body: TypographyStyle(
            textStyle: .subheadline, weight: .regular, color: .primary, tracking: .body
        ),
        .bodySm: TypographyStyle(
            textStyle: .footnote, weight: .regular, color: .secondary, tracking: .bodySm
        ),
        .caption: TypographyStyle(
            textStyle: .caption, weight: .regular, color: .muted, tracking: .caption
        ),
        .label: TypographyStyle(
            textStyle: .caption, weight: .medium, color: .muted,
            tracking: .label, isUppercased: true
        ),
        .metricValue: TypographyStyle(
            textStyle: .title, weight: .bold, color: .primary,
            tracking: .title, monospacedDigit: true
        ),
        .metricLabel: TypographyStyle(
            textStyle: .caption2, weight: .medium, color: .muted,
            tracking: .label, isUppercased: true
        ),
        .code: TypographyStyle(
            textStyle: .caption, weight: .regular, design: .monospaced,
            color: .primary, tracking: .caption
        ),
        .helper: TypographyStyle(
            textStyle: .caption, weight: .regular, color: .muted, tracking: .caption
        ),
        .error: TypographyStyle(
            textStyle: .caption, weight: .regular, color: .danger, tracking: .caption
        )
    ]

    /// The granular size table — the native port of `typography.size`. A dictionary keeps the 8-way mapping
    /// declarative and monotonic (the cases of ``TypographyTextStyle`` are size-ordered, so the ranks below
    /// strictly increase across the ramp).
    static let sizeTextStyles: [TypographySize: TypographyTextStyle] = [
        .twoXs: .caption2,
        .xs: .caption,
        .sm: .footnote,
        .base: .callout,
        .lg: .body,
        .xl: .title3,
        .twoXl: .title2,
        .threeXl: .title
    ]

    /// The base style a granular ``Typography`` composition starts from before the caller's size / weight /
    /// color / mono overrides are applied — the native peer of the web `<Text>` with no `variant` (a bare
    /// span that, absent any granular class, renders comfortable primary body text).
    public static let granularBase = TypographyStyle(
        textStyle: .subheadline, weight: .regular, design: .standard,
        color: .primary, tracking: .body
    )

    /// Resolves the complete style for a composed role — the web `typography.role[variant]`.
    public static func style(for role: TypographyRole) -> TypographyStyle {
        roleStyles[role] ?? granularBase
    }

    /// Resolves the style for a heading level — the web `<Heading level>` → `typography.role[HEADING_ROLE]`.
    public static func style(forLevel level: TypographyHeadingLevel) -> TypographyStyle {
        style(for: level.role)
    }

    /// Resolves the granular composition — the web `<Text size weight color mono>`: it starts from
    /// ``granularBase`` and applies only the dimensions the caller supplied (the web `size && …`,
    /// `weight && …`, `color && …`, `mono && …`), so an unset dimension keeps the base value.
    public static func style(
        size: TypographySize? = nil,
        weight: TypographyWeight? = nil,
        color: TypographyColor? = nil,
        mono: Bool = false
    ) -> TypographyStyle {
        TypographyStyle(
            textStyle: size.map(textStyle(for:)) ?? granularBase.textStyle,
            weight: weight ?? granularBase.weight,
            design: mono ? .monospaced : granularBase.design,
            color: color?.token ?? granularBase.color,
            tracking: granularBase.tracking
        )
    }

    /// The text style for a granular size — the web `typography.size[size]`.
    public static func textStyle(for size: TypographySize) -> TypographyTextStyle {
        sizeTextStyles[size] ?? granularBase.textStyle
    }
}
