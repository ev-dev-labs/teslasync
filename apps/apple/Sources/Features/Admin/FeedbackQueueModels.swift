import Foundation

// MARK: - Category / status enums (web `FeedbackCategory` / `FeedbackStatus`)

/// The feedback category discriminator — the native peer of the web
/// `FeedbackCategory` union (`'bug' | 'feature' | 'other'`). The raw values match
/// the wire tokens 1:1 so the production KMP binding maps straight across, and the
/// `labelKey` / `tone` reproduce the web `CategoryBadge` variant + label map.
public enum FeedbackCategory: String, CaseIterable, Identifiable, Sendable {
    case bug
    case feature
    case other

    public var id: String {
        rawValue
    }

    /// Web `CategoryBadge` label map (`feedback.category.*`).
    public var labelKey: String {
        switch self {
        case .bug: "feedback.category.bug"
        case .feature: "feedback.category.feature"
        case .other: "feedback.category.other"
        }
    }
}

/// The triage status discriminator — the native peer of the web `FeedbackStatus`
/// union (`'new' | 'triaged' | 'closed'`). Raw values mirror the wire tokens; the
/// `labelKey` / `tone` reproduce the web `StatusBadge` variant + label map.
public enum FeedbackStatus: String, CaseIterable, Identifiable, Sendable {
    case new
    case triaged
    case closed

    public var id: String {
        rawValue
    }

    /// Web `StatusBadge` label map (`feedback.queue.status.*`).
    public var labelKey: String {
        switch self {
        case .new: "feedback.queue.status.new"
        case .triaged: "feedback.queue.status.triaged"
        case .closed: "feedback.queue.status.closed"
        }
    }
}

// MARK: - Wire value type (web `FeedbackEntry`)

/// One `user_feedback` row — the native peer of the web `FeedbackEntry` (backed by
/// `internal/handler/v1/admin_feedback_handler.go`). Field names/types mirror the
/// wire 1:1 so the production KMP binding maps straight across. Feedback metadata is
/// unit-agnostic control-plane data (no SI conversion applies); the timestamp is
/// rendered at the display boundary by `FeedbackQueueFormat`. `recentErrors` carries
/// the raw `recent_errors` JSON text (web `JSON.stringify(recent_errors)`), pretty-
/// printed for display by `FeedbackQueueFormat.prettyJSON`.
public struct FeedbackEntry: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let createdAt: String
    public let category: FeedbackCategory
    public let title: String
    public let body: String
    public let pageRoute: String
    public let userAgent: String
    public let appVersion: String
    public let userEmail: String
    public let recentErrors: String?
    public let consoleTail: String?
    public let status: FeedbackStatus
    public let githubIssueURL: String
    public let submitterSubject: String
    public let submitterIP: String

    public init(
        id: Int64,
        createdAt: String,
        category: FeedbackCategory,
        title: String = "",
        body: String = "",
        pageRoute: String = "",
        userAgent: String = "",
        appVersion: String = "",
        userEmail: String = "",
        recentErrors: String? = nil,
        consoleTail: String? = nil,
        status: FeedbackStatus,
        githubIssueURL: String = "",
        submitterSubject: String = "",
        submitterIP: String = ""
    ) {
        self.id = id
        self.createdAt = createdAt
        self.category = category
        self.title = title
        self.body = body
        self.pageRoute = pageRoute
        self.userAgent = userAgent
        self.appVersion = appVersion
        self.userEmail = userEmail
        self.recentErrors = recentErrors
        self.consoleTail = consoleTail
        self.status = status
        self.githubIssueURL = githubIssueURL
        self.submitterSubject = submitterSubject
        self.submitterIP = submitterIP
    }

    /// Web `row.submitter_subject || row.submitter_ip || '—'` — the reporter identity
    /// the expansion's "Submitter" field shows.
    public var submitterDisplay: String {
        if !submitterSubject.isEmpty { return submitterSubject }
        if !submitterIP.isEmpty { return submitterIP }
        return FeedbackQueueFormat.emptyValue
    }
}

// MARK: - List result (web `FeedbackListResponse`)

/// The paged list payload — the native peer of the web `FeedbackListResponse`
/// (`{ items, total, limit, offset, github_bridge_enabled, github_repo? }`). The
/// `githubBridgeEnabled` flag drives the "Forward to GitHub" affordance + the
/// bridge-disabled note exactly as the web `data.github_bridge_enabled` does.
public struct FeedbackListResult: Equatable, Sendable {
    public let items: [FeedbackEntry]
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let githubBridgeEnabled: Bool
    public let githubRepo: String?

    public init(
        items: [FeedbackEntry],
        total: Int,
        limit: Int,
        offset: Int,
        githubBridgeEnabled: Bool,
        githubRepo: String? = nil
    ) {
        self.items = items
        self.total = total
        self.limit = limit
        self.offset = offset
        self.githubBridgeEnabled = githubBridgeEnabled
        self.githubRepo = githubRepo
    }
}

// MARK: - Update body (web `FeedbackUpdateInput`)

/// The PATCH body for `useUpdateFeedback` — the native peer of the web
/// `FeedbackUpdateInput` (`{ status?, github_issue_url?, forward_to_github? }`). Only
/// the set fields are serialized (via `encodeIfPresent`) so a status change, a manual
/// URL save, and a bridge forward each post their single relevant key — and
/// `forwardToGitHub` serializes as a JSON **boolean**, matching the backend's
/// `ForwardToGitHub bool` field under `DisallowUnknownFields` (a JSON string would 400).
public struct FeedbackUpdate: Equatable, Sendable, Encodable {
    public var status: FeedbackStatus?
    public var githubIssueURL: String?
    public var forwardToGitHub: Bool?

    public init(
        status: FeedbackStatus? = nil,
        githubIssueURL: String? = nil,
        forwardToGitHub: Bool? = nil
    ) {
        self.status = status
        self.githubIssueURL = githubIssueURL
        self.forwardToGitHub = forwardToGitHub
    }

    /// Snake_case wire keys (anti-pattern guard #8 — never camelCase params), matching
    /// the Go `adminFeedbackPatchRequest` JSON tags.
    private enum CodingKeys: String, CodingKey {
        case status
        case githubIssueURL = "github_issue_url"
        case forwardToGitHub = "forward_to_github"
    }

    /// Ports the web PATCH body exactly: only the set fields are emitted, `status` as its
    /// raw token string and `forward_to_github` as a JSON boolean.
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(status?.rawValue, forKey: .status)
        try container.encodeIfPresent(githubIssueURL, forKey: .githubIssueURL)
        try container.encodeIfPresent(forwardToGitHub, forKey: .forwardToGitHub)
    }
}

// MARK: - Query (web `FeedbackListParams` + `buildQuery`)

/// The list query the page builds from its filter row + page (web `FeedbackListParams`).
/// Carried as a value type so the production data source maps it to the snake_case
/// query string and the model is unit-testable. Filters are snake_case on the wire
/// (anti-pattern guard #8 — never camelCase params).
public struct FeedbackQuery: Equatable, Sendable {
    /// Web `PAGE_SIZE = 25` — the fixed page window. Lives here (nonisolated) so it can
    /// default the `init` below; the `@MainActor` `FeedbackQueuePageModel.pageSize`
    /// aliases it for the view + tests.
    public static let pageSize = 25

    public var status: FeedbackStatus?
    public var category: FeedbackCategory?
    public var limit: Int
    public var offset: Int

    public init(
        status: FeedbackStatus? = nil,
        category: FeedbackCategory? = nil,
        limit: Int = FeedbackQuery.pageSize,
        offset: Int = 0
    ) {
        self.status = status
        self.category = category
        self.limit = limit
        self.offset = offset
    }

    /// Ports the web `buildQuery`: snake_case params, empty filters omitted, the page
    /// window always carried. Used by the production adapter + asserted in tests so the
    /// backend contract (`GET /admin/feedback{qs}`) is reproduced exactly.
    public var queryString: String {
        var parts: [String] = []
        if let status { parts.append("status=\(status.rawValue)") }
        if let category { parts.append("category=\(category.rawValue)") }
        parts.append("limit=\(limit)")
        parts.append("offset=\(offset)")
        return "?" + parts.joined(separator: "&")
    }
}

// MARK: - Display-boundary formatters (web `dateFormat.ts` + `formatJSON`)

/// Pure, testable display formatters ported from `web/src/lib/dateFormat.ts`
/// (`formatDateTime`) and the page's `JSON.stringify(recent_errors, null, 2)`.
/// Feedback metadata carries no SI units, so these only format at the display
/// boundary. Mirrors the sibling `AuditLogFormat`.
public enum FeedbackQueueFormat {
    /// The em-dash shown for empty / unrenderable values (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `value || '—'` — the dash fallback used across the table + expansion cells.
    public static func dash(_ value: String) -> String {
        value.isEmpty ? emptyValue : value
    }

    /// Web `formatDateTime(iso)`: en-US `MMM d, yyyy, h:mm a`; em-dash for empty / invalid.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    /// Web `JSON.stringify(value, null, 2)`: pretty-print 2-space JSON, falling back to
    /// the raw string when it does not parse; em-dash for nil / empty.
    public static func prettyJSON(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return emptyValue }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(
                  with: data,
                  options: [.fragmentsAllowed]
              ),
              let pretty = try? JSONSerialization.data(
                  withJSONObject: object,
                  options: [.prettyPrinted, .sortedKeys]
              ),
              let string = String(data: pretty, encoding: .utf8)
        else {
            return raw
        }
        return string
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the
    /// sibling Audit Log formatter.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
