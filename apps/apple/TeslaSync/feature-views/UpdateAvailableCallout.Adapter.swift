//
//  UpdateAvailableCallout.Adapter.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  Pure Foundation projection core for the "update available" callout — the host-free,
//  unit-testable heart of the SwiftUI parity of
//  web/src/features/system/components/status/UpdateAvailableCallout.tsx.
//
//  The web component is a presentational leaf rendered by SystemStatusPage ONLY when its
//  `/system/update-check` query reports `update_available === true`
//  (`{hasUpdate && <UpdateAvailableCallout current latest checkedAt/>}`). It takes the
//  `current` / `latest` / `checkedAt` props and renders a cyan glass callout pointing the
//  operator at the GitHub release notes. It owns no `t()` calls (its copy is hardcoded
//  English literals) and its only conditional branches are the three optional fragments:
//  the heading version suffix (`latest`), the body "you're running" prefix (`current`),
//  and the "last checked" suffix (`checkedAt`).
//
//  This core mirrors that exactly and nothing more invented:
//    • `UpdateCheckSnapshot`     — the web `UpdateCheckResult` payload the parent passes down.
//    • `UpdateAvailableProjection` — the parent's `hasUpdate` mount gate (→ presented vs the
//                                    distinct withdrawn reasons) plus the three optional
//                                    content fragments, 1:1 with the web JSX conditionals.
//    • `UpdateAvailableFormat`    — the `useDateFormat().formatDateTime` port (medium date +
//                                    short time, em-dash sentinel) bound to the user locale/tz.
//    • `UpdateConnection`         — the P4 leaf freshness axis (live/stale/offline) that
//                                    annotates the presented "last checked" line.
//
//  Deliberately SwiftUI-free (Foundation only) so every branch is driven directly in tests.
//

import Foundation

// MARK: - Localizable text (web hardcoded literals promoted to keys + `{{name}}` interpolation)

/// A localizable string: the i18n `key`, the English `fallback` (verbatim from the web
/// source literal), and any `{{name}}` interpolation values. Resolved through the P1/S10
/// facade at render time (and through a fake localizer in tests), so the view holds no
/// hardcoded English. The web source uses no `t()` — these keys promote its literals.
public struct UAText: Sendable, Equatable {
    public let key: String
    public let fallback: String
    public let args: [String: String]

    public init(_ key: String, _ fallback: String, args: [String: String] = [:]) {
        self.key = key
        self.fallback = fallback
        self.args = args
    }

    /// Localizes the key (with the English fallback) and applies `{{name}}` substitution.
    public func resolved(_ localize: (String, String) -> String) -> String {
        UAInterpolate.apply(localize(key, fallback), args)
    }
}

/// i18next-style `{{name}}` token replacement (parity with the web interpolation idiom used
/// across the app's localized strings).
public enum UAInterpolate {
    public static func apply(_ template: String, _ args: [String: String]) -> String {
        guard !args.isEmpty else { return template }
        var output = template
        for (name, value) in args {
            output = output.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return output
    }
}

// MARK: - Input snapshot (web `UpdateCheckResult` props)

/// One coalesced snapshot of the component's inputs — the native mirror of the web
/// `UpdateCheckResult` the parent's `/system/update-check` query yields and passes as the
/// `current` / `latest` / `checkedAt` props, plus the `update_available` mount flag the
/// parent reads (`hasUpdate`). Optionals mirror the web `string | undefined` props.
public struct UpdateCheckSnapshot: Sendable, Equatable {
    /// The currently-deployed version (web `current`); nil when unknown.
    public var current: String?
    /// The latest available version (web `latest`); nil when unknown.
    public var latest: String?
    /// Whether the backend reports an upgrade is available (web `update_available`).
    public var updateAvailable: Bool
    /// When the check last ran (web `checked_at`); nil when absent.
    public var checkedAt: Date?

    public init(
        current: String? = nil,
        latest: String? = nil,
        updateAvailable: Bool = false,
        checkedAt: Date? = nil
    ) {
        self.current = current
        self.latest = latest
        self.updateAvailable = updateAvailable
        self.checkedAt = checkedAt
    }
}

// MARK: - Load lifecycle (web `useQuery` states the parent reads)

/// The load lifecycle of the parent's `/system/update-check` query — the native mirror of
/// the web `useQuery(['system-status','update-check'])` states the parent gates the callout
/// on. `idle`/`loading` precede the first result; `failed` is the swallowed error the web
/// parent renders nothing for; `loaded` carries the snapshot.
public enum UpdateCheckLoadState: Sendable, Equatable {
    case idle
    case loading
    case failed
    case loaded(UpdateCheckSnapshot)
}

// MARK: - Freshness axis (P4 leaf states — live / stale / offline)

/// The connection/freshness of the presented snapshot. The web "Last checked {date}" line
/// is itself the freshness signal; the native surface promotes it to an explicit axis so
/// the P4 stale/offline leaf states render a chip on that line instead of being invisible.
public enum UpdateConnection: String, Sendable, Equatable {
    /// The check ran within the freshness window over a live connection.
    case live
    /// The check result is older than the freshness window (web `staleTime` elapsed).
    case stale
    /// No connectivity — the snapshot is the last cached result.
    case offline
}

// MARK: - Resolved content (the presented callout's strings + destination)

/// The fully-resolved, display-ready content of the presented callout — the projection of
/// the three web conditional fragments plus the release-notes destination. The view binds
/// these directly; tests assert them without a rendering host.
public struct UpdateAvailableContent: Sendable, Equatable {
    /// The heading (web `Update available{latest ? ` — v${latest}` : ''}`).
    public let heading: UAText
    /// The body sentence (web `{current ? `You're running v${current}. ` : ''}Review …`).
    public let body: UAText
    /// The "last checked" suffix (web `checkedAt && ` · Last checked ${fmt}``); nil when absent.
    public let lastChecked: UAText?
    /// The "View notes" call-to-action label (web anchor text).
    public let cta: UAText
    /// The GitHub release-notes destination (web anchor `href`).
    public let releaseNotesURL: URL?
    /// The freshness of the presented snapshot (P4 leaf axis).
    public let connection: UpdateConnection

    public init(
        heading: UAText,
        body: UAText,
        lastChecked: UAText?,
        cta: UAText,
        releaseNotesURL: URL?,
        connection: UpdateConnection
    ) {
        self.heading = heading
        self.body = body
        self.lastChecked = lastChecked
        self.cta = cta
        self.releaseNotesURL = releaseNotesURL
        self.connection = connection
    }
}

// MARK: - Phase (web parent `hasUpdate &&` gate → presented vs the withdrawn reasons)

/// Why the callout is not presented. The web parent renders nothing in each of these
/// cases (`!hasUpdate`); the native surface classifies them distinctly so the mapping of
/// the generic P4 loading/empty/error leaf states is explicit and unit-tested, even though
/// every reason renders the same faithful withdrawn surface (no fabricated skeleton box).
public enum UpdateAvailableIdleReason: String, Sendable, Equatable {
    /// The update-check has not resolved yet (web query `pending` — parent renders nothing).
    case awaitingCheck
    /// The backend reports no upgrade (`update_available === false` — web `hasUpdate` false).
    case upToDate
    /// The update-check failed; the web parent swallows it and shows no callout.
    case checkUnavailable
}

/// The resolved render phase — the native mirror of the web parent's `{hasUpdate && …}`
/// gate. `idle` is the withdrawn surface (the web absence, classified by reason);
/// `presented` carries the display-ready callout content.
public enum UpdateAvailablePhase: Sendable, Equatable {
    case idle(UpdateAvailableIdleReason)
    case presented(UpdateAvailableContent)

    /// Whether the callout is shown (web `hasUpdate`).
    public var isPresented: Bool {
        if case .presented = self { return true }
        return false
    }

    /// The presented content, when shown.
    public var content: UpdateAvailableContent? {
        if case let .presented(content) = self { return content }
        return nil
    }

    /// The withdrawn reason, when not shown.
    public var idleReason: UpdateAvailableIdleReason? {
        if case let .idle(reason) = self { return reason }
        return nil
    }
}

// MARK: - Projection (web `hasUpdate` gate + the three optional fragments)

/// Resolves the load state + snapshot + freshness into a render phase, reproducing the web
/// parent's mount gate and the leaf's three conditional fragments exactly.
public enum UpdateAvailableProjection {
    /// The release-notes destination (web anchor href, verbatim).
    public static let releaseNotesURL = URL(string: "https://github.com/ev-dev-labs/teslasync/releases/latest")

    /// Resolves the phase.
    ///
    /// - `loading`/`idle` → `.idle(.awaitingCheck)` (web query pending → parent renders nothing).
    /// - `failed` → `.idle(.checkUnavailable)` (web swallows the error → no callout).
    /// - `loaded` with `update_available == false` → `.idle(.upToDate)` (web `!hasUpdate`).
    /// - `loaded` with `update_available == true` → `.presented(content)` (web `hasUpdate &&`).
    public static func resolve(
        loadState: UpdateCheckLoadState,
        connection: UpdateConnection,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> UpdateAvailablePhase {
        switch loadState {
        case .idle, .loading:
            return .idle(.awaitingCheck)
        case .failed:
            return .idle(.checkUnavailable)
        case let .loaded(snapshot):
            guard snapshot.updateAvailable else { return .idle(.upToDate) }
            return .presented(content(for: snapshot, connection: connection, locale: locale, timeZone: timeZone))
        }
    }

    /// Builds the presented content from a snapshot, reproducing the three web fragments.
    static func content(
        for snapshot: UpdateCheckSnapshot,
        connection: UpdateConnection,
        locale: Locale,
        timeZone: TimeZone
    ) -> UpdateAvailableContent {
        UpdateAvailableContent(
            heading: heading(latest: snapshot.latest),
            body: body(current: snapshot.current),
            lastChecked: lastChecked(snapshot.checkedAt, locale: locale, timeZone: timeZone),
            cta: UpdateAvailableCopy.viewNotes,
            releaseNotesURL: releaseNotesURL,
            connection: connection
        )
    }

    /// Web `Update available{latest ? ` — v${latest}` : ''}`.
    static func heading(latest: String?) -> UAText {
        if let latest, !latest.isEmpty {
            return UpdateAvailableCopy.headingWithVersion(latest)
        }
        return UpdateAvailableCopy.heading
    }

    /// Web `{current ? `You're running v${current}. ` : ''}Review the release notes …`.
    static func body(current: String?) -> UAText {
        if let current, !current.isEmpty {
            return UpdateAvailableCopy.bodyWithCurrent(current)
        }
        return UpdateAvailableCopy.body
    }

    /// Web `checkedAt && ` · Last checked ${formatDateTime(checkedAt)}``; nil when absent.
    static func lastChecked(_ date: Date?, locale: Locale, timeZone: TimeZone) -> UAText? {
        guard let date else { return nil }
        let formatted = UpdateAvailableFormat.dateTime(date, locale: locale, timeZone: timeZone)
        return UpdateAvailableCopy.lastChecked(formatted)
    }
}

// MARK: - Timestamp formatting (web `useDateFormat().formatDateTime`)

/// Locale + timezone-aware timestamp formatter — the port of the web
/// `useDateFormat().formatDateTime` (lib `formatDateTime`: `{year:numeric, month:short,
/// day:numeric, hour:2-digit, minute:2-digit}` → medium date + short time), returning the
/// em-dash sentinel for a nil/invalid value exactly like the web helper.
public enum UpdateAvailableFormat {
    public static let dash = "—"

    public static func dateTime(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver summary for the callout (web reads the heading, then the body, then
/// the freshness note). Pure + public so the spoken content is asserted without rendering.
public enum UpdateAvailableAccessibility {
    /// The combined status label: heading, then body, then the freshness note when present.
    public static func summary(heading: String, body: String, freshnessNote: String?) -> String {
        var parts = [heading, body]
        if let freshnessNote, !freshnessNote.isEmpty { parts.append(freshnessNote) }
        return parts.joined(separator: ". ")
    }
}
