//
//  SessionList.Seams.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  The dependency seams the SessionList view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n
//  facade (web `useTranslation`), the action seam (web `onSelect` / `onNewChat` /
//  `onRename` / `onDelete` callbacks), the coalesced source snapshot, the P1/S8
//  source protocol, the in-memory source for previews/tests, and the VoiceOver string
//  builder. No networking lives in the view — every mutation routes through a seam.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted
/// there.
public protocol ChatSessionListTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogChatSessionListTelemetry: ChatSessionListTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "SessionList" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings.
public enum ChatSessionListStrings {
    public static let table = "SessionList"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Action seam (web `onSelect` / `onNewChat` / `onRename` / `onDelete`)

/// Receives the user intents the web `SessionList` raises to its parent: selecting a
/// session, starting a new chat, committing a rename, and deleting a session. The
/// production app wires these to the shared chatbot state holder + mutations; the
/// default logs them so the surface composes (and renders every state) without a host
/// and performs no networking itself.
@MainActor
public protocol ChatSessionListActions {
    func selectSession(id: String)
    func newChat()
    func renameSession(id: String, title: String)
    func deleteSession(id: String)
}

/// `os.Logger`-backed default action sink (no networking; previews / standalone use).
@MainActor
public struct LoggingChatSessionListActions: ChatSessionListActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "chatbot-sessions")
    }

    public func selectSession(id: String) {
        logger.debug("chatbot.session.select id=\(id, privacy: .public)")
    }

    public func newChat() {
        logger.debug("chatbot.session.new")
    }

    public func renameSession(id: String, title: String) {
        logger.info("chatbot.session.rename id=\(id, privacy: .public) len=\(title.count, privacy: .public)")
    }

    public func deleteSession(id: String) {
        logger.info("chatbot.session.delete id=\(id, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ChatSessionListSource`: the resolved sessions,
/// the active selection, the load status, the live-state freshness, the in-flight
/// flag, and the last update time. The view never talks to the network directly.
public struct ChatSessionListUpdate: Sendable, Equatable {
    public var status: ChatSessionListLoadStatus
    public var items: [ChatSessionListItem]
    public var activeID: String
    public var connection: ChatSessionListConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ChatSessionListLoadStatus = .loading,
        items: [ChatSessionListItem] = [],
        activeID: String = "",
        connection: ChatSessionListConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.items = items
        self.activeID = activeID
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// chatbot state holder; previews/tests use `InMemoryChatSessionListSource`. The view
/// never talks to the network directly.
@MainActor
public protocol ChatSessionListSource: AnyObject {
    var onUpdate: (@MainActor (ChatSessionListUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a caller push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryChatSessionListSource: ChatSessionListSource {
    public var onUpdate: (@MainActor (ChatSessionListUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChatSessionListUpdate?

    public init(initial: ChatSessionListUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: ChatSessionListUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the views' P1/S10 facade.
public enum ChatSessionListAccessibility {
    /// The sidebar's VoiceOver summary: the "Sessions" header + the conversation
    /// count.
    public static func listSummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("chatbot.sessions", "Sessions")
        return "\(title): \(max(0, count))"
    }

    /// One row's VoiceOver label: the resolved title, the last-activity phrase, the
    /// message count, and an "active" suffix for the selected conversation — each
    /// resolved through the same facade the row renders with.
    public static func rowLabel(
        _ item: ChatSessionListItem,
        isActive: Bool,
        now: Date,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = [
            ChatSessionListProjection.displayTitle(item, localize: localize),
            ChatSessionListProjection.subtitle(item, now: now, localize: localize)
        ]
        if isActive {
            parts.append(localize("chatbot.aria.activeSession", "Active conversation"))
        }
        return parts.joined(separator: ", ")
    }
}
