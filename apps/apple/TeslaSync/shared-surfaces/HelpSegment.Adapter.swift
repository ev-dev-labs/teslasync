//
//  HelpSegment.Adapter.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  The Foundation-only core for the footer help segment — the SwiftUI parity of
//  `web/src/components/layout/status-bar/HelpSegment.tsx`. This file owns the surface identity (the
//  diagnostics slug), the i18n facade seam, the surface's seven real `t()` keys + their English fallbacks,
//  the three help affordances (``HelpSegmentAction``), the display density (``HelpSegmentDensity``), the
//  view-ready projections, and the pure ``HelpSegmentProjector`` that resolves each affordance's tooltip,
//  VoiceOver label, the inline (xl-only) label, and the shortcuts `?` key cap. No SwiftUI and no
//  `@Observable`, so every rule is unit-testable.
//
//  Faithful-parity note: the web `HelpSegment` is a PURE presentational surface. Its only data source is
//  the synchronous `useTranslation`; the three buttons merely dispatch the decoupled window events
//  (`toggle-keyboard-shortcuts`, `dispatchTourLauncherOpen()`, `open-feedback-modal`). There is no fetch,
//  no React-Query cache, and no Promise, so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to). Inventing such chrome would fabricate states the
//  source does not have, so this surface reproduces only the source's REAL branches — exactly as the
//  sibling presentational primitives HelpIcon (0215), MetricCard (0095), and InlineCallout (0124) did. The
//  real branches are the three display densities: the web `iconOnly` compact form (icons only), the
//  default form (icon + `?` key cap), and the wide `xl:inline` form (icon + key cap + action label).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum HelpSegmentSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HelpSegment"

    /// The `?` key cap rendered next to the shortcuts icon — the web `<kbd>?</kbd>`. A fixed glyph (the
    /// keyboard hint), not localized copy, so it lives here rather than in the strings table.
    public static let shortcutKeyCap = "?"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The production
/// app passes the P1/S10 facade (resolving against the app catalog); tests pass an identity / fake
/// resolver. Kept as a plain closure so the pure core has no dependency on a bundle.
public typealias HelpSegmentResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Owned i18n keys (the surface's real web `t()` keys)

/// The seven i18n keys the web `HelpSegment` resolves — the tooltip + VoiceOver label for each of the
/// three affordances, plus the shortcuts hint suffix. Mirrored verbatim so a ported web catalog string
/// resolves through the same keys.
public enum HelpSegmentKey {
    public static let shortcutsTooltip = "shortcuts.tooltip"
    public static let shortcutsAria = "shortcuts.openAria"
    public static let shortcutsHintSuffix = "shortcuts.hintSuffix"
    public static let tourLabel = "tour.launcher.openShort"
    public static let tourAria = "tour.launcher.openAria"
    public static let feedbackLabel = "feedback.openShort"
    public static let feedbackAria = "feedback.openAria"
}

/// English fallbacks for the owned keys — the web `t(key, default)` second-argument peers, so the Swift
/// sources hold no bare user-facing literals.
public enum HelpSegmentFallback {
    public static let shortcutsTooltip = "Keyboard shortcuts"
    public static let shortcutsAria = "Open keyboard shortcuts"
    public static let shortcutsHintSuffix = "for shortcuts"
    public static let tourLabel = "Take a tour"
    public static let tourAria = "Open tour launcher"
    public static let feedbackLabel = "Report bug"
    public static let feedbackAria = "Open feedback / bug report form"
}

// MARK: - HelpSegmentAction (the three affordances)

/// One of the three "always available" help affordances the segment consolidates — the native peer of the
/// web buttons. Each case carries its SF Symbol (aligned with the in-app `StatusBarHelpView`: lucide
/// `Keyboard`/`HelpCircle`/`Bug` → `keyboard`/`questionmark.circle`/`ladybug`) and identifies which decoupled
/// host action it triggers. The order matches the web left-to-right layout.
public enum HelpSegmentAction: String, Sendable, CaseIterable, Identifiable {
    /// Press `?` for shortcuts → opens the keyboard cheat sheet (web `toggle-keyboard-shortcuts`).
    case shortcuts
    /// Take a tour → opens the tour launcher (web `dispatchTourLauncherOpen()`).
    case tour
    /// Report bug → opens the in-app feedback modal (web `open-feedback-modal`).
    case feedback

    public var id: String {
        rawValue
    }

    /// The SF Symbol for the affordance — the native peer of the web lucide icon.
    public var systemImage: String {
        switch self {
        case .shortcuts: "keyboard"
        case .tour: "questionmark.circle"
        case .feedback: "ladybug"
        }
    }

    /// Whether the affordance shows the `?` key cap when expanded — true only for shortcuts (web renders
    /// `<kbd>?</kbd>` solely on the shortcuts button).
    public var showsKeyCap: Bool {
        self == .shortcuts
    }
}

// MARK: - HelpSegmentDensity (web `iconOnly` + the `xl:inline` breakpoint)

/// The display density of the segment — the native peer of the web `iconOnly` prop crossed with the
/// Tailwind `xl:inline` responsive gate. The web renders three real tiers: `iconOnly` (icons only), the
/// default below `xl` (icons + the `?` key cap, action labels hidden), and `xl` and wider (icons + key cap
/// + action labels). On Apple the wide tier is driven by the horizontal size class.
public enum HelpSegmentDensity: String, Sendable, CaseIterable {
    /// Web `iconOnly={true}` — icons only, no key cap, no labels.
    case iconOnly
    /// Web `iconOnly={false}` below the `xl` breakpoint — icons + the `?` key cap, action labels hidden.
    case compact
    /// Web `iconOnly={false}` at the `xl` breakpoint and wider — icons + key cap + action labels.
    case full

    /// Whether the `?` key cap is shown (the web `!iconOnly` gate on `<kbd>`).
    public var showsKeyCap: Bool {
        self != .iconOnly
    }

    /// Whether the inline action labels are shown (the web `!iconOnly && hidden xl:inline` gate).
    public var showsInlineLabel: Bool {
        self == .full
    }

    /// Resolves the density from the web prop signature: the `iconOnly` flag plus whether the available
    /// width is "wide" (the native peer of the `xl` breakpoint — a regular horizontal size class).
    public static func resolve(iconOnly: Bool, isWide: Bool) -> HelpSegmentDensity {
        if iconOnly {
            return .iconOnly
        }
        return isWide ? .full : .compact
    }
}

// MARK: - HelpSegmentActionProjection (one resolved affordance)

/// The resolved, view-ready copy + layout flags for one affordance — everything the SwiftUI button needs
/// as a pure function of the action, the density, and the i18n resolver. `keyCap` is the `?` glyph when
/// present (shortcuts, expanded) else `nil`; `inlineLabel` is the xl-only label; `showsInlineLabel` is the
/// web `hidden xl:inline` gate.
public struct HelpSegmentActionProjection: Sendable, Equatable, Identifiable {
    public let action: HelpSegmentAction
    public let systemImage: String
    /// The hover / pointer tooltip (web `<Tooltip content>`).
    public let tooltip: String
    /// The VoiceOver label (web `aria-label`).
    public let accessibilityLabel: String
    /// The inline label shown only at the wide tier (web `<span className="hidden xl:inline">`).
    public let inlineLabel: String
    /// Whether the inline label renders (web `!iconOnly && xl`).
    public let showsInlineLabel: Bool
    /// The `?` key cap glyph (web `<kbd>`), or `nil` when not shown.
    public let keyCap: String?

    public var id: String {
        action.rawValue
    }

    public init(
        action: HelpSegmentAction,
        systemImage: String,
        tooltip: String,
        accessibilityLabel: String,
        inlineLabel: String,
        showsInlineLabel: Bool,
        keyCap: String?
    ) {
        self.action = action
        self.systemImage = systemImage
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.inlineLabel = inlineLabel
        self.showsInlineLabel = showsInlineLabel
        self.keyCap = keyCap
    }
}

// MARK: - HelpSegmentProjection (the whole resolved segment)

/// The resolved, view-ready segment — the density plus the three resolved affordances in web layout order.
/// The SwiftUI body is a pure function of this value.
public struct HelpSegmentProjection: Sendable, Equatable {
    public let density: HelpSegmentDensity
    public let actions: [HelpSegmentActionProjection]

    public init(density: HelpSegmentDensity, actions: [HelpSegmentActionProjection]) {
        self.density = density
        self.actions = actions
    }
}

// MARK: - HelpSegmentProjector (web render body)

/// The pure projection from the density + the i18n resolver to the view-ready model — the surface's data
/// adapter in the "state → projection" sense the acceptance calls for: it takes the density a page already
/// holds plus the resolver (no fetch, no clock) and derives the three rendered affordances. Unit tested
/// across all three densities, the per-action copy, the key-cap gate, and the inline-label gate.
public enum HelpSegmentProjector {
    /// Resolves every affordance for the given density — the native peer of the web component's render
    /// decision (the three buttons, each gated on `iconOnly` / `xl`).
    public static func resolve(
        density: HelpSegmentDensity,
        resolve: HelpSegmentResolve
    ) -> HelpSegmentProjection {
        let resolved = HelpSegmentAction.allCases.map { action in
            resolveAction(action, density: density, resolve: resolve)
        }
        return HelpSegmentProjection(density: density, actions: resolved)
    }

    /// Resolves a single affordance — its tooltip, VoiceOver label, the inline (xl-only) label, and the
    /// `?` key cap (shortcuts, expanded).
    public static func resolveAction(
        _ action: HelpSegmentAction,
        density: HelpSegmentDensity,
        resolve: HelpSegmentResolve
    ) -> HelpSegmentActionProjection {
        HelpSegmentActionProjection(
            action: action,
            systemImage: action.systemImage,
            tooltip: tooltip(for: action, resolve: resolve),
            accessibilityLabel: accessibilityLabel(for: action, resolve: resolve),
            inlineLabel: inlineLabel(for: action, resolve: resolve),
            showsInlineLabel: density.showsInlineLabel,
            keyCap: action.showsKeyCap && density.showsKeyCap ? HelpSegmentSurface.shortcutKeyCap : nil
        )
    }

    /// The hover tooltip — web `<Tooltip content>`: the shortcuts title, or the tour / feedback short
    /// label (the web tour / feedback tooltips reuse the same `openShort` copy as the inline label).
    static func tooltip(for action: HelpSegmentAction, resolve: HelpSegmentResolve) -> String {
        switch action {
        case .shortcuts: resolve(HelpSegmentKey.shortcutsTooltip, HelpSegmentFallback.shortcutsTooltip)
        case .tour: resolve(HelpSegmentKey.tourLabel, HelpSegmentFallback.tourLabel)
        case .feedback: resolve(HelpSegmentKey.feedbackLabel, HelpSegmentFallback.feedbackLabel)
        }
    }

    /// The VoiceOver label — web `aria-label`.
    static func accessibilityLabel(for action: HelpSegmentAction, resolve: HelpSegmentResolve) -> String {
        switch action {
        case .shortcuts: resolve(HelpSegmentKey.shortcutsAria, HelpSegmentFallback.shortcutsAria)
        case .tour: resolve(HelpSegmentKey.tourAria, HelpSegmentFallback.tourAria)
        case .feedback: resolve(HelpSegmentKey.feedbackAria, HelpSegmentFallback.feedbackAria)
        }
    }

    /// The inline (xl-only) label — web `<span className="hidden xl:inline">`. Shortcuts uses the hint
    /// suffix ("for shortcuts"); tour / feedback reuse their short label.
    static func inlineLabel(for action: HelpSegmentAction, resolve: HelpSegmentResolve) -> String {
        switch action {
        case .shortcuts: resolve(HelpSegmentKey.shortcutsHintSuffix, HelpSegmentFallback.shortcutsHintSuffix)
        case .tour: resolve(HelpSegmentKey.tourLabel, HelpSegmentFallback.tourLabel)
        case .feedback: resolve(HelpSegmentKey.feedbackLabel, HelpSegmentFallback.feedbackLabel)
        }
    }
}
