//
//  SessionList.Adapter.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  The testable projection core for the chatbot session-sidebar surface — the
//  faithful port of features/system/components/chatbot/SessionList.tsx and the lib
//  helpers it consumes (lib/dateFormat.ts:formatRelative for the row subtitle, and
//  the in-component `displayTitle` resolver). Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web `SessionList` is a CONTROLLED component: the parent owns `sessions`,
//      `activeSessionId`, `isLoading`, and the select / new / rename / delete
//      callbacks. The native surface reproduces that lifecycle from one canonical
//      `[ChatSessionListItem]` pushed by the bound source plus the view-local rename
//      / delete state the model holds, so the row title / subtitle derivations are
//      computed here and unit-tested once.
//    • The native surface widens the web loading / empty branches with the page-owned
//      error + freshness (stale / offline) envelope every real-time surface shows
//      (ADR-013), so no required state is ever hidden behind a blank panel.
//

import Foundation

// MARK: - Render phase / load status / freshness

/// What the surface should render at the top level. The web splits
/// `isLoading && !sessions.length` (loading) / `!sessions.length` (empty) /
/// otherwise (the list); the native surface adds the page-owned `error` envelope so
/// a fetch failure is a first-class state rather than a blank panel.
public enum ChatSessionListPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the sessions query (web `isLoading` / resolved
/// / failure).
public enum ChatSessionListLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached list is clearly labeled while reconnecting / offline.
public enum ChatSessionListConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Session item (the display-ready row)

/// One chat session projected to the fields the row needs — the native parity of the
/// web `ChatSessionInfo` (`api/types.ts`). The display title + subtitle are derived
/// at the read boundary by `ChatSessionListProjection`, exactly like the web
/// `displayTitle` + `formatRelative`.
public struct ChatSessionListItem: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String?
    public var firstMessage: String?
    public var messageCount: Int
    public var lastMessageAt: Date?
    public var createdAt: Date?

    public init(
        id: String,
        title: String? = nil,
        firstMessage: String? = nil,
        messageCount: Int = 0,
        lastMessageAt: Date? = nil,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.firstMessage = firstMessage
        self.messageCount = messageCount
        self.lastMessageAt = lastMessageAt
        self.createdAt = createdAt
    }
}

// MARK: - Projection core (pure)

/// The dependency-free pipeline from a raw item + load status to the rendered row
/// copy — the faithful port of the web `displayTitle` resolver and the
/// `formatRelative` subtitle. All copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the projection is testable without a bundle,
/// exactly like the views' P1/S10 facade.
public enum ChatSessionListProjection {
    /// The maximum first-message length used as a sidebar title before it is
    /// ellipsized (web `first.length > 60 ? first.slice(0, 60) + '…'`).
    public static let titlePreviewLimit = 60

    /// Resolves the top-level render phase from the load status and whether any
    /// sessions are present (web `isLoading && !sessions.length` → loading;
    /// `!sessions.length` → empty; otherwise the list). Cached items survive a
    /// refresh / failure (freshness shown by the chip + banner), so a non-empty list
    /// always renders as content.
    public static func resolvePhase(
        _ status: ChatSessionListLoadStatus,
        totalCount: Int
    ) -> ChatSessionListPhase {
        let hasData = totalCount > 0
        switch status {
        case .loading:
            return hasData ? .content : .loading
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }

    /// The visible title for a session: explicit title → first user message
    /// (ellipsized) → the localized "Untitled conversation" — a faithful port of the
    /// web `displayTitle`.
    public static func displayTitle(
        _ item: ChatSessionListItem,
        localize: (String, String) -> String
    ) -> String {
        if let title = trimmedNonEmpty(item.title) {
            return title
        }
        if let first = trimmedNonEmpty(item.firstMessage) {
            return first.count > titlePreviewLimit
                ? String(first.prefix(titlePreviewLimit)) + "…"
                : first
        }
        return localize("chatbot.session.untitled", "Untitled conversation")
    }

    /// The row subtitle: the last-activity label (relative time, or the localized
    /// "Empty" when never messaged) joined to the message count — the parity of the
    /// web `{last_message_at ? formatRelative(…) : t('…empty')}{' · '}{t('…count')}`.
    public static func subtitle(
        _ item: ChatSessionListItem,
        now: Date,
        localize: (String, String) -> String
    ) -> String {
        let activity = item.lastMessageAt
            .map { relativeLabel(for: $0, now: now, localize: localize) }
            ?? localize("chatbot.session.empty", "Empty")
        return "\(activity) · \(messageCountLabel(item.messageCount, localize: localize))"
    }

    /// The pluralized message-count label (web `t('chatbot.session.messageCount',
    /// '{{count}} msgs', { count })`), with the `{{count}}` token substituted.
    public static func messageCountLabel(
        _ count: Int,
        localize: (String, String) -> String
    ) -> String {
        localize("chatbot.session.messageCount", "{{count}} msgs")
            .replacingOccurrences(of: "{{count}}", with: "\(max(0, count))")
    }

    /// A localized relative-time label with the web `formatRelative` thresholds:
    /// `< 60s` → "Just now", `< 60m` → "{n}m ago", `< 24h` → "{n}h ago",
    /// `< 7d` → "{n}d ago", otherwise an absolute medium date. `now` is injected so
    /// the thresholds are deterministic under test.
    public static func relativeLabel(
        for date: Date,
        now: Date,
        localize: (String, String) -> String
    ) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return localize("chatbot.session.justNow", "Just now")
        }
        let minutes = seconds / 60
        if minutes < 60 {
            return countLabel("chatbot.session.minutesAgo", "{{count}}m ago", minutes, localize)
        }
        let hours = minutes / 60
        if hours < 24 {
            return countLabel("chatbot.session.hoursAgo", "{{count}}h ago", hours, localize)
        }
        let days = hours / 24
        if days < 7 {
            return countLabel("chatbot.session.daysAgo", "{{count}}d ago", days, localize)
        }
        return ChatSessionDateFormat.medium.string(from: date)
    }

    /// Substitutes the `{{count}}` token in a localized relative-time template.
    private static func countLabel(
        _ key: String,
        _ fallback: String,
        _ value: Int,
        _ localize: (String, String) -> String
    ) -> String {
        localize(key, fallback).replacingOccurrences(of: "{{count}}", with: "\(value)")
    }

    /// Trims a value and returns it only when non-empty (web `x && x.trim()`).
    public static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else {
            return nil
        }
        return trimmed
    }
}

// MARK: - Date formatting

/// Shared medium date + short time formatter for the absolute relative-time fallback
/// and the row accessibility label.
public enum ChatSessionDateFormat {
    public static let medium: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the
/// dependency-free core so the projection's unit tests can reach it.
public enum ChatSessionListSurface {
    public static let slug = "SessionList"
}
