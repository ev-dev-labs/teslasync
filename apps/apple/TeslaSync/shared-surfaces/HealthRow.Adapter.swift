//
//  HealthRow.Adapter.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  The testable, dependency-light core for the single-line health summary row — the SwiftUI parity of
//  components/status/HealthRow.tsx. This file is the Foundation-only heart of the native peer: the
//  surface identity (the diagnostics slug), the status axis (``HealthRowStatus`` — the native peer of
//  the web `HeroStatus` union), the activation axis (``HealthRowActivationKind``), and the structural
//  props value type (``HealthRowInputs``). No SwiftUI, no @Observable — so every rule is unit testable
//  in isolation.
//
//  Faithful-parity note: the web `HealthRow` is a PURE presentational primitive. It binds NO data hook
//  at all (not even `useTranslation`); it maps a handful of props — a status, an optional icon node, a
//  label, a summary, and a `to` / `external` / `onClick` activation — onto an icon + label + summary +
//  chevron row whose dot and summary text recolour by status. It therefore has NO loading, error,
//  stale, or offline branch — there is nothing to load, fail, go stale, or lose connectivity to.
//  Inventing such chrome would fabricate states the source does not have (and contradict the web spec),
//  so this surface reproduces ONLY the source's REAL branches, exactly as the sibling presentational
//  primitive HistoryListRow (0091) did. The real, prop-driven branches are:
//    • status — healthy / degraded / unhealthy / unknown / maintenance (drives the dot + summary hue).
//    • icon present / absent (a decorative leading glyph).
//    • activation — none (inert row), an internal link (web `to`), an external link (web `to` +
//      `external`, opens out of app), or an action (web `onClick`); the chevron shows iff navigable.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `HealthRow`; this surface keeps the same slug here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum HealthRowSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HealthRow"
}

// MARK: - HealthRowStatus (web `HeroStatus` union)

/// The health status — the native peer of the web `HeroStatus`
/// (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`) imported from `StatusHero`.
/// It drives the leading dot colour and the right-aligned summary's text colour. Mapped to the shared,
/// theme-aware semantic tone tokens (P1/S9) in HealthRow.Views.swift, so the status recolours across
/// light / dark / high-contrast rather than the web's fixed `*-400` hues.
public enum HealthRowStatus: String, Sendable, Equatable, CaseIterable {
    /// All systems operational (web `healthy` → green dot/text).
    case healthy
    /// Degraded performance (web `degraded` → amber dot/text).
    case degraded
    /// Service outage (web `unhealthy` → red dot/text).
    case unhealthy
    /// Status unknown (web `unknown` → zinc dot/text).
    case unknown
    /// Scheduled maintenance (web `maintenance` → blue dot/text).
    case maintenance
}

// MARK: - HealthRowActivationKind (web `to` / `to`+`external` / `onClick` / neither)

/// The row's activation kind — the native peer of the web's `to` / `external` / `onClick` props. `link`
/// is the web internal `<Link to={to}>` wrap; `externalLink` is the web `<a href target="_blank">` wrap
/// (web `to` with `external`), which leaves the app; `action` is the web `<button onClick>`; and `none`
/// is the inert `<div>` (no `to`, no `onClick`). The concrete navigation closure + the `href` string
/// live on the view in ``HealthRowActivation``; this kind is the part that belongs in the Equatable
/// ``HealthRowInputs`` (closures are not Equatable). Note the web precedence: `to` wins over `onClick`,
/// so a row with both is a link.
public enum HealthRowActivationKind: String, Sendable, Equatable, CaseIterable {
    /// No `to` and no `onClick` — the row is an inert summary line (web `<div>`).
    case none
    /// Web internal `to` — the whole row navigates in-app (the native peer of react-router `<Link>`).
    case link
    /// Web `to` + `external` — the row opens an external target out of the app (web `target="_blank"`).
    case externalLink
    /// Web `onClick` (no `to`) — the row fires a handler on tap (web `<button>`).
    case action
}

// MARK: - HealthRowInputs (the Equatable structural props)

/// The structural props the surface renders from — the Equatable, Sendable subset of the web
/// `HealthRowProps`. It deliberately excludes the icon view + the activation closure (neither is
/// Equatable / Sendable); those live on the view and are passed straight to the content view. What
/// stays here is everything the pure projection + the `.onChange` reuse-guard need: the status, the
/// label + summary strings (web string props, not slots), the activation kind + its `href`, and the
/// icon-presence flag. A reused row that swaps its status / label / summary / link re-derives its
/// layout because these values change.
public struct HealthRowInputs: Sendable, Equatable {
    /// The health status driving the dot + summary hue (web `status`).
    public let status: HealthRowStatus
    /// The left-aligned row label (web `label` string prop).
    public let label: String
    /// The right-aligned summary, e.g. "12 / 12 healthy" (web `summary` string prop).
    public let summary: String
    /// Whether the decorative leading icon is present (web `icon != null`).
    public let hasIcon: Bool
    /// The activation kind — none / link / externalLink / action (web `to` / `external` / `onClick`).
    public let activationKind: HealthRowActivationKind
    /// The link target for the `link` / `externalLink` kinds (web `to`); `nil` otherwise.
    public let href: String?

    public init(
        status: HealthRowStatus,
        label: String,
        summary: String,
        hasIcon: Bool = false,
        activationKind: HealthRowActivationKind = .none,
        href: String? = nil
    ) {
        self.status = status
        self.label = label
        self.summary = summary
        self.hasIcon = hasIcon
        self.activationKind = activationKind
        self.href = href
    }
}
