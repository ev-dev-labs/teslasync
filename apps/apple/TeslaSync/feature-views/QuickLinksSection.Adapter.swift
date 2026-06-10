//
//  QuickLinksSection.Adapter.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  The testable projection core for the vehicle-detail "Quick Links" surface — the
//  faithful port of features/vehicles/components/vehicle-detail/QuickLinksSection.tsx.
//  Everything here is pure and dependency-free (Foundation + SwiftUI `Color` only) so
//  the link catalog, the view-ready tile model, the responsive column math, the
//  load/connection projection, and the VoiceOver copy are all unit-tested without a
//  store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • The web component owns a local `quickLinks` array of six shortcuts (Drives /
//      Charging / Battery / Climate / Efficiency / Settings), each with an i18n
//      `t(nav.x, …)` label, a lucide icon, and a route `to`. `QuickLinksDestination`
//      is the native mirror of that array, so this surface owns its links exactly
//      like the web component does.
//    • The web grid is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`;
//      `QuickLinksLayout` ports those two Tailwind breakpoints (2 columns below `sm`,
//      3 at/above `sm`, 6 at/above `lg`).
//    • The web tile has no description and a single cyan glow (`GlassPanel glow="cyan"`
//      with a muted glyph), so — unlike the dashboard `QuickNav` — there is no
//      per-item accent or detail line here.
//    • The web component is purely presentational (its only hook is `useTranslation`),
//      so the loading / empty / error / stale / offline envelope around the resolved
//      grid is supplied by the bound source — every P4 state still renders here.
//

import Foundation
import SwiftUI

// MARK: - Link catalog (web `quickLinks`)

/// One Quick Links shortcut — the native port of a web `quickLinks` entry. Each case
/// carries the web i18n label key (so the catalog stays in lock-step with the
/// source), the English fallback the source passes to `t(key, default)`, the SF
/// Symbol mapped from the lucide icon, the canonical native route the host navigates
/// to, and the original web SPA path (kept for parity + diagnostics).
public enum QuickLinksDestination: String, CaseIterable, Sendable, Identifiable {
    case drives
    case charging
    case battery
    case climate
    case efficiency
    case settings

    public var id: String {
        rawValue
    }

    /// Web `t(labelKey, label)` key (e.g. `nav.drives`).
    public var labelKey: String {
        "nav.\(rawValue)"
    }

    /// English fallback for the label — the exact literal the web source passes as the
    /// `t()` default (web `quickLinks[].label`).
    public var labelFallback: String {
        switch self {
        case .drives: "Drives"
        case .charging: "Charging"
        case .battery: "Battery"
        case .climate: "Climate"
        case .efficiency: "Efficiency"
        case .settings: "Settings"
        }
    }

    /// SF Symbol mapped from the web lucide icon (Route / BatteryCharging / Battery /
    /// Thermometer / BarChart3 / Settings), chosen for the closest HIG metaphor on
    /// iOS 18 / iPadOS 18 / macOS 15.
    public var systemImage: String {
        switch self {
        case .drives: "point.topleft.down.to.point.bottomright.curvepath"
        case .charging: "battery.100.bolt"
        case .battery: "minus.plus.batteryblock"
        case .climate: "thermometer.medium"
        case .efficiency: "chart.bar.fill"
        case .settings: "gearshape.fill"
        }
    }

    /// The original web SPA path (web `quickLinks[].to`), kept for parity + diagnostics.
    public var webPath: String {
        switch self {
        case .drives: "/drives"
        case .charging: "/charging"
        case .battery: "/battery"
        case .climate: "/climate"
        case .efficiency: "/efficiency"
        case .settings: "/settings"
        }
    }

    /// The canonical native route the host navigates to. Mirrors the web → native
    /// aliasing the rest of the app uses (`AppRouteParser`): the web `/drives` page is
    /// the native `driving` feature, `/battery` is the `energy` alias, the web
    /// `/climate` (ClimateControl) lands on the native `vehicle-systems` surface, and
    /// `/efficiency` lands on `analytics`.
    public var routePath: String {
        switch self {
        case .drives: "/driving"
        case .charging: "/charging"
        case .battery: "/energy"
        case .climate: "/vehicle-systems"
        case .efficiency: "/analytics"
        case .settings: "/settings"
        }
    }

    /// The canonical catalog in the stable web order (Drives, Charging, Battery,
    /// Climate, Efficiency, Settings) — the native analogue of the local `quickLinks`
    /// array.
    public static let catalog: [QuickLinksDestination] = QuickLinksDestination.allCases
}

// MARK: - View-ready tile (web mapped `quickLinks` row)

/// A fully-resolved, view-ready link tile: the localized label, the icon, the
/// destination it routes to, and the pre-built VoiceOver label/hint — so the view
/// holds no formatting or localization logic. The web tile has no description, so
/// there is no detail line here.
public struct QuickLinksTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let destination: QuickLinksDestination
    public let label: String
    public let systemImage: String
    public let accessibilityLabel: String
    public let accessibilityHint: String

    public init(
        destination: QuickLinksDestination,
        label: String,
        accessibilityLabel: String,
        accessibilityHint: String
    ) {
        id = destination.id
        self.destination = destination
        self.label = label
        systemImage = destination.systemImage
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }
}

/// Projects destinations into localized, view-ready tiles — the native mirror of the
/// web `quickLinks.map(...)` render. Each label resolves through the injected
/// localizer (so it is bundle-free in tests) and the a11y copy is pre-built.
public enum QuickLinksTileBuilder {
    public static func build(
        destinations: [QuickLinksDestination] = QuickLinksDestination.catalog,
        localize: (String, String) -> String
    ) -> [QuickLinksTileModel] {
        destinations.map { destination in
            let label = localize(destination.labelKey, destination.labelFallback)
            return QuickLinksTileModel(
                destination: destination,
                label: label,
                accessibilityLabel: QuickLinksAccessibility.tileLabel(label: label),
                accessibilityHint: QuickLinksAccessibility.tileHint(label: label, localize: localize)
            )
        }
    }
}

// MARK: - Responsive layout (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`)

/// The responsive column math, ported from the web Tailwind grid so it is unit
/// testable and identical across iPhone / iPad / Mac widths. Tailwind `sm` is 640 CSS
/// pixels and `lg` is 1024: two columns below `sm`, three at/above `sm`, six at/above
/// `lg`.
public enum QuickLinksLayout {
    public static let smBreakpoint: CGFloat = 640
    public static let lgBreakpoint: CGFloat = 1024

    /// Columns for an available width: 2 below `sm`, 3 at/above `sm`, 6 at/above `lg`
    /// (web `grid-cols-2` / `sm:grid-cols-3` / `lg:grid-cols-6`).
    public static func columns(forWidth width: CGFloat) -> Int {
        if width >= lgBreakpoint { return 6 }
        if width >= smBreakpoint { return 3 }
        return 2
    }
}

// MARK: - Render phase + connection (load envelope around the static grid)

/// What the surface should render. The web source is always a populated grid; the
/// loading / empty / error envelope (prompt P4 states) is supplied by the bound
/// source so no state is ever a blank box.
public enum QuickLinksPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the link catalog, projected into a phase by
/// `resolvePhase`.
public enum QuickLinksCatalogStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the connectivity chip so a cached grid is
/// clearly labeled while reconnecting / offline.
public enum QuickLinksConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the bound load status + resolved link count to
/// a render phase. A faithful port of the web component's "always a grid" read,
/// widened with the load envelope the prompt requires.
public enum QuickLinksProjection {
    /// Resolves the render phase: a failure surfaces the error state, an in-flight
    /// load with no cached links shows the skeleton, and a resolved catalog shows the
    /// grid when populated or the friendly empty state when it is not.
    public static func resolvePhase(_ status: QuickLinksCatalogStatus, count: Int) -> QuickLinksPhase {
        switch status {
        case .loading:
            count > 0 ? .content : .loading
        case let .failed(message):
            count > 0 ? .content : .error(message)
        case .loaded:
            count > 0 ? .content : .empty
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum QuickLinksSurface {
    public static let slug = "QuickLinksSection"
}

// MARK: - Accessibility (VoiceOver copy, testable seam)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the spoken content is testable without a bundle,
/// exactly like the view's P1/S10 facade.
public enum QuickLinksAccessibility {
    /// One tile's spoken label. The web tile shows only the label (no description), so
    /// the spoken label is the label itself.
    public static func tileLabel(label: String) -> String {
        label
    }

    /// One tile's spoken hint: "Opens {label}" — the link affordance (web `<Link>`).
    public static func tileHint(label: String, localize: (String, String) -> String) -> String {
        String(format: localize("vehicles.detail.quickLinks.openHint", "Opens %@"), label)
    }

    /// The section container's spoken label.
    public static func sectionLabel(localize: (String, String) -> String) -> String {
        localize("vehicles.detail.quickLinks.gridA11y", "Quick links")
    }

    /// The connectivity chip's spoken label for the given live-state.
    public static func connectionLabel(
        _ connection: QuickLinksConnection,
        localize: (String, String) -> String
    ) -> String {
        switch connection {
        case .live: localize("vehicles.detail.quickLinks.live", "Live")
        case .stale: localize("vehicles.detail.quickLinks.stale", "Stale")
        case .offline: localize("vehicles.detail.quickLinks.offline", "Offline")
        }
    }
}
