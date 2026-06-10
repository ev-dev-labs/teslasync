//
//  TourLauncher.Adapter.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  The testable projection core for the tour launcher — the faithful port of
//  features/onboarding/TourLauncher.tsx. The web source is a `Modal` listing every tour in the
//  registry (`listTours()`); each row marks completed tours with a check, highlights the tour
//  matching the current route as "Recommended for this page", and exposes a Start / Replay
//  action. Everything here is pure and dependency-free (Foundation only) so the projection —
//  phase resolution, the registry catalog, the route-recommendation predicate, and the
//  per-row display — can be unit-tested without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `tours = listTours()` → `TourCatalog.all` (the same eight tours in `TOUR_ORDER`).
//    • `isRecommendedForRoute(def, location.pathname)` → `TourRouteMatch.matches(pathname:)`,
//      a verbatim port of the string-prefix / RegExp predicate from `lib/tourRegistry.ts`.
//    • `isTourCompleted(def.id, def.version)` → the bound source's `completedIDs`; the web reads
//      `localStorage`, the native surface reads the injected completion store (P1/S8).
//    • The web always renders the populated list; `resolvePhase` widens that into the
//      prompt-required loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum TourLauncherSurface {
    public static let slug = "TourLauncher"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the tour registry + completion flags (web `listTours()` +
/// `isTourCompleted`). The web reads synchronous `localStorage`; the native surface models the
/// load lifecycle here so every state renders.
public enum TourLauncherLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so
/// cached tour progress is clearly labeled while syncing / offline.
public enum TourLauncherConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render at the top level. The web only ever shows the populated list;
/// the loading + empty + error envelopes are added so the first-load, empty-registry, and
/// load-failure cases never render a blank panel.
public enum TourLauncherPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Route match (web `isRecommendedForRoute`)

/// A tour's route hint — the native parity of the web `routeMatch: string | RegExp`. A `prefix`
/// matches a string route the way the web does (exact `/`, else exact-or-`/`-prefixed); a
/// `regex` matches an anchored pattern the way `RegExp.test(pathname)` does.
public enum TourRouteMatch: Sendable, Equatable {
    case prefix(String)
    case regex(String)

    /// Verbatim port of `isRecommendedForRoute` from `lib/tourRegistry.ts`:
    ///   • string `'/'`          → `pathname === '/'`
    ///   • string `p`            → `pathname === p || pathname.startsWith(p + '/')`
    ///   • RegExp                → `routeMatch.test(pathname)`
    public func matches(pathname: String) -> Bool {
        switch self {
        case let .prefix(route):
            if route == "/" { return pathname == "/" }
            return pathname == route || pathname.hasPrefix("\(route)/")
        case let .regex(pattern):
            return Self.regexMatches(pattern, pathname)
        }
    }

    /// `RegExp.test(pathname)` parity: true when the pattern matches anywhere in the path (the
    /// catalog patterns are start-anchored with `^/…`). A pattern that fails to compile never
    /// recommends (the web equivalent would throw at registry build time, not at match time).
    private static func regexMatches(_ pattern: String, _ pathname: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
        let range = NSRange(pathname.startIndex..., in: pathname)
        return regex.firstMatch(in: pathname, range: range) != nil
    }
}

// MARK: - Tour action (web Start / Replay button)

/// The launcher row's primary action. `start` for an unseen tour, `replay` for a completed one
/// (web `completed ? 'Replay' : 'Start'`). Each kind carries its i18n key + web English fallback
/// for the button label and the templated VoiceOver / `aria-label`.
public enum TourActionKind: Sendable, Equatable {
    case start
    case replay

    /// The button label key (web `tour.launcher.start` / `tour.launcher.replay`).
    public var titleKey: String {
        self == .replay ? "tour.launcher.replay" : "tour.launcher.start"
    }

    /// The button label English fallback.
    public var titleFallback: String {
        self == .replay ? "Replay" : "Start"
    }

    /// The templated accessibility-label key (web `tour.launcher.replayAria` /
    /// `tour.launcher.startAria`), substituting the tour title at `{{0}}`.
    public var accessibilityKey: String {
        self == .replay ? "tour.launcher.replayAria" : "tour.launcher.startAria"
    }

    /// The accessibility-label English fallback template.
    public var accessibilityFallback: String {
        self == .replay ? "Replay tour: {{0}}" : "Start tour: {{0}}"
    }
}

// MARK: - Registry entry (web `TourDefinition`)

/// One tour-registry entry — the native parity of the fields the launcher reads off a web
/// `TourDefinition` (`id`, `routeMatch`, `titleKey`/`titleFallback`, `descriptionKey`/
/// `descriptionFallback`, `version`). The step list + `autoStart` predicate are out of scope for
/// the launcher row, so only the displayed fields are modeled.
public struct TourCatalogEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let routeMatch: TourRouteMatch
    public let titleKey: String
    public let titleFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String
    public let version: Int

    public init(
        id: String,
        routeMatch: TourRouteMatch,
        titleKey: String,
        titleFallback: String,
        descriptionKey: String,
        descriptionFallback: String,
        version: Int
    ) {
        self.id = id
        self.routeMatch = routeMatch
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.version = version
    }
}

/// The native parity of `TOURS` + `TOUR_ORDER` from `lib/tourRegistry.ts`: the eight tours in
/// launcher display order, with the exact `titleKey`/`titleFallback`/`descriptionKey`/
/// `descriptionFallback`/`routeMatch`/`version` from each tour definition. Production pushes this
/// through the source; tests can substitute their own slice.
public enum TourCatalog {
    /// Display order (web `TOUR_ORDER`).
    public static let all: [TourCatalogEntry] = [
        TourCatalogEntry(
            id: "main",
            routeMatch: .prefix("/"),
            titleKey: "tour.tours.main.title",
            titleFallback: "Welcome to TeslaSync",
            descriptionKey: "tour.tours.main.description",
            descriptionFallback: "A quick tour of the dashboard, sidebar, and live data.",
            version: 2
        ),
        TourCatalogEntry(
            id: "vehicles",
            routeMatch: .regex("^/vehicles"),
            titleKey: "tour.tours.vehicles.title",
            titleFallback: "Vehicles & sharing",
            descriptionKey: "tour.tours.vehicles.description",
            descriptionFallback: "Browse fleet, open a vehicle, share access.",
            version: 1
        ),
        TourCatalogEntry(
            id: "drives",
            routeMatch: .regex("^/drives"),
            titleKey: "tour.tours.drives.title",
            titleFallback: "Drives & replay",
            descriptionKey: "tour.tours.drives.description",
            descriptionFallback: "Browse drives, replay the route, share moments.",
            version: 1
        ),
        TourCatalogEntry(
            id: "charging",
            routeMatch: .regex("^/(charging|cost-analysis|charging-curve|smart-charge)"),
            titleKey: "tour.tours.charging.title",
            titleFallback: "Charging & cost analysis",
            descriptionKey: "tour.tours.charging.description",
            descriptionFallback: "Sessions, cost breakdowns, and curve diagnostics.",
            version: 1
        ),
        TourCatalogEntry(
            id: "alerts",
            routeMatch: .regex("^/notifications/(alerts|studio)"),
            titleKey: "tour.tours.alerts.title",
            titleFallback: "Alerts & Alert Studio",
            descriptionKey: "tour.tours.alerts.description",
            descriptionFallback: "Triage the inbox and craft custom rules with previews.",
            version: 1
        ),
        TourCatalogEntry(
            id: "automations",
            routeMatch: .regex("^/automations"),
            titleKey: "tour.tours.automations.title",
            titleFallback: "Automations",
            descriptionKey: "tour.tours.automations.description",
            descriptionFallback: "Build triggers, conditions, and actions visually.",
            version: 1
        ),
        TourCatalogEntry(
            id: "settings",
            routeMatch: .regex("^/settings"),
            titleKey: "tour.tours.settings.title",
            titleFallback: "Settings",
            descriptionKey: "tour.tours.settings.description",
            descriptionFallback: "Theme, units, notifications, and tours.",
            version: 1
        ),
        TourCatalogEntry(
            id: "debugger",
            routeMatch: .regex(
                "^/(state-debugger|live-monitor|signal-explorer|signal-diff|signal-gaps|"
                    + "mqtt-inspector|signal-log|redis-signals)"
            ),
            titleKey: "tour.tours.debugger.title",
            titleFallback: "State machine debugger",
            descriptionKey: "tour.tours.debugger.description",
            descriptionFallback: "Timeline, layered sources, freeze/step, deep links.",
            version: 1
        )
    ]
}

// MARK: - Display-ready row (web `<li>` per tour)

/// One launcher row, pre-resolved for rendering: the localized title + description, the completed
/// + recommended flags (web `isTourCompleted` / `isRecommendedForRoute`), and the resolved
/// action. Built by the projection so the views hold no business logic and stay dependency-free.
public struct TourRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let description: String
    public let completed: Bool
    public let recommended: Bool
    public let action: TourActionKind

    public init(
        id: String,
        title: String,
        description: String,
        completed: Bool,
        recommended: Bool,
        action: TourActionKind
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.completed = completed
        self.recommended = recommended
        self.action = action
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: phase resolution and the
/// per-row projection (completed + recommended flags, localized strings, resolved action).
public enum TourLauncherProjection {
    /// Resolves the render phase. Loading shows only before the registry resolves; a resolved
    /// empty registry shows the empty state; a failure with no cached rows shows the error state;
    /// while cached rows survive a refresh / failure the populated list stays on screen
    /// (freshness shown by the chip/banner).
    public static func resolvePhase(status: TourLauncherLoadStatus, tourCount: Int) -> TourLauncherPhase {
        let hasRows = tourCount > 0
        switch status {
        case .loading:
            return hasRows ? .content : .loading
        case .loaded:
            return hasRows ? .content : .empty
        case let .failed(message):
            return hasRows ? .content : .error(message)
        }
    }

    /// Builds one display row from a registry entry + the completion set + the current route.
    /// Mirrors the web row: `completed = isTourCompleted(id, version)`,
    /// `recommended = isRecommendedForRoute(def, pathname)`, and the title/description resolved
    /// through the injected localizer (web `t(key, fallback)`).
    public static func row(
        entry: TourCatalogEntry,
        completedIDs: Set<String>,
        pathname: String,
        localize: (String, String) -> String
    ) -> TourRow {
        let completed = completedIDs.contains(entry.id)
        return TourRow(
            id: entry.id,
            title: localize(entry.titleKey, entry.titleFallback),
            description: localize(entry.descriptionKey, entry.descriptionFallback),
            completed: completed,
            recommended: entry.routeMatch.matches(pathname: pathname),
            action: completed ? .replay : .start
        )
    }

    /// Projects every registry entry into a display row, preserving the catalog order (web
    /// `tours.map(...)`).
    public static func rows(
        entries: [TourCatalogEntry],
        completedIDs: Set<String>,
        pathname: String,
        localize: (String, String) -> String
    ) -> [TourRow] {
        entries.map { row(entry: $0, completedIDs: completedIDs, pathname: pathname, localize: localize) }
    }
}
