//
//  QuickNavWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0075 · QuickNavWidget (Apple)
//
//  The testable projection core for the Quick Navigation surface: the canonical
//  shortcut catalog (parity with the web `NAV_ITEMS`), the destination → native
//  route mapping (parity with `AppRouteParser`), the view-ready item builder, the
//  responsive column resolver, and the VoiceOver label/hint builders. All pure +
//  dependency-free so the adapter can be unit-tested without a store, a bundle, or
//  a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Destination catalog (web `NAV_ITEMS`)

/// One Quick Navigation shortcut — the native port of a web `NAV_ITEMS` entry.
/// Carries the web i18n keys (so the per-surface catalog stays in lock-step with
/// the source), the SF Symbol + accent color (web hex parity), the native route
/// path the host navigates to, and the original web path for parity/diagnostics.
public enum QuickNavDestination: String, CaseIterable, Sendable, Identifiable {
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

    /// The canonical native route path the host navigates to (resolved by
    /// `AppRouteParser`): the web `/drives` lands on the native `/driving` drives
    /// feature and `/battery` resolves to `/energy` (battery → energy alias).
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
}

/// The canonical shortcut catalog, in web `NAV_ITEMS` order. The static source
/// publishes this; the dashboard registry enumerates the surface, not the items.
public enum QuickNavCatalog {
    /// All shortcuts in the stable web order (Drives, Charging, Analytics, Battery).
    public static let all: [QuickNavDestination] = QuickNavDestination.allCases
}

// MARK: - View-ready item projection (web mapped `NAV_ITEMS` row)

/// A fully-resolved, view-ready shortcut tile: the localized label/description, the
/// icon + accent color, the destination it routes to, and the pre-built VoiceOver
/// label/hint — so the view holds no formatting or localization logic.
public struct QuickNavItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let destination: QuickNavDestination
    public let label: String
    public let detail: String
    public let systemImage: String
    public let accentColor: Color
    public let accessibilityLabel: String
    public let accessibilityHint: String

    public init(
        destination: QuickNavDestination,
        label: String,
        detail: String,
        accessibilityLabel: String,
        accessibilityHint: String
    ) {
        id = destination.id
        self.destination = destination
        self.label = label
        self.detail = detail
        systemImage = destination.systemImage
        accentColor = destination.accentColor
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }
}

/// Projects destinations into localized, view-ready items. Mirrors the web
/// `NAV_ITEMS.map(...)` render: it resolves each label/description through the
/// injected localizer (so it is bundle-free in tests) and pre-builds the a11y copy.
public enum QuickNavItemBuilder {
    public static func build(
        destinations: [QuickNavDestination] = QuickNavCatalog.all,
        localize: (String, String) -> String
    ) -> [QuickNavItem] {
        destinations.map { destination in
            let label = localize(destination.labelKey, destination.labelFallback)
            let detail = localize(destination.descriptionKey, destination.descriptionFallback)
            return QuickNavItem(
                destination: destination,
                label: label,
                detail: detail,
                accessibilityLabel: QuickNavAccessibility.tileLabel(label: label, detail: detail),
                accessibilityHint: QuickNavAccessibility.tileHint(label: label, localize: localize)
            )
        }
    }
}

// MARK: - Responsive layout (web `grid-cols-2 sm:grid-cols-4`)

/// Resolves the grid column count from the widget's grid footprint, mirroring the
/// web `grid-cols-2 sm:grid-cols-4` responsive split: a full-width (4-col) widget
/// lays the four tiles in a single row; narrower widgets fall back to two columns.
public enum QuickNavLayout {
    public static func columns(forCols widgetCols: Int) -> Int {
        widgetCols >= 4 ? 4 : 2
    }
}

// MARK: - Accessibility copy (testable seam)

/// Builds the VoiceOver label + hint for a shortcut tile. Pure + public so the
/// spoken content can be unit-tested without rendering the view.
public enum QuickNavAccessibility {
    /// The tile's spoken label: "<label>. <description>" (web reads both lines).
    public static func tileLabel(label: String, detail: String) -> String {
        detail.isEmpty ? label : "\(label). \(detail)"
    }

    /// The tile's spoken hint: "Opens <label>" (the link affordance).
    public static func tileHint(label: String, localize: (String, String) -> String) -> String {
        String(format: localize("widget.quickNavOpenHint", "Opens %@"), label)
    }
}
