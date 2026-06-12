//
//  HealthRow.Projection.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  The pure projection from the structural props to the view-ready model the SwiftUI body renders —
//  the native port of the web `HealthRow` render body. The web component collapses its props into a
//  fixed set of layout decisions: the status (which colours the dot + summary), whether the decorative
//  icon renders, the label + summary strings, whether the trailing chevron renders, and — from `to` /
//  `external` / `onClick` — whether the row is an interactive (link / button) element and whether it
//  leaves the app. This projection bakes every one of those decisions into a ``HealthRowProjection``
//  the view consumes as a pure function; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``HealthRowProjector/resolve(inputs:)`` takes the cached structural props (the status / label /
//  summary / link a caller already holds) and derives the rendered layout decisions — no networking,
//  no clock, no SwiftUI. The localized accessibility label + hint are composed in the @Observable model
//  (HealthRow.Model.swift), which owns the i18n facade, so this projection stays prose-free and pure.
//

import Foundation

// MARK: - HealthRowProjection (web `HealthRow` render output)

/// The resolved, view-ready layout decisions — the native bundle of everything the web `HealthRow`
/// render body decides from its props. The view is a pure function of this value: it tints the dot +
/// summary by `status`, renders the icon iff `showsIcon`, shows the chevron iff `showsChevron`, and
/// wraps the row in an interactive (link / button) element iff `isNavigable` (announcing it as a link
/// when `accessibilityIsLink`, opening externally when `opensExternally`).
public struct HealthRowProjection: Sendable, Equatable {
    /// The health status driving the dot + summary hue (web `status`).
    public let status: HealthRowStatus
    /// The left-aligned label, passed through for rendering + the accessibility label (web `label`).
    public let label: String
    /// The right-aligned summary, passed through for rendering + the accessibility label (web `summary`).
    public let summary: String
    /// Whether the decorative leading icon renders (web `icon != null`).
    public let showsIcon: Bool
    /// Whether the row navigates / fires on tap (web `to` or `onClick` present).
    public let isNavigable: Bool
    /// The activation kind carried through for the view + a11y traits + tests.
    public let activationKind: HealthRowActivationKind
    /// The link target, surfaced for accessibility + tests (web `to`); `nil` unless a link kind.
    public let href: String?
    /// Whether activating the row leaves the app (web `external` → `target="_blank"`).
    public let opensExternally: Bool
    /// Whether the trailing chevron renders (web `(to || onClick) && <ChevronRight/>`).
    public let showsChevron: Bool
    /// Whether VoiceOver should announce the row as a link (web `<Link>` / `<a>` activation).
    public let accessibilityIsLink: Bool
    /// Whether VoiceOver should announce the row as a button (web `onClick` activation).
    public let accessibilityIsButton: Bool

    public init(
        status: HealthRowStatus,
        label: String,
        summary: String,
        showsIcon: Bool,
        isNavigable: Bool,
        activationKind: HealthRowActivationKind,
        href: String?,
        opensExternally: Bool,
        showsChevron: Bool,
        accessibilityIsLink: Bool,
        accessibilityIsButton: Bool
    ) {
        self.status = status
        self.label = label
        self.summary = summary
        self.showsIcon = showsIcon
        self.isNavigable = isNavigable
        self.activationKind = activationKind
        self.href = href
        self.opensExternally = opensExternally
        self.showsChevron = showsChevron
        self.accessibilityIsLink = accessibilityIsLink
        self.accessibilityIsButton = accessibilityIsButton
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection to the view-ready layout decisions — the verbatim port of the web `HealthRow`
/// render body. Kept as a pure function over the caller-owned structural props so every branch (each
/// status, icon present / absent, each activation kind, chevron) is unit tested without an @Observable
/// model or a view.
public enum HealthRowProjector {
    /// Resolves the layout decisions exactly like the web component:
    ///   • `status` / `label` / `summary` pass through (the dot + summary tint + the two text runs).
    ///   • `showsIcon = icon != null`.
    ///   • `isNavigable = activationKind != .none` (web `to || onClick`); `showsChevron = isNavigable`
    ///     (web renders the chevron only when `to || onClick`).
    ///   • `href` is meaningful only for the `link` / `externalLink` kinds (web `to`); the `action`
    ///     kind drops it (web `onClick` has no `to`).
    ///   • `opensExternally = activationKind == .externalLink` (web `external` → new tab).
    ///   • the a11y traits split by kind — `link` / `externalLink` announce as a link (web `<Link>` /
    ///     `<a>`), `action` announces as a button (web `<button>`) — so VoiceOver describes the row the
    ///     way the web semantics imply.
    public static func resolve(inputs: HealthRowInputs) -> HealthRowProjection {
        let kind = inputs.activationKind
        let isNavigable = kind != .none
        let isLink = kind == .link || kind == .externalLink
        return HealthRowProjection(
            status: inputs.status,
            label: inputs.label,
            summary: inputs.summary,
            showsIcon: inputs.hasIcon,
            isNavigable: isNavigable,
            activationKind: kind,
            href: isLink ? inputs.href : nil,
            opensExternally: kind == .externalLink,
            showsChevron: isNavigable,
            accessibilityIsLink: isLink,
            accessibilityIsButton: kind == .action
        )
    }
}
