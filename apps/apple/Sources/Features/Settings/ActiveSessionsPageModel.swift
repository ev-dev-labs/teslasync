import Foundation
import Observation

// MARK: - Session model (web `ActiveSession`)

/// One active browser/device session for the signed-in user. A pure value type
/// mirroring the web `ActiveSession` shape; `created_at` / `last_seen_at` are kept
/// as `Date` and formatted at the SwiftUI display boundary (never on disk).
public struct ActiveSession: Identifiable, Hashable, Sendable {
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
}

// MARK: - Data-source seam (web `useSessions` / `useRevokeSession` / `useRevokeAllOtherSessions`)

/// The terminal result of a list load. `.open` mirrors the backend 501 `AUTH_MODE_OPEN`
/// branch (session tracking needs forward-auth); `.sessions` carries the rows (possibly
/// empty). Discriminated like the web `ActiveSessionsResponse` union.
public enum SessionsLoadResult: Equatable, Sendable {
    case open
    case sessions([ActiveSession])
}

/// Supplies the active-sessions list and the two revoke mutations the page performs.
/// The production implementation binds the shared KMP `/auth/sessions` endpoints
/// (ADR-004 — the view holds no networking); previews and tests inject doubles to drive
/// every data state. Mirrors the `AuditLogDataSource` seam used by the sibling pages.
public protocol ActiveSessionsDataSource: Sendable {
    func load() async throws -> SessionsLoadResult
    func revoke(id: String) async throws
    func revokeAllOthers() async throws -> Int
}

// MARK: - Page state (web `useSessions` query phases + open-mode branch)

/// The list state for the sessions feed. `.open` is the forward-auth-required branch;
/// `.empty` is a successful load with zero rows (web `DataTable` empty message);
/// `.error` is a retryable load failure; `.loaded` carries one or more rows.
public enum ActiveSessionsState: Equatable, Sendable {
    case loading
    case open
    case empty
    case error(String)
    case loaded([ActiveSession])
}

/// Which mutation failed, so the view can surface the matching localized notice
/// (web revoke failures raise a toast rather than mutating the panel).
public enum ActiveSessionsActionError: Equatable, Sendable {
    case revoke
    case revokeAllOthers
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the list state, the per-row + bulk revoke busy flags, and the last
/// action notice, reading the feed through the injected `ActiveSessionsDataSource` seam.
@MainActor
@Observable
public final class ActiveSessionsPageModel {
    public private(set) var state: ActiveSessionsState = .loading
    public private(set) var revokingSessionID: String?
    public private(set) var isRevokingAllOthers = false
    public private(set) var actionError: ActiveSessionsActionError?

    @ObservationIgnored private let dataSource: any ActiveSessionsDataSource

    public init(dataSource: any ActiveSessionsDataSource = SampleActiveSessionsDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded sessions (empty unless the state is `.loaded`).
    public var sessions: [ActiveSession] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    /// Whether any non-current session exists (web `hasOthers` — gates the bulk button).
    public var hasOtherSessions: Bool {
        sessions.contains { !$0.current }
    }

    /// Loads the list and resolves the terminal state (web `useSessions` query).
    public func load() async {
        state = .loading
        await fetchAndApply()
    }

    /// Re-runs the load (web error-retry / refetch).
    public func refresh() async {
        await load()
    }

    /// Revokes a single session, then refetches so the row disappears (web invalidates
    /// the list rather than optimistically removing the row).
    public func revoke(_ session: ActiveSession) async {
        guard revokingSessionID == nil else { return }
        actionError = nil
        revokingSessionID = session.id
        defer { revokingSessionID = nil }
        do {
            try await dataSource.revoke(id: session.id)
            await fetchAndApply()
        } catch {
            actionError = .revoke
        }
    }

    /// Revokes every other session for the current subject, then refetches.
    public func revokeAllOthers() async {
        guard !isRevokingAllOthers else { return }
        actionError = nil
        isRevokingAllOthers = true
        defer { isRevokingAllOthers = false }
        do {
            _ = try await dataSource.revokeAllOthers()
            await fetchAndApply()
        } catch {
            actionError = .revokeAllOthers
        }
    }

    /// Clears the last action notice (web toast auto-dismiss / manual dismiss).
    public func clearActionError() {
        actionError = nil
    }

    /// Loads the feed and maps it onto the terminal state without flipping back to
    /// `.loading` — used by the revoke refetch so the list stays visible meanwhile.
    private func fetchAndApply() async {
        do {
            switch try await dataSource.load() {
            case .open:
                state = .open
            case let .sessions(rows):
                state = rows.isEmpty ? .empty : .loaded(rows)
            }
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}

// MARK: - Device label (web `describeDevice`)

/// Derives a human device label from a User-Agent string, mirroring the web
/// `describeDevice` heuristic. Brand tokens (Chrome, Windows, …) are upstream proper
/// nouns rendered verbatim; the connector + fallbacks resolve from the string catalog.
public enum SessionDeviceLabel {
    /// The browser brand token, or `nil` when none of the known families match.
    public static func browserToken(_ userAgent: String) -> String? {
        let agent = userAgent
        if agent.contains("Edg/") { return "Edge" }
        if agent.contains("OPR/") || agent.contains("Opera") { return "Opera" }
        if agent.contains("Chrome/"), !agent.contains("Chromium") { return "Chrome" }
        if agent.contains("Chromium") { return "Chromium" }
        if agent.contains("Firefox/") { return "Firefox" }
        if agent.contains("Safari/"), !agent.contains("Chrome/") { return "Safari" }
        return nil
    }

    /// The operating-system brand token, or `nil` when none of the known families match.
    public static func osToken(_ userAgent: String) -> String? {
        let agent = userAgent
        if agent.contains("Windows NT") { return "Windows" }
        if agent.contains("Mac OS X") || agent.contains("Macintosh") { return "macOS" }
        if agent.contains("Android") { return "Android" }
        if agent.contains("iPhone") || agent.contains("iPad") || agent.contains("iPod") { return "iOS" }
        if agent.contains("Linux") { return "Linux" }
        return nil
    }

    /// The composed, localized device label (web `${browser} on ${os}` with fallbacks).
    public static func text(forUserAgent userAgent: String) -> String {
        let trimmed = userAgent.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return String(localized: "sessions.device.unknown") }
        let browser = browserToken(trimmed) ?? String(localized: "sessions.device.browser")
        let osName = osToken(trimmed) ?? String(localized: "sessions.device.unknownOS")
        return String(format: String(localized: "sessions.device.format"), browser, osName)
    }
}

// MARK: - Sample seam (page/preview default until the KMP adapter is injected)

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production session data — it exists
/// so the surface renders its populated state out of the box (mirroring the sibling
/// Audit Log / Disk Forecast sample seams). Production replaces it with the
/// `/auth/sessions` adapter. Backed by an `actor` so the revoke mutations persist across
/// the model's refetch without tripping Swift 6 strict-concurrency.
public actor SampleActiveSessionsDataSource: ActiveSessionsDataSource {
    private var rows: [ActiveSession]

    public init() {
        let now = Date()
        rows = [
            ActiveSession(
                id: "sess-current",
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 "
                    + "(KHTML, like Gecko) Version/17.5 Safari/605.1.15",
                ip: "192.168.1.24",
                createdAt: now.addingTimeInterval(-3 * 3600),
                lastSeenAt: now.addingTimeInterval(-60),
                current: true
            ),
            ActiveSession(
                id: "sess-windows",
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
                ip: "10.0.4.12",
                createdAt: now.addingTimeInterval(-2 * 86400),
                lastSeenAt: now.addingTimeInterval(-5 * 3600),
                current: false
            ),
            ActiveSession(
                id: "sess-iphone",
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
                    + "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
                ip: "172.16.8.31",
                createdAt: now.addingTimeInterval(-6 * 86400),
                lastSeenAt: now.addingTimeInterval(-26 * 3600),
                current: false
            )
        ]
    }

    public func load() async throws -> SessionsLoadResult {
        .sessions(rows)
    }

    public func revoke(id: String) async throws {
        rows.removeAll { $0.id == id && !$0.current }
    }

    public func revokeAllOthers() async throws -> Int {
        let removed = rows.filter { !$0.current }.count
        rows.removeAll { !$0.current }
        return removed
    }
}
