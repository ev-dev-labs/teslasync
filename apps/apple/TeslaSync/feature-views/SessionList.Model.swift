//
//  SessionList.Model.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SessionList` is a
//  controlled component — its parent owns `sessions`, `activeSessionId`, `isLoading`,
//  and the select / new / rename / delete callbacks, while the component itself owns
//  the inline-rename + pending-delete view state. The native surface reproduces that
//  whole lifecycle here: a `ChatSessionListSource` pushes the resolved sessions + load
//  / freshness status, the model owns the view-local rename + delete state, and every
//  mutation routes through the injected `ChatSessionListActions` seam. No networking
//  lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ChatSessionListSource`, holds
/// the latest sessions + freshness + the inline-rename / pending-delete state, exposes
/// the resolved `ChatSessionListPhase` for SwiftUI to switch over, forwards user
/// intents to the action seam, and emits the P1/S11 `view.opened` event once on first
/// appearance.
@MainActor
@Observable
public final class ChatSessionListModel {
    // Load + freshness (from the source)
    public private(set) var phase: ChatSessionListPhase = .loading
    public private(set) var connection: ChatSessionListConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var items: [ChatSessionListItem] = []
    public private(set) var activeID = ""

    // View-local control state (web `renamingId` / `renameDraft` / `pendingDelete`)
    public private(set) var renamingID: String?
    public var renameDraft = ""
    public private(set) var pendingDelete: ChatSessionListItem?

    @ObservationIgnored private let source: any ChatSessionListSource
    @ObservationIgnored private let telemetry: any ChatSessionListTelemetry
    @ObservationIgnored private let actions: any ChatSessionListActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ChatSessionListSource,
        telemetry: any ChatSessionListTelemetry = OSLogChatSessionListTelemetry(),
        actions: any ChatSessionListActions = LoggingChatSessionListActions(),
        localize: @escaping (String, String) -> String = ChatSessionListStrings.string,
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived state

    /// Whether the resolved list has no sessions (web `sessions.length === 0`).
    public var isEmpty: Bool {
        items.isEmpty
    }

    /// Whether the row is the active conversation (web `session.id === activeSessionId`).
    public func isActive(_ item: ChatSessionListItem) -> Bool {
        item.id == activeID
    }

    /// Whether the row is currently being renamed inline (web `session.id === renamingId`).
    public func isRenaming(_ item: ChatSessionListItem) -> Bool {
        item.id == renamingID
    }

    /// The visible row title (web `displayTitle`).
    public func displayTitle(_ item: ChatSessionListItem) -> String {
        ChatSessionListProjection.displayTitle(item, localize: localize)
    }

    /// The row subtitle: last-activity phrase + message count (web subtitle span).
    public func subtitle(_ item: ChatSessionListItem) -> String {
        ChatSessionListProjection.subtitle(item, now: now(), localize: localize)
    }

    /// One row's VoiceOver label (title + subtitle + active suffix).
    public func rowAccessibilityLabel(_ item: ChatSessionListItem) -> String {
        ChatSessionListAccessibility.rowLabel(
            item,
            isActive: isActive(item),
            now: now(),
            localize: localize
        )
    }

    /// The sidebar VoiceOver summary (web `Sessions` header + count).
    public var accessibilitySummary: String {
        ChatSessionListAccessibility.listSummary(count: items.count, localize: localize)
    }

    /// The delete confirmation title (web `chatbot.delete.title`).
    public var deleteConfirmTitle: String {
        localize("chatbot.delete.title", "Delete conversation?")
    }

    /// The delete confirmation body (web `chatbot.delete.message`).
    public var deleteConfirmMessage: String {
        localize(
            "chatbot.delete.message",
            "This will permanently remove this conversation and all its messages."
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChatSessionListSurface.slug)
        source.start()
    }

    /// Stops observing the upstream sessions feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Intents (web callbacks)

    /// Selects a session (web `onSelect`). Renaming a row suppresses selection,
    /// exactly like the web inline-edit field replacing the row button.
    public func selectSession(_ item: ChatSessionListItem) {
        guard !isRenaming(item) else { return }
        actions.selectSession(id: item.id)
    }

    /// Starts a new conversation (web `onNewChat`).
    public func newChat() {
        actions.newChat()
    }

    /// Begins an inline rename, seeding the draft with the current display title
    /// (web `startRename` → `setRenameDraft(displayTitle(session))`).
    public func startRename(_ item: ChatSessionListItem) {
        renamingID = item.id
        renameDraft = displayTitle(item)
    }

    /// Commits the inline rename when the trimmed draft is non-empty, then exits edit
    /// mode (web `commitRename`: only calls `onRename` for a non-empty trimmed value).
    public func commitRename() {
        guard let id = renamingID else { return }
        if let trimmed = ChatSessionListProjection.trimmedNonEmpty(renameDraft) {
            actions.renameSession(id: id, title: trimmed)
        }
        renamingID = nil
        renameDraft = ""
    }

    /// Cancels the inline rename (web `cancelRename`).
    public func cancelRename() {
        renamingID = nil
        renameDraft = ""
    }

    /// Opens the delete confirmation for a session (web `setPendingDelete`).
    public func requestDelete(_ item: ChatSessionListItem) {
        pendingDelete = item
    }

    /// Confirms the pending delete (web `onConfirm` → `onDelete(pendingDelete.id)`).
    public func confirmDelete() {
        guard let target = pendingDelete else { return }
        actions.deleteSession(id: target.id)
        pendingDelete = nil
    }

    /// Dismisses the delete confirmation (web `onCancel`).
    public func cancelDelete() {
        pendingDelete = nil
    }

    // MARK: Snapshot application

    private func apply(_ update: ChatSessionListUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        activeID = update.activeID
        phase = ChatSessionListProjection.resolvePhase(update.status, totalCount: items.count)
        reconcileTransientState()
        handleAutoRefresh(for: update.connection)
    }

    /// Drops the inline-rename / pending-delete state when its target session is no
    /// longer present after a refresh.
    private func reconcileTransientState() {
        let present = Set(items.map(\.id))
        if let renamingID, !present.contains(renamingID) {
            self.renamingID = nil
            renameDraft = ""
        }
        if let pendingDelete, !present.contains(pendingDelete.id) {
            self.pendingDelete = nil
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached list on screen and does not refetch.
    private func handleAutoRefresh(for connection: ChatSessionListConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
