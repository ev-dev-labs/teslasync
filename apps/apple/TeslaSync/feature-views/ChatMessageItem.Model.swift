//
//  ChatMessageItem.Model.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the chat message row. The view binds through `ChatMessageModel`; no
//  networking lives in the view. The web source (ChatMessageItem.tsx) is a pure
//  presentational leaf fed a `message` prop plus grouping/position flags and the
//  `onRegenerate` / `onEditAndResend` callbacks by its parent (the Chatbot page), so
//  the input snapshot here carries those rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (user text vs. assistant
//  markdown, the inline editor, the streaming cursor, the hover action row gated by
//  position). On top of those, this surface honours the P4 leaf contract: a `phase`
//  (loading / empty / error / data) fed by the parent's lifecycle, and an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a banner with a one-shot
//  auto-refresh on the stale transition. The inline-edit interaction (begin / cancel
//  / commit) is modelled here so it is unit tested without the view.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the
/// shared-core diagnostics sink (consent-gated + redacted there).
public protocol ChatMessageTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogChatMessageTelemetry: ChatMessageTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound row — the orthogonal connectivity axis rendered as the
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum ChatConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the Chatbot page)

/// One coalesced snapshot of the row's inputs — the native mirror of the web props
/// (`message`, the `isFirst/LastInGroup`, `isLastAssistant`, `isLastUser`,
/// `actionsDisabled`, and the presence of the `onRegenerate` / `onEditAndResend`
/// callbacks) plus the parent surface's lifecycle (`isLoading`, an error message, and
/// connectivity).
public struct ChatMessageInput: Sendable, Equatable {
    public var message: ChatMessageData?
    public var isFirstInGroup: Bool
    public var isLastInGroup: Bool
    public var isLastAssistant: Bool
    public var isLastUser: Bool
    public var actionsDisabled: Bool
    public var regenerateEnabled: Bool
    public var editEnabled: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ChatConnection

    public init(
        message: ChatMessageData? = nil,
        isFirstInGroup: Bool = true,
        isLastInGroup: Bool = true,
        isLastAssistant: Bool = false,
        isLastUser: Bool = false,
        actionsDisabled: Bool = false,
        regenerateEnabled: Bool = true,
        editEnabled: Bool = true,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ChatConnection = .live
    ) {
        self.message = message
        self.isFirstInGroup = isFirstInGroup
        self.isLastInGroup = isLastInGroup
        self.isLastAssistant = isLastAssistant
        self.isLastUser = isLastUser
        self.actionsDisabled = actionsDisabled
        self.regenerateEnabled = regenerateEnabled
        self.editEnabled = editEnabled
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the row's render branches.
/// `phase` selects the body; the role, the avatar/timestamp/action gates, the
/// streaming flag, and the regenerate/edit affordances are pre-computed so the view
/// is a pure function of this value.
public struct ChatMessageResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let message: ChatMessageData
    public let isUser: Bool
    public let showAvatar: Bool
    public let showTimestamp: Bool
    public let actionsAllowed: Bool
    public let isStreaming: Bool
    public let canRegenerate: Bool
    public let canEdit: Bool
    public let visibleText: String

    public init(
        phase: Phase,
        message: ChatMessageData,
        isUser: Bool,
        showAvatar: Bool,
        showTimestamp: Bool,
        actionsAllowed: Bool,
        isStreaming: Bool,
        canRegenerate: Bool,
        canEdit: Bool,
        visibleText: String
    ) {
        self.phase = phase
        self.message = message
        self.isUser = isUser
        self.showAvatar = showAvatar
        self.showTimestamp = showTimestamp
        self.actionsAllowed = actionsAllowed
        self.isStreaming = isStreaming
        self.canRegenerate = canRegenerate
        self.canEdit = canEdit
        self.visibleText = visibleText
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render gates plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data and every branch flag.
public enum ChatMessageProjection {
    public static func resolve(_ input: ChatMessageInput) -> ChatMessageResolved {
        let message = input.message ?? .absent
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let errorMessage = input.errorMessage, !errorMessage.isEmpty {
            return make(.error(errorMessage), input: input, message: message)
        }
        let visible = message.visibleText
        // Initial fetch (web parent `isLoading`) or no message yet.
        if input.isLoading || input.message == nil {
            return make(.loading, input: input, message: message)
        }
        // A streaming reply with no token revealed yet is still "loading".
        if message.isStreaming, ChatText.isBlank(visible) {
            return make(.loading, input: input, message: message)
        }
        // A resolved message with no content is the empty render (never a blank box).
        if !message.isStreaming, ChatText.isBlank(visible) {
            return make(.empty, input: input, message: message)
        }
        return make(.data, input: input, message: message)
    }

    private static func make(
        _ phase: ChatMessageResolved.Phase,
        input: ChatMessageInput,
        message: ChatMessageData
    ) -> ChatMessageResolved {
        let isUser = message.isUser
        return ChatMessageResolved(
            phase: phase,
            message: message,
            isUser: isUser,
            // Web `showAvatar = isFirstInGroup`.
            showAvatar: input.isFirstInGroup,
            // Web `showTimestamp = isLastInGroup && !message.isStreaming`.
            showTimestamp: input.isLastInGroup && !message.isStreaming,
            // Web `showActions = !message.isStreaming && !actionsDisabled` (the
            // view ANDs the local `!editing`).
            actionsAllowed: !message.isStreaming && !input.actionsDisabled,
            isStreaming: message.isStreaming,
            // Web `!isUser && isLastAssistant && onRegenerate`.
            canRegenerate: !isUser && input.isLastAssistant && input.regenerateEnabled,
            // Web `isUser && isLastUser && onEditAndResend`.
            canEdit: isUser && input.isLastUser && input.editEnabled,
            visibleText: message.visibleText
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Chatbot page's message stream + action handlers; previews and tests use
/// `InMemoryChatMessageSource`. The view never talks to the network directly.
@MainActor
public protocol ChatMessageSource: AnyObject {
    var onUpdate: (@MainActor (ChatMessageInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func regenerate(_ message: ChatMessageData)
    func editAndResend(_ message: ChatMessageData, text: String)
}

/// The row's observable view-model. Subscribes to a `ChatMessageSource`, recomputes
/// the resolved projection, owns the inline-edit interaction, exposes the render
/// `phase` + the `connection` axis, and auto-refreshes once when the feed transitions
/// to stale.
@MainActor
@Observable
public final class ChatMessageModel {
    public private(set) var resolved: ChatMessageResolved =
        ChatMessageProjection.resolve(ChatMessageInput(isLoading: true))
    public private(set) var connection: ChatConnection = .live
    public private(set) var editing = false

    /// The inline-edit draft (web `draft` state). Bound by the editor field.
    public var draft = ""

    public var phase: ChatMessageResolved.Phase {
        resolved.phase
    }

    /// Web `submitEdit` enablement: a non-empty trimmed draft that differs from the
    /// original trimmed content.
    public var canSubmitEdit: Bool {
        ChatEdit.outcome(draft: draft, original: resolved.message.content) != .cancel
    }

    @ObservationIgnored private let source: any ChatMessageSource
    @ObservationIgnored private let telemetry: any ChatMessageTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChatMessageSource,
        telemetry: any ChatMessageTelemetry = OSLogChatMessageTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChatMessageItem.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (error retry + stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Web `startEdit`: seed the draft from the content and enter edit mode.
    public func beginEdit() {
        draft = resolved.message.content
        editing = true
    }

    /// Web `cancelEdit`: leave edit mode and restore the draft.
    public func cancelEdit() {
        editing = false
        draft = resolved.message.content
    }

    /// Web `submitEdit`: resend the trimmed draft when it changed, else cancel.
    public func commitEdit() {
        switch ChatEdit.outcome(draft: draft, original: resolved.message.content) {
        case .cancel:
            cancelEdit()
        case let .submit(text):
            source.editAndResend(resolved.message, text: text)
            editing = false
        }
    }

    /// Web `onRegenerate(message)`.
    public func regenerate() {
        source.regenerate(resolved.message)
    }

    private func apply(_ input: ChatMessageInput) {
        resolved = ChatMessageProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)` and assert
/// the recorded `regenerate` / `editAndResend` intents.
@MainActor
public final class InMemoryChatMessageSource: ChatMessageSource {
    /// One recorded edit-and-resend intent.
    public struct ResendRecord: Sendable, Equatable {
        public let message: ChatMessageData
        public let text: String
    }

    public var onUpdate: (@MainActor (ChatMessageInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var regenerated: [ChatMessageData] = []
    public private(set) var resent: [ResendRecord] = []

    private let initial: ChatMessageInput?

    public init(initial: ChatMessageInput? = nil) {
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

    public func regenerate(_ message: ChatMessageData) {
        regenerated.append(message)
    }

    public func editAndResend(_ message: ChatMessageData, text: String) {
        resent.append(ResendRecord(message: message, text: text))
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: ChatMessageInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ChatMessageItem" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum ChatStrings {
    public static let table = "ChatMessageItem"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
