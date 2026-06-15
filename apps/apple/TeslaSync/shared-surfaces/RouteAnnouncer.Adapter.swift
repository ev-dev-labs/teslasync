//
//  RouteAnnouncer.Adapter.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The testable, dependency-light core for the route-change announcer — the SwiftUI parity of
//  `components/a11y/RouteAnnouncer.tsx`. Everything here is pure (Foundation only): one route
//  snapshot (the native pairing of the web `useLocation().pathname` + `document.title`), one
//  built announcement, the verbatim port of the web duplicate-dedupe padding
//  (`announceCounter % 4` rotating zero-width spaces), the read-time decision that turns a
//  resolved title into an announcement (or clears the region when the title is empty), and the
//  VoiceOver summary builders. No store, no bundle, no rendered view, so each piece is unit
//  tested in isolation.
//
//  Parity note: the web `RouteAnnouncer` mounts once near the top of `<App />`, subscribes to
//  the router location, and on every pathname change AFTER the first render schedules a short
//  deferred read of `document.title` into a polite live region — rotating a 0–3 zero-width
//  space suffix so two consecutive routes that resolve to the same title both re-announce, and
//  clearing the region when the title is empty. This core reproduces that exact data: the
//  route identity, the title, the rotating padded announcement, and the empty-title clear.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity-fallback
/// resolver.
public typealias RouteAnnouncerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Route snapshot (web `useLocation().pathname` + `document.title`)

/// One observed route — the native pairing of the web router location and the page title the
/// route resolves to. `path` is the canonical URL path (web `pathname`, the change that arms an
/// announcement); `title` is the already-resolved page title (web `document.title`, set by each
/// page's `usePageTitle` equivalent), read at announce time so the freshest value is voiced.
public struct RouteSnapshot: Sendable, Equatable {
    public var path: String
    public var title: String

    public init(path: String, title: String) {
        self.path = path
        self.title = title
    }
}

// MARK: - Announcement (one voiced route change)

/// One route-change announcement — the native mirror of a single value written into the web
/// polite live region. `id` is the monotonic announce sequence (web `announceCounter`); `path`
/// is the route that produced it; `title` is the clean page title shown in the inspector;
/// `announcementText` is the padded form actually posted to the assistive technology (web region
/// `textContent`, with the rotating zero-width-space suffix that forces re-announcement of
/// duplicates); `timestamp` orders the recent history.
public struct RouteAnnouncement: Sendable, Equatable, Identifiable {
    public let id: Int
    public let path: String
    public let title: String
    public let announcementText: String
    public let timestamp: Date

    public init(
        id: Int,
        path: String,
        title: String,
        announcementText: String,
        timestamp: Date
    ) {
        self.id = id
        self.path = path
        self.title = title
        self.announcementText = announcementText
        self.timestamp = timestamp
    }
}

// MARK: - Dedupe padding (verbatim port of the web `announceCounter % 4` zero-width suffix)

/// Reproduces the web announcer's duplicate-dedupe mechanism: each announcement appends a
/// rotating run of zero-width spaces (`'\u200B'.repeat(announceCounter % 4)`) so the region's
/// text content is a fresh string and the assistive technology re-reads identical consecutive
/// titles (web `/charging/1` → `/charging/2`, both "Charging Session — TeslaSync"). Pure +
/// deterministic so the rotation is asserted entry-for-entry.
public enum RouteAnnouncerPadding {
    /// U+200B ZERO WIDTH SPACE — invisible on screen and not spoken, exactly as the web uses it.
    public static let zeroWidthSpace = "\u{200B}"

    /// The suffix for a given sequence number — `sequence mod 4` zero-width spaces. The modulo
    /// keeps the suffix bounded so the announcement length never grows unbounded; sequence 1 →
    /// one space, 2 → two, 3 → three, 4 → none, 5 → one (web counter rotating 0→1→2→3→0).
    public static func suffix(for sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }

    /// The padded announcement string — `title` with the rotating zero-width suffix appended
    /// (web `${title}${padding}`).
    public static func padded(_ title: String, sequence: Int) -> String {
        title + suffix(for: sequence)
    }
}

// MARK: - Read-time logic (web deferred `document.title` read)

/// The pure decision the web component performs inside its deferred timeout: read the resolved
/// title and either build a padded announcement or signal a clear. Lifted out of the model so
/// the empty-title clear and the rotating padding are asserted without a scheduler or a view.
public enum RouteAnnouncerLogic {
    /// Build the announcement for a resolved route title, or `nil` when the title is empty — the
    /// web `if (!title) { setMessage(''); return; }` branch that leaves the region cleared rather
    /// than voicing stale content. `sequence` is the monotonic announce counter that drives the
    /// zero-width-space rotation; `timestamp` orders the recent history.
    public static func announcement(
        path: String,
        title: String,
        sequence: Int,
        at timestamp: Date
    ) -> RouteAnnouncement? {
        guard !title.isEmpty else { return nil }
        return RouteAnnouncement(
            id: sequence,
            path: path,
            title: title,
            announcementText: RouteAnnouncerPadding.padded(title, sequence: sequence),
            timestamp: timestamp
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The live region reads its name then its current page
/// title; each history row reads the navigation prefix then its page title.
public enum RouteAnnouncerAccessibility {
    /// The live region's label: "{regionName}: {title}", or "{regionName}: {emptyWord}" when no
    /// page has been announced yet — so VoiceOver never lands on an unlabelled element.
    public static func regionLabel(regionName: String, title: String, emptyWord: String) -> String {
        let body = title.isEmpty ? emptyWord : title
        return "\(regionName): \(body)"
    }

    /// One history row's label: "{navigatedWord}: {title}", so the row reads as a sentence naming
    /// the navigation then the page that was announced.
    public static func historyLabel(navigatedWord: String, title: String) -> String {
        "\(navigatedWord): \(title)"
    }
}
