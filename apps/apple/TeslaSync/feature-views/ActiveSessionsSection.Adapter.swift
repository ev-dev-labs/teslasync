//
//  ActiveSessionsSection.Adapter.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  The testable projection core for the active-sessions / device-management surface —
//  the faithful port of features/settings/components/ActiveSessionsSection.tsx and the
//  `describeDevice` User-Agent heuristic it embeds. Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web section has three top-level branches — loading (Spinner), open-mode
//      (the backend reported 501 AUTH_MODE_OPEN so per-device sessions can't be
//      tracked), and forward-auth (the rows + actions). `resolvePhase` reproduces
//      that exactly, widened with the prompt-required empty / error envelopes so no
//      state is ever a blank panel.
//    • `describeDevice` is a dependency-free `match` ladder over the User-Agent. The
//      detected browser/OS names are product proper nouns (never localized); only the
//      "{{browser}} on {{os}}" template + the fallbacks resolve through the injected
//      P1/S10 localizer, so the view holds no hardcoded English.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the
/// dependency-free core so the projection's unit tests can reach it.
public enum ActiveSessionsSurface {
    public static let slug = "ActiveSessionsSection"
}

// MARK: - Auth mode / render phase / load status / freshness

/// The backend's session-tracking mode (web `ActiveSessionsResponse` discriminator).
/// `open` means the install runs without a forward-auth header so per-device sessions
/// cannot be tracked; `session` carries the active rows.
public enum ActiveSessionsMode: Sendable, Equatable {
    case open
    case session
}

/// What the surface should render at the top level. The web splits
/// loading / open-mode / forward-auth; the empty + error envelopes are added so the
/// resolved-but-no-rows and fetch-failure cases never render a blank panel.
public enum ActiveSessionsPhase: Sendable, Equatable {
    case loading
    case openMode
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the sessions query (web `isLoading` / resolved
/// / failure).
public enum ActiveSessionsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached list is clearly labeled while reconnecting / offline.
public enum ActiveSessionsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Display-ready session row (web `ActiveSession`)

/// One active session / signed-in device — the native parity of the web
/// `ActiveSession` (id, user_agent, ip, created_at, last_seen_at, current). The
/// human device label is derived on demand through `ActiveSessionDevice` so the
/// heuristic is defined and tested once.
public struct ActiveSessionItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let userAgent: String
    public let ip: String
    public let createdAt: Date
    public let lastSeenAt: Date
    public let current: Bool

    public init(
        id: String,
        userAgent: String,
        ip: String,
        createdAt: Date,
        lastSeenAt: Date,
        current: Bool
    ) {
        self.id = id
        self.userAgent = userAgent
        self.ip = ip
        self.createdAt = createdAt
        self.lastSeenAt = lastSeenAt
        self.current = current
    }

    /// The heuristic "Firefox on Windows" label (web `describeDevice(user_agent)`),
    /// resolved through the injected localizer for the template + fallbacks.
    public func deviceLabel(localize: (String, String) -> String) -> String {
        ActiveSessionDevice.describe(userAgent: userAgent, localize: localize)
    }

    /// The IP address, or the em-dash fallback when absent (web `row.ip || '—'`).
    public var ipDisplay: String {
        ip.isEmpty ? "—" : ip
    }
}

// MARK: - Device descriptor (web `describeDevice`)

/// Derives a human device label from a User-Agent string — a faithful port of the
/// web `describeDevice` `match` ladder. Browser / OS names are product proper nouns
/// returned verbatim; the "{{browser}} on {{os}}" template + the three fallbacks
/// resolve through the injected P1/S10 localizer so no English literal lives in code.
public enum ActiveSessionDevice {
    public static func describe(userAgent: String, localize: (String, String) -> String) -> String {
        let userAgentValue = userAgent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userAgentValue.isEmpty else {
            return localize("sessions.device.unknown", "Unknown device")
        }
        let browser = browserName(userAgentValue, localize: localize)
        let osName = operatingSystemName(userAgentValue, localize: localize)
        return localize("sessions.device.template", "{{browser}} on {{os}}")
            .replacingOccurrences(of: "{{browser}}", with: browser)
            .replacingOccurrences(of: "{{os}}", with: osName)
    }

    /// The browser arm of the web ladder (Edge → Opera → Chrome → Chromium → Firefox
    /// → Safari), preserving the original precedence + negations.
    private static func browserName(_ userAgent: String, localize: (String, String) -> String) -> String {
        if userAgent.contains("Edg/") { return "Edge" }
        if userAgent.contains("OPR/") || userAgent.contains("Opera") { return "Opera" }
        if userAgent.contains("Chrome/"), !userAgent.contains("Chromium") { return "Chrome" }
        if userAgent.contains("Chromium") { return "Chromium" }
        if userAgent.contains("Firefox/") { return "Firefox" }
        if userAgent.contains("Safari/"), !userAgent.contains("Chrome/") { return "Safari" }
        return localize("sessions.device.browser", "Browser")
    }

    /// The OS arm of the web ladder (Windows → macOS → Android → iOS → Linux).
    private static func operatingSystemName(_ userAgent: String, localize: (String, String) -> String) -> String {
        if userAgent.contains("Windows NT") { return "Windows" }
        if userAgent.contains("Mac OS X") || userAgent.contains("Macintosh") { return "macOS" }
        if userAgent.contains("Android") { return "Android" }
        if userAgent.contains("iPhone") || userAgent.contains("iPad") || userAgent.contains("iPod") {
            return "iOS"
        }
        if userAgent.contains("Linux") { return "Linux" }
        return localize("sessions.device.os", "Unknown OS")
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source's load status + auth mode +
/// row count to the top-level render phase, plus the "are there other devices?"
/// predicate that gates the bulk "Sign out all other devices" action.
public enum ActiveSessionsProjection {
    /// Resolves the render phase. Open-mode wins regardless of status (web
    /// `!sessions.data || mode === 'open'`); otherwise loading shows only before the
    /// first rows arrive, a resolved-empty list shows the empty state, and a failure
    /// with no cached rows shows the error state — while cached rows survive a refresh
    /// / failure (freshness shown by the banner, the failure surfaced inline).
    public static func resolvePhase(
        status: ActiveSessionsLoadStatus,
        mode: ActiveSessionsMode,
        sessionCount: Int
    ) -> ActiveSessionsPhase {
        if mode == .open { return .openMode }
        let hasRows = sessionCount > 0
        switch status {
        case .loading:
            return hasRows ? .content : .loading
        case .loaded:
            return hasRows ? .content : .empty
        case let .failed(message):
            return hasRows ? .content : .error(message)
        }
    }

    /// Whether any session other than the current device exists — the web
    /// `rows.some(r => !r.current)` that gates the "Sign out all other devices"
    /// button + the bulk confirm.
    public static func hasOtherDevices(_ items: [ActiveSessionItem]) -> Bool {
        items.contains { !$0.current }
    }
}
