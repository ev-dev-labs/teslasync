//
//  HistoryListRow.Projection.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  The pure projection from the structural props to the view-ready model the SwiftUI body renders —
//  the native port of the web `HistoryListRow` render body. The web component collapses its props +
//  slot presence into a fixed set of layout decisions: whether the checkbox column renders, whether
//  the leading column renders, which of the route / metrics / insight lines render, whether the
//  hover-revealed actions overlay renders, whether the trailing chevron renders, whether the panel
//  carries the selected tint, and — from `href` / `onClick` — whether the row is an interactive
//  (link / button) element. This projection bakes every one of those decisions into a
//  ``HistoryListRowProjection`` the view consumes as a pure function; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``HistoryListRowProjector/resolve(inputs:)`` takes the cached structural props (what a drive /
//  charging row already holds — which slots it populated, whether it is selected, where it links) and
//  derives the rendered layout decisions — no networking, no clock, no SwiftUI.
//

import Foundation

// MARK: - HistoryListRowProjection (web `HistoryListRow` render output)

/// The resolved, view-ready layout decisions — the native bundle of everything the web
/// `HistoryListRow` render body decides from its props + slot presence. The view is a pure function
/// of this value: it renders the checkbox column iff `showsCheckbox`, the leading column iff
/// `showsLeading`, each of the route / metrics / insight lines iff its flag is set, the actions
/// overlay iff `showsActions`, the chevron iff `showsChevron`, the selected tint iff `isSelected`,
/// and wraps the body in an interactive (link / button) element iff `isNavigable`.
public struct HistoryListRowProjection: Sendable, Equatable {
    /// Whether the row navigates / fires on tap (web `href` or `onClick` present).
    public let isNavigable: Bool
    /// The activation kind carried through for the view + a11y traits + tests (web href/onClick).
    public let activationKind: HistoryListRowActivationKind
    /// The link target, surfaced for accessibility + tests (web `href`); `nil` unless `link`.
    public let href: String?
    /// Whether the panel carries the selected tint + ring (web `selected`).
    public let isSelected: Bool
    /// The resolved glow colour axis (web `glow`).
    public let glow: HistoryListRowGlow
    /// Whether the tap-isolated checkbox column renders (web `checkbox != null`).
    public let showsCheckbox: Bool
    /// Whether the fixed-width leading badge column renders (web `leading != null`).
    public let showsLeading: Bool
    /// Whether the second (route) line renders (web `route &&`).
    public let showsRoute: Bool
    /// Whether the third (metrics) line renders (web `metrics &&`).
    public let showsMetrics: Bool
    /// Whether the fourth (insight) slot renders (web `insight &&`).
    public let showsInsight: Bool
    /// Whether the hover-revealed actions overlay renders (web `actions && actions.length > 0`).
    public let showsActions: Bool
    /// The number of action buttons in the overlay (web `actions.map`).
    public let actionCount: Int
    /// Whether the trailing chevron renders (web `!hideChevron`).
    public let showsChevron: Bool
    /// Whether VoiceOver should announce the row as a button (web `onClick` activation).
    public let accessibilityIsButton: Bool
    /// Whether VoiceOver should announce the row as a link (web `href` activation).
    public let accessibilityIsLink: Bool

    public init(
        isNavigable: Bool,
        activationKind: HistoryListRowActivationKind,
        href: String?,
        isSelected: Bool,
        glow: HistoryListRowGlow,
        showsCheckbox: Bool,
        showsLeading: Bool,
        showsRoute: Bool,
        showsMetrics: Bool,
        showsInsight: Bool,
        showsActions: Bool,
        actionCount: Int,
        showsChevron: Bool,
        accessibilityIsButton: Bool,
        accessibilityIsLink: Bool
    ) {
        self.isNavigable = isNavigable
        self.activationKind = activationKind
        self.href = href
        self.isSelected = isSelected
        self.glow = glow
        self.showsCheckbox = showsCheckbox
        self.showsLeading = showsLeading
        self.showsRoute = showsRoute
        self.showsMetrics = showsMetrics
        self.showsInsight = showsInsight
        self.showsActions = showsActions
        self.actionCount = actionCount
        self.showsChevron = showsChevron
        self.accessibilityIsButton = accessibilityIsButton
        self.accessibilityIsLink = accessibilityIsLink
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection to the view-ready layout decisions — the verbatim port of the web `HistoryListRow`
/// render body. Kept as a pure function over the caller-owned structural props so every branch (each
/// slot present / absent, each activation kind, selected, chevron) is unit tested without an
/// @Observable model or a view.
public enum HistoryListRowProjector {
    /// Resolves the layout decisions exactly like the web component:
    ///   • `showsCheckbox = checkbox != null`, `showsLeading = leading != null`.
    ///   • `showsRoute / showsMetrics / showsInsight` mirror the web `route && / metrics && /
    ///     insight &&` short-circuit renders.
    ///   • `showsActions = actions != null && actions.length > 0` (web guard); `actionCount` carries
    ///     the count through for the overlay + tests.
    ///   • `showsChevron = !hideChevron` (web `{!hideChevron && <ChevronRight/>}`).
    ///   • `isSelected = selected`, `glow` passes through.
    ///   • `isNavigable = activationKind != .none` (web `href || onClick`); the a11y traits split by
    ///     kind — `link` announces as a link (web `<Link>`), `action` announces as a button (web
    ///     `onClick` panel), so VoiceOver describes the row the way the web semantics imply.
    public static func resolve(inputs: HistoryListRowInputs) -> HistoryListRowProjection {
        let isNavigable = inputs.activationKind != .none
        return HistoryListRowProjection(
            isNavigable: isNavigable,
            activationKind: inputs.activationKind,
            href: inputs.activationKind == .link ? inputs.href : nil,
            isSelected: inputs.selected,
            glow: inputs.glow,
            showsCheckbox: inputs.hasCheckbox,
            showsLeading: inputs.hasLeading,
            showsRoute: inputs.hasRoute,
            showsMetrics: inputs.hasMetrics,
            showsInsight: inputs.hasInsight,
            showsActions: inputs.actionCount > 0,
            actionCount: inputs.actionCount,
            showsChevron: !inputs.hideChevron,
            accessibilityIsButton: inputs.activationKind == .action,
            accessibilityIsLink: inputs.activationKind == .link
        )
    }
}
