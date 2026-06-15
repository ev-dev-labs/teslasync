//
//  AiConfirmDialog.Seams.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  The dependency seams the AiConfirmDialog view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract, the approve / cancel command seam (web
//  `onConfirm` / `onCancel`), the coalesced source snapshot, the P1/S8 source protocol, the in-memory
//  source for previews / tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver string
//  builders. No view reads HTTP or persistence directly — it only ever talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there).
public protocol AiConfirmTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a static,
/// non-identifying constant.
public struct OSLogAiConfirmTelemetry: AiConfirmTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Approve / cancel command seam (web `onConfirm` / `onCancel`)

/// The dialog's two decisions. `confirm()` is the web `onConfirm` — the parent forwards the approval to
/// the dispatcher's continuation endpoint (the native seam awaits it so the in-flight `submitting`
/// state can drive the spinner + disabled buttons, the parity of the web `loading` prop). `cancel()` is
/// the web `onCancel` — the parent MUST also notify the continuation endpoint that the user denied so
/// the dispatcher can release the paused state. Keeps the action plumbing out of the view; the
/// production app injects an adapter over the caller's handlers, previews / tests use the spy defaults.
public protocol AiConfirmController: Sendable {
    /// Approve the proposed tool call (web `onConfirm`). Awaited so the dialog can show the in-flight
    /// state.
    func confirm() async
    /// Deny + dismiss (web `onCancel`).
    func cancel()
}

/// `os.Logger`-backed default that records the decisions without dispatching the continuation, so
/// previews render safely.
public struct OSLogAiConfirmController: AiConfirmController {
    private let logger: Logger
    private let surface = AiConfirmSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "ai")
    }

    public func confirm() async {
        logger.info("ai.confirm.approve surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("ai.confirm.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `AiConfirmSource`: the delivery status, the resolved confirm
/// request, the live-state freshness, the in-flight background-reload flag, and the last-updated
/// timestamp.
public struct AiConfirmUpdate: Sendable, Equatable {
    public var status: AiConfirmLoadStatus
    public var request: AiConfirmRequest?
    public var connection: AiConfirmConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AiConfirmLoadStatus = .loading,
        request: AiConfirmRequest? = nil,
        connection: AiConfirmConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.request = request
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 Helix dispatcher
/// coordinator (the `confirm_request` SSE frame the paused tool call raised, plus the `loading` flag
/// the continuation POST toggles); previews / tests use `InMemoryAiConfirmSource`. The view never talks
/// to persistence or the network.
@MainActor
public protocol AiConfirmSource: AnyObject {
    var onUpdate: (@MainActor (AiConfirmUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the pending confirm request (web refetch / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAiConfirmSource: AiConfirmSource {
    public var onUpdate: (@MainActor (AiConfirmUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AiConfirmUpdate?

    public init(initial: AiConfirmUpdate? = nil) {
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
    public func push(_ update: AiConfirmUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "AiConfirmDialog" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum AiConfirmStrings {
    public static let table = "AiConfirmDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum AiConfirmAccessibility {
    /// The dialog's region label (web `Modal` title). Falls back to the localized title when an empty
    /// string is supplied.
    public static func summary(title: String, localize: (String, String) -> String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return localize(AiConfirmProjection.Keys.title, AiConfirmProjection.Fallbacks.title)
        }
        return title
    }

    /// The tool block's VoiceOver label, reading the section label and the tool name as one phrase
    /// (e.g. "Tool: lock_doors").
    public static func toolLabel(label: String, name: String) -> String {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedName.isEmpty ? label : "\(label): \(name)"
    }

    /// The arguments block's VoiceOver label (the section label; the verbatim JSON is exposed as the
    /// element's value so VoiceOver users can still inspect it).
    public static func argumentsLabel(label: String) -> String {
        label
    }

    /// The close affordance's VoiceOver label (web `Modal` "×").
    public static func close(localize: (String, String) -> String) -> String {
        localize("ai.confirm.close", "Close")
    }
}
