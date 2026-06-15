//
//  RouteAnnouncer.Strings.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The P1/S10 localization facade for the route-change announcer — split from the model for the
//  SwiftLint file-length budget. Resolves the surface's strings by key with the web English
//  fallback, so the views hold no hardcoded literals. Keys live in the "RouteAnnouncer" table
//  (RouteAnnouncer.strings), folded into the app `Localizable.xcstrings` catalog at integration
//  time; kept per-surface so each parallel prompt owns its own strings. The typed accessors keep
//  the views terse and let the tests assert the catalog resolves.
//

import Foundation

/// The web `useTranslation` `t(key, fallback)` parity for the surface — a key-by-key resolver
/// over the per-surface "RouteAnnouncer" table plus typed accessors for every string the views
/// and tests reference.
public enum RouteAnnouncerStrings {
    public static let table = "RouteAnnouncer"

    public static let resolve: RouteAnnouncerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func string(_ key: String, _ fallback: String) -> String {
        resolve(key, fallback)
    }

    public static var title: String {
        string("routeAnnouncer.title", "Route announcements")
    }

    public static var subtitle: String {
        string("routeAnnouncer.subtitle", "The page title voiced to VoiceOver after each navigation")
    }

    public static var regionName: String {
        string("routeAnnouncer.region.name", "Live region")
    }

    public static var regionRole: String {
        string("routeAnnouncer.region.role", "Announced politely after navigation")
    }

    public static var emptyValue: String {
        string("routeAnnouncer.region.emptyValue", "—")
    }

    public static var emptyA11y: String {
        string("routeAnnouncer.region.emptyA11y", "no page announced yet")
    }

    public static var historyTitle: String {
        string("routeAnnouncer.history.title", "Recent navigations")
    }

    public static var navigatedWord: String {
        string("routeAnnouncer.history.navigated", "Navigated")
    }

    public static var loadingA11y: String {
        string("routeAnnouncer.loadingA11y", "Loading route announcements")
    }

    public static var empty: String {
        string("routeAnnouncer.empty", "No navigations yet")
    }

    public static var emptyMessage: String {
        string(
            "routeAnnouncer.emptyMessage",
            "The page title will be announced here after you move between pages."
        )
    }

    public static var errorTitle: String {
        string("routeAnnouncer.errorTitle", "Couldn't load route announcements")
    }

    public static var retry: String {
        string("routeAnnouncer.retry", "Retry")
    }

    public static var live: String {
        string("routeAnnouncer.live", "Live")
    }

    public static var stale: String {
        string("routeAnnouncer.stale", "Stale")
    }

    public static var offline: String {
        string("routeAnnouncer.offline", "Offline")
    }

    public static var staleA11y: String {
        string("routeAnnouncer.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("routeAnnouncer.offlineA11y", "Offline — showing the last announced page")
    }
}
