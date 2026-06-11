//
//  InlineCallout.Adapter.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  The Foundation-only core for the single-line, low-chrome contextual callout — the SwiftUI parity of
//  `components/feedback/InlineCallout.tsx`. This file holds the surface identity (the diagnostics slug),
//  the severity tier (``InlineCalloutVariant``), the wrapper-interaction union (``InlineCalloutInteraction``
//  — the native peer of the web's `<a href>` / `<button onClick>` / `<div role="status">` choice), the
//  props value type (``InlineCalloutInput``), the view-ready ``InlineCalloutProjection``, and the pure
//  ``InlineCalloutProjector`` that maps one into the other. No SwiftUI and no `@Observable`, so every
//  rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<InlineCallout>` is a PURE presentational component. It maps
//  `(variant, icon?, children, action?) → an inline element` with no fetch, no React-Query cache, and no
//  Promise — so it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail,
//  age, or lose connectivity to). Inventing such chrome would fabricate states the source does not have,
//  so this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  primitives Delta (0081), MetricCard (0095), and BatteryDelta (0077) did. The real branches are the
//  four severity variants × the three wrapper interactions (status / link / button) × the optional
//  leading icon and trailing action affordance.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum InlineCalloutSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "InlineCallout"
}

// MARK: - InlineCalloutVariant (web `CalloutVariant`)

/// The severity tier — the native peer of the web `CalloutVariant` union (`info` / `success` /
/// `warning` / `danger`). Drives the tinted chrome + the body / icon colour (mapped to theme-aware
/// design tokens in InlineCallout.Views.swift, where the web used fixed Tailwind shades). The raw
/// values are byte-identical to the web tokens so a parity table can round-trip them.
public enum InlineCalloutVariant: String, Sendable, Equatable, CaseIterable {
    /// Neutral information — web `info` (cyan).
    case info
    /// A favorable outcome — web `success` (emerald).
    case success
    /// A caution worth attention — web `warning` (amber).
    case warning
    /// A failure / blocking issue — web `danger` (rose).
    case danger

    /// The severity SF Symbol used when the caller does not pass an explicit `icon` and opts into the
    /// variant's default glyph. Mirrors the team's canonical web-`<InlineCallout>` render
    /// (`KpiOverviewFooterView`): info → `info.circle.fill`, success → `checkmark.circle.fill`,
    /// warning → `exclamationmark.triangle.fill`, danger → `xmark.octagon.fill`.
    public var defaultIconSystemName: String {
        switch self {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.octagon.fill"
        }
    }
}

// MARK: - InlineCalloutInteraction (web wrapper choice)

/// The wrapper the callout renders into — the native peer of the web render decision: `action.href`
/// renders an `<a>` (``link``), `action.onClick` renders a `<button>` (``button``), and neither renders
/// a `<div role="status">` (``status``). The `onClick` closure itself is held by the state-holder
/// (``InlineCalloutModel``), not in this value, so the input stays `Equatable`.
public enum InlineCalloutInteraction: Sendable, Equatable {
    /// Non-interactive status row — web `<div role="status">`.
    case status
    /// Navigates to a URL — web `<a href>`.
    case link(URL)
    /// Invokes the host's in-app handler — web `<button onClick>`.
    case button

    /// Resolves the wrapper exactly like the web source: an `href` wins over an `onClick` ("passing
    /// both prefers `href`"); an `onClick` alone is a button; neither is the status row.
    public static func resolve(url: URL?, hasTapAction: Bool) -> InlineCalloutInteraction {
        if let url {
            return .link(url)
        }
        if hasTapAction {
            return .button
        }
        return .status
    }

    /// Whether the whole callout is clickable (web: the `<a>` / `<button>` branches gain hover + focus
    /// chrome, the `<div>` does not).
    public var isInteractive: Bool {
        switch self {
        case .status: false
        case .link, .button: true
        }
    }
}

// MARK: - InlineCalloutInput (web props, closure-free)

/// The component's props — the native peer of `InlineCalloutProps`, minus the `onClick` closure (held
/// by the state-holder). A value type so the view, the state-holder, and the pure projection agree on
/// one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when a reused callout
/// rebinds. `message` is the web `children` (a single inline insight in practice, e.g. "1 anomaly in
/// this range — Apr 24"); `iconSystemName` is the web `icon` (`nil` renders no leading glyph);
/// `actionLabel` is the web `action.label` (`nil` renders no trailing affordance).
public struct InlineCalloutInput: Sendable, Equatable {
    /// Severity tier (web `variant`).
    public let variant: InlineCalloutVariant
    /// Optional leading SF Symbol (web `icon`); `nil` renders no glyph.
    public let iconSystemName: String?
    /// The body text (web `children`).
    public let message: String
    /// Optional trailing action label (web `action.label`); `nil` renders no affordance.
    public let actionLabel: String?
    /// The resolved wrapper (web `<a>` / `<button>` / `<div role="status">`).
    public let interaction: InlineCalloutInteraction

    public init(
        variant: InlineCalloutVariant,
        iconSystemName: String? = nil,
        message: String,
        actionLabel: String? = nil,
        interaction: InlineCalloutInteraction = .status
    ) {
        self.variant = variant
        self.iconSystemName = iconSystemName
        self.message = message
        self.actionLabel = actionLabel
        self.interaction = interaction
    }
}

// MARK: - InlineCalloutProjection (view-ready)

/// The resolved, view-ready callout — everything the SwiftUI body needs as a pure function of this
/// value (no networking, no derivation in the view). `accessibilityLabel` is the composed VoiceOver
/// label (the accessible parity of the colour-encoded severity, which a sighted user perceives but a
/// VoiceOver user cannot — see ``InlineCalloutProjector``).
public struct InlineCalloutProjection: Sendable, Equatable {
    public let variant: InlineCalloutVariant
    public let iconSystemName: String?
    public let message: String
    public let trailingLabel: String?
    public let interaction: InlineCalloutInteraction
    public let accessibilityLabel: String

    /// Whether the callout is clickable (web `<a>` / `<button>`).
    public var isInteractive: Bool {
        interaction.isInteractive
    }

    public init(
        variant: InlineCalloutVariant,
        iconSystemName: String?,
        message: String,
        trailingLabel: String?,
        interaction: InlineCalloutInteraction,
        accessibilityLabel: String
    ) {
        self.variant = variant
        self.iconSystemName = iconSystemName
        self.message = message
        self.trailingLabel = trailingLabel
        self.interaction = interaction
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - InlineCalloutProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "cached → projection" sense the acceptance calls for: it takes the props a host already holds (no
/// fetch, no clock) plus an injected severity-word resolver (the P1/S10 facade) and derives the
/// rendered callout. Unit tested across every variant + interaction + the action / no-action label.
public enum InlineCalloutProjector {
    /// Resolves the callout. `severity` resolves the localized severity word for a variant (injected so
    /// the projector stays Foundation-only + facade-agnostic for tests).
    public static func resolve(
        _ input: InlineCalloutInput,
        severity: (InlineCalloutVariant) -> String
    ) -> InlineCalloutProjection {
        InlineCalloutProjection(
            variant: input.variant,
            iconSystemName: input.iconSystemName,
            message: input.message,
            trailingLabel: input.actionLabel,
            interaction: input.interaction,
            accessibilityLabel: accessibilityLabel(
                severity: severity(input.variant),
                message: input.message,
                actionLabel: input.actionLabel
            )
        )
    }

    /// Composes the VoiceOver label as "{severity}: {message}" (plus ", {action}" when an action label
    /// is present) — the same shape the sibling `KpiOverviewAccessibility.calloutLabel` uses for the
    /// web `<InlineCallout>`. Announcing the severity is the accessible parity of the web's colour-only
    /// severity signal; the leading icon and trailing chevron are decorative (web `aria-hidden`).
    static func accessibilityLabel(severity: String, message: String, actionLabel: String?) -> String {
        var label = "\(severity): \(message)"
        if let actionLabel, !actionLabel.isEmpty {
            label += ", \(actionLabel)"
        }
        return label
    }
}
