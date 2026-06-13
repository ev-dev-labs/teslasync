//
//  StickyCompactHero.Projection.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  The pure projection from the cached bar state (the config + the current scroll geometry) to the
//  resolved, view-ready value the bar renders — the native peer of what the web component computes each
//  observer tick (`visible`) plus the render decisions it makes (`if (!visible) return null`, the per-
//  status icon / headline / hue, the `{lastCheckedLabel && …}` separator, and the `{onRefresh && <button>}`
//  refresh affordance). The view is a pure function of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for: it
//  takes the cached config + the latest scroll geometry, runs the geometry through
//  ``StickyCompactHeroVisibility``, resolves the localized headline + accessibility wording through the
//  injected localizer, and collapses the hidden / visible, per-status, last-checked, and refresh branches
//  exactly as the web component does.
//

import CoreGraphics
import Foundation

// MARK: - Resolved read-model (web `visible` + render decision)

/// The resolved, view-ready projection of the compact hero bar — the native peer of the web component's
/// per-tick render decision. `isVisible` mirrors `visible` (and the `if (!visible) return null` guard);
/// `status` + `iconSystemName` + `headline` are the per-status icon / short headline (web
/// `ICON_FOR_STATUS` / `SHORT_HEADLINE`); `lastCheckedLabel` + `showsLastChecked` are the optional
/// relative label (web `{lastCheckedLabel && …}`); `showsRefresh` + `isRefreshing` are the optional refresh
/// affordance (web `{onRefresh && <button disabled={refreshing}>}`); the `*Label` strings are the composed
/// accessibility wording (web `aria-label`s); and `topOffset` is the pin offset (web `style={{ top }}`).
public struct StickyCompactHeroPresentation: Sendable, Equatable {
    /// `true` when the bar renders — web `visible` (the bar is `null` when `false`).
    public let isVisible: Bool
    /// The instance status driving the icon / headline / hue (web `status`).
    public let status: StickyCompactHeroStatus
    /// The leading SF Symbol — web `ICON_FOR_STATUS[status]`.
    public let iconSystemName: String
    /// The localized short headline — web `SHORT_HEADLINE[status]`.
    public let headline: String
    /// The last-checked relative label, e.g. "12s ago" — web `lastCheckedLabel`; `nil` when absent.
    public let lastCheckedLabel: String?
    /// Whether the last-checked label renders — web truthy `lastCheckedLabel`.
    public let showsLastChecked: Bool
    /// Whether the refresh affordance renders — web `onRefresh != null`.
    public let showsRefresh: Bool
    /// Whether a refresh is in flight — web `refreshing` (spins the glyph + disables the button).
    public let isRefreshing: Bool
    /// The sticky region's accessibility label — web `aria-label="Status summary"`.
    public let regionLabel: String
    /// The region's spoken value — the status headline (+ last-checked), so VoiceOver announces the health
    /// summary the icon conveys visually (native a11y addition over the web visual-only icon).
    public let regionValue: String
    /// The scroll-to-top button's accessibility label — web `aria-label="Scroll to top of page"`.
    public let scrollToTopLabel: String
    /// The refresh button's accessibility label — web `aria-label="Refresh status"`.
    public let refreshLabel: String
    /// The refresh button's accessibility value while in flight — spoken peer of the web spinning glyph.
    public let refreshingValue: String
    /// The offset the bar pins below the top — web `style={{ top: topOffset }}` (clamped >= 0).
    public let topOffset: CGFloat

    public init(
        isVisible: Bool,
        status: StickyCompactHeroStatus,
        iconSystemName: String,
        headline: String,
        lastCheckedLabel: String?,
        showsLastChecked: Bool,
        showsRefresh: Bool,
        isRefreshing: Bool,
        regionLabel: String,
        regionValue: String,
        scrollToTopLabel: String,
        refreshLabel: String,
        refreshingValue: String,
        topOffset: CGFloat
    ) {
        self.isVisible = isVisible
        self.status = status
        self.iconSystemName = iconSystemName
        self.headline = headline
        self.lastCheckedLabel = lastCheckedLabel
        self.showsLastChecked = showsLastChecked
        self.showsRefresh = showsRefresh
        self.isRefreshing = isRefreshing
        self.regionLabel = regionLabel
        self.regionValue = regionValue
        self.scrollToTopLabel = scrollToTopLabel
        self.refreshLabel = refreshLabel
        self.refreshingValue = refreshingValue
        self.topOffset = topOffset
    }
}

// MARK: - Localized accessibility keys (web hardcoded `aria-label`s, routed through P1/S10)

/// The fixed copy the web component inlines as literals (`aria-label="Status summary"` / `"Scroll to top
/// of page"` / `"Refresh status"`) plus the native spoken-value additions. Held as `(key, fallback)`
/// pairs so the projection resolves them through the injected localizer, keeping the no-hardcoded-English
/// rule even where the web source inlined the string.
enum StickyCompactHeroCopy {
    static let region = (key: "stickyCompactHero.region", fallback: "Status summary")
    static let scrollToTop = (key: "stickyCompactHero.scrollToTop", fallback: "Scroll to top of page")
    static let refresh = (key: "stickyCompactHero.refresh", fallback: "Refresh status")
    static let refreshing = (key: "stickyCompactHero.refreshing", fallback: "Refreshing")
}

// MARK: - Projection (cached config + scroll geometry → resolved presentation)

/// Pure projection from the cached config + the latest scroll geometry to the resolved presentation.
/// `resolve(config:geometry:localize:)` runs the geometry through ``StickyCompactHeroVisibility`` (web
/// observer callback), resolves the localized headline + accessibility wording through the injected
/// localizer, and composes the region's spoken value, so the view never recomputes visibility or rebuilds
/// copy itself.
public enum StickyCompactHeroProjection {
    /// Projects the config + scroll geometry into the resolved presentation (web per-tick `visible` + the
    /// per-status / last-checked / refresh render decisions). `localize` resolves the headline + the
    /// hardcoded `aria-label`s; tests pass a fallback-only closure for determinism.
    public static func resolve(
        config: StickyCompactHeroConfig,
        geometry: StickyCompactHeroGeometry,
        localize: StickyCompactHeroLocalize
    ) -> StickyCompactHeroPresentation {
        let visible = StickyCompactHeroVisibility.isVisible(geometry, topOffset: config.topOffset)
        let headline = localize(config.status.headlineKey, config.status.headlineFallback)
        return StickyCompactHeroPresentation(
            isVisible: visible,
            status: config.status,
            iconSystemName: config.status.iconSystemName,
            headline: headline,
            lastCheckedLabel: config.lastCheckedLabel,
            showsLastChecked: config.showsLastChecked,
            showsRefresh: config.hasRefresh,
            isRefreshing: config.refreshing,
            regionLabel: localize(StickyCompactHeroCopy.region.key, StickyCompactHeroCopy.region.fallback),
            regionValue: regionValue(headline: headline, lastChecked: config.lastCheckedLabel),
            scrollToTopLabel: localize(
                StickyCompactHeroCopy.scrollToTop.key,
                StickyCompactHeroCopy.scrollToTop.fallback
            ),
            refreshLabel: localize(StickyCompactHeroCopy.refresh.key, StickyCompactHeroCopy.refresh.fallback),
            refreshingValue: localize(
                StickyCompactHeroCopy.refreshing.key,
                StickyCompactHeroCopy.refreshing.fallback
            ),
            topOffset: config.topOffset
        )
    }

    /// The region's spoken value — the headline alone, or "headline · lastChecked" when a last-checked
    /// label is present (the native peer of the web bar's visible "headline · 12s ago" run, surfaced to
    /// VoiceOver so the icon-conveyed status is also spoken).
    static func regionValue(headline: String, lastChecked: String?) -> String {
        guard let lastChecked, !lastChecked.isEmpty else { return headline }
        return "\(headline) · \(lastChecked)"
    }
}
