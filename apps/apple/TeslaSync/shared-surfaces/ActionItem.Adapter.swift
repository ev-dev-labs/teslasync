//
//  ActionItem.Adapter.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  The Foundation-only core for the single operator-task row — the SwiftUI parity of
//  `components/status/ActionItem.tsx`. This file owns the surface identity (the diagnostics slug), the
//  severity tier (``ActionSeverity`` — the native peer of the web `ActionSeverity` union), the CTA
//  interaction kind (``ActionItemCTAKind`` — the native peer of the web `ActionCTA`'s `<Link>` / `<a>` /
//  `<button>` choice), the closure-free CTA props (``ActionItemCTAInput``), and the props value type
//  (``ActionItemInput``). No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<ActionItem>` is a PURE presentational component. It maps
//  `(severity, title, description?, cta?) → a tinted, ringed row` with no fetch, no React-Query cache,
//  and no Promise — so it has NO loading, error, stale, or offline branch (there is nothing to fetch,
//  fail, age, or lose connectivity to; the hosting ``ActionItemsPanel`` owns those). Inventing such
//  chrome would fabricate states the source does not have, so this surface reproduces only the source's
//  REAL branches — exactly as the sibling presentational primitives HealthRow (0197), InlineCallout
//  (0124), and Accordion (0203) did. The real, prop-driven branches are: the three severity tiers ×
//  the optional description sub-line × the CTA wrapper (absent / internal route / external link / action
//  button), with the CTA's web precedence (`to` wins over `onClick`; a CTA with neither renders nothing).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum ActionItemSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ActionItem"
}

// MARK: - ActionSeverity (web `ActionSeverity` union)

/// The severity tier — the native peer of the web `ActionSeverity` union (`info` / `warn` / `error`).
/// It drives the leading glyph, the tinted background, the ring, and the CTA accent. Mapped to the
/// shared, theme-aware semantic tone tokens (P1/S9) in ActionItem.Views.swift, so the row recolours
/// across light / dark / high-contrast rather than the web's fixed `*-400` / `*-500` hues. The raw
/// values are byte-identical to the web tokens so a parity table can round-trip them.
public enum ActionSeverity: String, Sendable, Equatable, CaseIterable {
    /// Neutral, low-urgency information — web `info` (blue).
    case info
    /// A caution worth attention — web `warn` (amber).
    case warn
    /// A failure / blocking task — web `error` (red).
    case error

    /// The leading SF Symbol for the tier — the native peer of the web lucide glyph: `info` → the
    /// lucide `Info` (`info.circle`), `warn` → the lucide `AlertTriangle` (`exclamationmark.triangle`),
    /// `error` → the lucide `AlertCircle` (`exclamationmark.circle`). Outline glyphs are used to match
    /// the web's outline lucide style.
    public var iconSystemName: String {
        switch self {
        case .info: "info.circle"
        case .warn: "exclamationmark.triangle"
        case .error: "exclamationmark.circle"
        }
    }
}

// MARK: - ActionItemCTAKind (web `ActionCTA` wrapper choice)

/// The CTA wrapper — the native peer of the web `ActionCTA` render decision: an internal `to` renders an
/// `<Link to={to}>` (``route``), a `to` with `external` renders an `<a href target="_blank">`
/// (``externalLink``, which leaves the app), and an `onClick` (no `to`) renders a `<button onClick>`
/// (``action``). The concrete `to` string and the `perform` closure live on the view in ``ActionItemCTA``;
/// this kind is the closure-free part that belongs in the `Equatable` ``ActionItemCTAInput``. Note the web
/// precedence resolved in ``ActionItemProjector``: `to` wins over `onClick`, and a CTA with neither
/// renders nothing.
public enum ActionItemCTAKind: String, Sendable, Equatable, CaseIterable {
    /// Web internal `to` — the CTA navigates in-app (the native peer of react-router `<Link>`).
    case route
    /// Web `to` + `external` — the CTA opens an external target out of the app (web `target="_blank"`).
    case externalLink
    /// Web `onClick` (no `to`) — the CTA fires a handler on tap (web `<button>`).
    case action

    /// Whether the wrapper navigates to a target (web `<Link>` / `<a>`), as opposed to firing an in-app
    /// handler (web `<button>`). Drives the VoiceOver link trait + the navigation hint.
    public var isLink: Bool {
        switch self {
        case .route, .externalLink: true
        case .action: false
        }
    }

    /// Whether activating the CTA leaves the app (web `external` → `target="_blank"`). Drives the
    /// external VoiceOver hint.
    public var opensExternally: Bool {
        self == .externalLink
    }
}

// MARK: - ActionItemCTAInput (web `cta`, closure-free)

/// The CTA's props — the native peer of the web `cta` object (`{ label, to?, external?, onClick? }`),
/// minus the `perform` closure (held by the view + the state-holder). A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a
/// prop change cheaply when a reused row rebinds. `href` is the web `to` (`nil` for the ``action`` kind,
/// which has no target, exactly as the web `onClick` branch has no `href`).
public struct ActionItemCTAInput: Sendable, Equatable {
    /// The CTA button label (web `cta.label`) — caller-supplied + already localized, rendered verbatim.
    public let label: String
    /// The wrapper kind — route / externalLink / action (web `to` / `external` / `onClick`).
    public let kind: ActionItemCTAKind
    /// The link target for the `route` / `externalLink` kinds (web `cta.to`); `nil` for `action`.
    public let href: String?

    public init(label: String, kind: ActionItemCTAKind, href: String? = nil) {
        self.label = label
        self.kind = kind
        self.href = href
    }
}

// MARK: - ActionItemInput (web props, closure-free)

/// The component's props — the native peer of `ActionItemProps`, minus the `cta.onClick` closure (held
/// by the state-holder). A value type so the view, the state-holder, and the pure projection agree on
/// one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when a reused row rebinds.
/// `description` is the web optional sub-line (a `ReactNode` in the source — in practice a short string
/// such as "v1.2.0 → v1.3.0"); a host that needs rich inline content composes ``ActionItemContainer``
/// directly. `cta` is `nil` when the source passes no CTA (or a CTA the web `ActionCTA` resolves to
/// `null`).
public struct ActionItemInput: Sendable, Equatable {
    /// Severity tier (web `severity`) — drives the glyph + tint + ring + CTA accent.
    public let severity: ActionSeverity
    /// The primary task line (web `title`) — required, rendered verbatim.
    public let title: String
    /// The optional sub-line beneath the title (web `description`); `nil` renders no second line.
    public let description: String?
    /// The optional CTA (web `cta`); `nil` renders no trailing affordance.
    public let cta: ActionItemCTAInput?

    public init(
        severity: ActionSeverity,
        title: String,
        description: String? = nil,
        cta: ActionItemCTAInput? = nil
    ) {
        self.severity = severity
        self.title = title
        self.description = description
        self.cta = cta
    }
}
