//
//  HistoryListRow.Adapter.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  The testable, dependency-light core for the slot-based history row — the SwiftUI parity of
//  components/data-display/HistoryListRow.tsx. This file is the Foundation-only heart of the native
//  peer: the surface identity (the diagnostics slug), the glow axis (``HistoryListRowGlow``), the
//  activation axis (``HistoryListRowActivationKind``), and the structural props value type
//  (``HistoryListRowInputs``). No SwiftUI, no @Observable — so every rule is unit testable in
//  isolation.
//
//  Faithful-parity note: the web `HistoryListRow` is a PURE presentational, slot-based primitive. It
//  has NO data source at all — not even `useTranslation`; it maps slot nodes + a handful of structural
//  props to a `GlassPanel` layout. It therefore has NO loading, error, stale, or offline branch —
//  there is nothing to load, fail, go stale, or lose connectivity to. Inventing such chrome would
//  fabricate states the source does not have (and contradict the web spec), so this surface reproduces
//  ONLY the source's REAL branches, exactly as the sibling presentational primitives BatteryDelta
//  (0077) and TimeMarker (0074) did. The real, slot-/prop-driven branches are:
//    • checkbox present / absent (a separate, tap-isolated leading control).
//    • leading badge present / absent (a fixed-width centred column).
//    • route, metrics, insight lines each present / absent.
//    • hover-revealed actions present / absent.
//    • activation: none, a link (web `href`), or an action (web `onClick`).
//    • selected tint on / off, glow cyan / green / purple / none, chevron shown / hidden.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `HistoryListRow`; this surface keeps the same slug here (SwiftUI-free)
/// so the state-holder can emit telemetry without depending on the view layer.
public enum HistoryListRowSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HistoryListRow"
}

// MARK: - HistoryListRowGlow (web `glow: 'cyan' | 'green' | 'purple' | 'none'`)

/// The hover-glow colour — the native peer of the web `glow` prop passed to `GlassPanel`. `cyan` is
/// the web default. Mapped to theme-aware design tokens (P1/S9) in HistoryListRow.Views.swift, so the
/// glow recolours across light / dark / high-contrast rather than the web's fixed neon hues.
public enum HistoryListRowGlow: String, Sendable, Equatable, CaseIterable {
    /// Cyan accent glow (web default).
    case cyan
    /// Emerald / success glow (web `green`).
    case green
    /// Violet glow (web `purple`).
    case purple
    /// No glow (web `none`).
    case none

    /// The default the web component applies when no glow is supplied (`glow = 'cyan'`).
    public static let defaultGlow: HistoryListRowGlow = .cyan
}

// MARK: - HistoryListRowActivationKind (web `href` vs `onClick` vs neither)

/// The row's activation kind — the native peer of the web's mutually-exclusive `href` / `onClick`
/// props. `link` is the web `<Link to={href}>` wrap, `action` is the web `onClick` on the panel, and
/// `none` is a non-navigable row (neither prop). The concrete navigation closure + the `href` string
/// live on the view in ``HistoryListRowActivation``; this kind is the part that belongs in the
/// Equatable ``HistoryListRowInputs`` (closures are not Equatable).
public enum HistoryListRowActivationKind: String, Sendable, Equatable, CaseIterable {
    /// No `href` and no `onClick` — the row is inert, only its slotted controls are interactive.
    case none
    /// Web `href` — the whole row navigates (the native peer of react-router `<Link>`).
    case link
    /// Web `onClick` — the panel fires a handler on tap.
    case action
}

// MARK: - HistoryListRowInputs (the Equatable structural props)

/// The structural props the surface renders from — the Equatable, Sendable subset of the web
/// `HistoryListRowProps`. It deliberately excludes the slot views + the activation closure (neither is
/// Equatable / Sendable); those live on the view and are passed straight to the content view. What
/// stays here is everything the pure projection + the `.onChange` reuse-guard need: the glow, the
/// selected / chevron flags, the activation kind + its `href`, and one presence flag per optional slot
/// (plus the action count). A reused list cell that swaps which slots are populated re-derives its
/// layout because these flags change.
public struct HistoryListRowInputs: Sendable, Equatable {
    /// Hover-glow colour (web `glow`, default `cyan`).
    public let glow: HistoryListRowGlow
    /// Whether the selected tint + ring is shown (web `selected`).
    public let selected: Bool
    /// Whether the trailing chevron is hidden (web `hideChevron`).
    public let hideChevron: Bool
    /// The activation kind — none / link / action (web `href` xor `onClick`).
    public let activationKind: HistoryListRowActivationKind
    /// The link target for the `link` kind (web `href`); `nil` for `none` / `action`.
    public let href: String?
    /// Whether the tap-isolated checkbox slot is present (web `checkbox != null`).
    public let hasCheckbox: Bool
    /// Whether the fixed-width leading badge slot is present (web `leading != null`).
    public let hasLeading: Bool
    /// Whether the second (route) line is present (web `route`).
    public let hasRoute: Bool
    /// Whether the third (metrics) line is present (web `metrics`).
    public let hasMetrics: Bool
    /// Whether the fourth (insight) slot is present (web `insight`).
    public let hasInsight: Bool
    /// The number of hover-revealed action buttons (web `actions?.length ?? 0`).
    public let actionCount: Int

    public init(
        glow: HistoryListRowGlow = .defaultGlow,
        selected: Bool = false,
        hideChevron: Bool = false,
        activationKind: HistoryListRowActivationKind = .none,
        href: String? = nil,
        hasCheckbox: Bool = false,
        hasLeading: Bool = false,
        hasRoute: Bool = false,
        hasMetrics: Bool = false,
        hasInsight: Bool = false,
        actionCount: Int = 0
    ) {
        self.glow = glow
        self.selected = selected
        self.hideChevron = hideChevron
        self.activationKind = activationKind
        self.href = href
        self.hasCheckbox = hasCheckbox
        self.hasLeading = hasLeading
        self.hasRoute = hasRoute
        self.hasMetrics = hasMetrics
        self.hasInsight = hasInsight
        self.actionCount = max(0, actionCount)
    }
}
