//
//  QuickNav.Adapter.swift
//  TeslaSync — P4 feature view · 0129 · QuickNav (Apple)
//
//  The testable projection core for the dashboard "Quick Navigation" surface — the
//  faithful port of features/dashboard/components/QuickNav.tsx. Everything here is
//  pure and dependency-free (Foundation + SwiftUI `Color` only) so the catalog, the
//  view-ready tile model, the responsive column math, the load/connection
//  projection, and the VoiceOver copy are all unit-tested without a store, a bundle,
//  or a rendered view.
//
//  Web parity notes:
//    • The web component owns a static `NAV_ITEMS` array of four shortcuts (Drives /
//      Charging / Analytics / Battery), each with an i18n label/description key, a
//      lucide icon, an accent hex, and a route `to`. `QuickNavShortcut` is the native
//      mirror of that catalog, so this surface owns its shortcuts exactly like the
//      web component does (the widget wrapper merely composes it).
//    • The web grid is `grid-cols-2 sm:grid-cols-4`; `QuickNavComponentLayout` ports
//      that breakpoint (2 columns below the `sm` width, 4 at/above it).
//    • The web component is purely presentational (its only hook is `useTranslation`),
//      so the loading / empty / error / stale / offline envelope around the resolved
//      grid is supplied by the bound source — every P4 state still renders here.
//

import Foundation
import SwiftUI

// MARK: - Shortcut catalog (web `NAV_ITEMS`)

/// One Quick Navigation shortcut — the native port of a web `NAV_ITEMS` entry. Each
/// case carries the web i18n keys (so the catalog stays in lock-step with the
/// source), the English fallbacks, the SF Symbol mapped from the lucide icon, the
/// accent hex, the canonical native route the host navigates to, and the original
/// web SPA path (kept for parity + diagnostics).
public enum QuickNavShortcut: String, CaseIterable, Sendable, Identifiable {
    case drives
    case charging
    case analytics
    case battery

    public var id: String {
        rawValue
    }

    /// Web `t(labelKey, label)` key (e.g. `nav.drives`).
    public var labelKey: String {
        "nav.\(rawValue)"
    }

    /// Web `t(descKey, desc)` key (e.g. `nav.drivesDesc`).
    public var descriptionKey: String {
        "nav.\(rawValue)Desc"
    }

    /// English fallback for the label (web `NAV_ITEMS[].label`).
    public var labelFallback: String {
        switch self {
        case .drives: "Drives"
        case .charging: "Charging"
        case .analytics: "Analytics"
        case .battery: "Battery"
        }
    }

    /// English fallback for the description (web `NAV_ITEMS[].desc`).
    public var descriptionFallback: String {
        switch self {
        case .drives: "Trip history"
        case .charging: "Sessions & costs"
        case .analytics: "Fleet insights"
        case .battery: "Health & degradation"
        }
    }

    /// SF Symbol mapped from the web lucide icon (Route / BatteryCharging / Gauge /
    /// Activity), chosen for the closest HIG metaphor on iOS 18 / macOS 15.
    public var systemImage: String {
        switch self {
        case .drives: "point.topleft.down.to.point.bottomright.curvepath"
        case .charging: "battery.100.bolt"
        case .analytics: "gauge.medium"
        case .battery: "waveform.path.ecg"
        }
    }

    /// The tile accent color — the exact web hex (`NAV_ITEMS[].color`) so the grid
    /// reads identically on both apps. A dynamic, per-item value (not a static
    /// semantic token), which is why it is expressed as a literal here.
    public var accentColor: Color {
        switch self {
        case .drives: Color(red: 0.000, green: 0.941, blue: 1.000) // #00f0ff
        case .charging: Color(red: 0.063, green: 0.725, blue: 0.506) // #10b981
        case .analytics: Color(red: 0.659, green: 0.333, blue: 0.969) // #a855f7
        case .battery: Color(red: 0.961, green: 0.620, blue: 0.043) // #f59e0b
        }
    }

    /// The canonical native route the host navigates to (resolved by `AppRouteParser`):
    /// the web `/drives` lands on the native `/driving` feature and `/battery`
    /// resolves to `/energy` (the battery → energy alias).
    public var routePath: String {
        switch self {
        case .drives: "/driving"
        case .charging: "/charging"
        case .analytics: "/analytics"
        case .battery: "/energy"
        }
    }

    /// The original web SPA path (web `NAV_ITEMS[].to`), kept for parity + diagnostics.
    public var webPath: String {
        switch self {
        case .drives: "/drives"
        case .charging: "/charging"
        case .analytics: "/analytics"
        case .battery: "/battery"
        }
    }

    /// The canonical catalog in the stable web order (Drives, Charging, Analytics,
    /// Battery) — the native analogue of the `NAV_ITEMS` module constant.
    public static let catalog: [QuickNavShortcut] = QuickNavShortcut.allCases
}

// MARK: - View-ready tile (web mapped `NAV_ITEMS` row)

/// A fully-resolved, view-ready shortcut tile: the localized label/description, the
/// icon + accent color, the shortcut it routes to, and the pre-built VoiceOver
/// label/hint — so the view holds no formatting or localization logic.
public struct QuickNavTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let shortcut: QuickNavShortcut
    public let label: String
    public let detail: String
    public let systemImage: String
    public let accentColor: Color
    public let accessibilityLabel: String
    public let accessibilityHint: String

    public init(
        shortcut: QuickNavShortcut,
        label: String,
        detail: String,
        accessibilityLabel: String,
        accessibilityHint: String
    ) {
        id = shortcut.id
        self.shortcut = shortcut
        self.label = label
        self.detail = detail
        systemImage = shortcut.systemImage
        accentColor = shortcut.accentColor
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }
}

/// Projects shortcuts into localized, view-ready tiles — the native mirror of the
/// web `NAV_ITEMS.map(...)` render. Each label/description resolves through the
/// injected localizer (so it is bundle-free in tests) and the a11y copy is pre-built.
public enum QuickNavTileBuilder {
    public static func build(
        shortcuts: [QuickNavShortcut] = QuickNavShortcut.catalog,
        localize: (String, String) -> String
    ) -> [QuickNavTileModel] {
        shortcuts.map { shortcut in
            let label = localize(shortcut.labelKey, shortcut.labelFallback)
            let detail = localize(shortcut.descriptionKey, shortcut.descriptionFallback)
            return QuickNavTileModel(
                shortcut: shortcut,
                label: label,
                detail: detail,
                accessibilityLabel: QuickNavComponentAccessibility.tileLabel(label: label, detail: detail),
                accessibilityHint: QuickNavComponentAccessibility.tileHint(label: label, localize: localize)
            )
        }
    }
}

// MARK: - Responsive layout (web `grid-cols-2 sm:grid-cols-4`)

/// The responsive column math, ported from the web Tailwind grid so it is unit
/// testable and identical across iPhone / iPad / Mac widths. Tailwind `sm` is 640
/// CSS pixels: two columns below it, four at/above it.
public enum QuickNavComponentLayout {
    public static let smBreakpoint: CGFloat = 640

    /// Columns for an available width: 2 below `sm`, 4 at/above `sm`
    /// (web `grid-cols-2` / `sm:grid-cols-4`).
    public static func columns(forWidth width: CGFloat) -> Int {
        width >= smBreakpoint ? 4 : 2
    }
}

// MARK: - Render phase + connection (load envelope around the static grid)

/// What the surface should render. The web source is always a populated grid; the
/// loading / empty / error envelope (prompt P4 states) is supplied by the bound
/// source so no state is ever a blank box.
public enum QuickNavPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the shortcut catalog, projected into a phase
/// by `resolvePhase`.
public enum QuickNavCatalogStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the connectivity chip so a cached grid is
/// clearly labeled while reconnecting / offline.
public enum QuickNavConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the bound load status + resolved shortcut
/// count to a render phase. A faithful port of the web component's "always a grid"
/// read, widened with the load envelope the prompt requires.
public enum QuickNavProjection {
    /// Resolves the render phase: a failure surfaces the error state, an in-flight
    /// load with no cached shortcuts shows the skeleton, and a resolved catalog shows
    /// the grid when populated or the friendly empty state when it is not.
    public static func resolvePhase(_ status: QuickNavCatalogStatus, count: Int) -> QuickNavPhase {
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
public enum QuickNavSurface {
    public static let slug = "QuickNav"
}

// MARK: - Accessibility (VoiceOver copy, testable seam)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the spoken content is testable without
/// a bundle, exactly like the view's P1/S10 facade.
public enum QuickNavComponentAccessibility {
    /// One tile's spoken label: "{label}. {detail}" (the web reads both lines), or
    /// just the label when there is no description.
    public static func tileLabel(label: String, detail: String) -> String {
        detail.isEmpty ? label : "\(label). \(detail)"
    }

    /// One tile's spoken hint: "Opens {label}" — the link affordance (web `<Link>`).
    public static func tileHint(label: String, localize: (String, String) -> String) -> String {
        String(format: localize("dashboard.quickNav.openHint", "Opens %@"), label)
    }

    /// The grid container's spoken label.
    public static func gridLabel(localize: (String, String) -> String) -> String {
        localize("dashboard.quickNav.gridA11y", "Quick navigation")
    }

    /// The connectivity chip's spoken label for the given live-state.
    public static func connectionLabel(
        _ connection: QuickNavConnection,
        localize: (String, String) -> String
    ) -> String {
        switch connection {
        case .live: localize("dashboard.quickNav.live", "Live")
        case .stale: localize("dashboard.quickNav.stale", "Stale")
        case .offline: localize("dashboard.quickNav.offline", "Offline")
        }
    }
}
