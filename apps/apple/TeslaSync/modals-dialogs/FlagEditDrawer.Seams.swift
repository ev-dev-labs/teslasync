//
//  FlagEditDrawer.Seams.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  The dependency seams the FlagEditDrawer view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the save / close command seam (web
//  `onSave` / `onClose`), the coalesced source snapshot, the P1/S8 source protocol, the in-memory
//  source for previews / tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver
//  string builders. No networking or persistence lives in the view.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol FlagEditDrawerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogFlagEditDrawerTelemetry: FlagEditDrawerTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Save / close command seam (web `onSave` / `onClose`)

/// The drawer's two decisions. `save(...)` is the web `onSave({ key, value, reason })` — the parent
/// forwards the validated payload to its mutation and re-renders the drawer with `saving=true`.
/// `close()` is the web `onClose`. Keeps the action plumbing out of the view; the production app
/// injects an adapter over the caller's handlers, previews / tests use the logging / spy defaults.
public protocol FlagEditDrawerController: Sendable {
    /// Persist the edit (web `onSave`): the trimmed key, the parsed JSON value, and the trimmed
    /// audit reason.
    func save(key: String, value: FlagEditJSONValue, reason: String)
    /// Dismiss without saving (web `onClose`).
    func close()
}

/// `os.Logger`-backed default that records the decisions without performing a mutation, so previews
/// render safely. Logs only the key (the value / reason may carry operator context).
public struct OSLogFlagEditDrawerController: FlagEditDrawerController {
    private let logger: Logger
    private let surface = FlagEditDrawerSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "feature-flags")
    }

    public func save(key: String, value _: FlagEditJSONValue, reason _: String) {
        logger.info("flagEdit.save surface=\(surface, privacy: .public) key=\(key, privacy: .public)")
    }

    public func close() {
        logger.info("flagEdit.close surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `FlagEditDrawerSource`: the delivery status, the resolved
/// editor request, the live-state freshness, the in-flight background-reload flag, and the
/// last-updated timestamp.
public struct FlagEditDrawerUpdate: Sendable, Equatable {
    public var status: FlagEditLoadStatus
    public var request: FlagEditRequest?
    public var connection: FlagEditConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: FlagEditLoadStatus = .loading,
        request: FlagEditRequest? = nil,
        connection: FlagEditConnection = .live,
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

/// The seam the view binds through. Production implements this over the shared P1/S8 feature-flags
/// admin coordinator (the parent page that owns the drawer open-state + the flag registry); previews
/// / tests use `InMemoryFlagEditDrawerSource`. The view never talks to persistence or the network.
@MainActor
public protocol FlagEditDrawerSource: AnyObject {
    var onUpdate: (@MainActor (FlagEditDrawerUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the pending request (web refetch / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryFlagEditDrawerSource: FlagEditDrawerSource {
    public var onUpdate: (@MainActor (FlagEditDrawerUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FlagEditDrawerUpdate?

    public init(initial: FlagEditDrawerUpdate? = nil) {
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
    public func push(_ update: FlagEditDrawerUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "FlagEditDrawer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum FlagEditDrawerStrings {
    public static let table = "FlagEditDrawer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum FlagEditDrawerAccessibility {
    /// The drawer's region label (web `Drawer` `title`).
    public static func panelLabel(title: String) -> String {
        title
    }

    /// A labelled text field's VoiceOver phrase: the field label, then its current value (or the
    /// localized "Empty" marker so an unfilled field still announces meaningfully).
    public static func fieldLabel(label: String, value: String, localize: (String, String) -> String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "\(label), \(localize("flagEdit.a11y.empty", "Empty"))"
        }
        return "\(label), \(trimmed)"
    }

    /// The value field's VoiceOver phrase: the label plus the parse error when invalid, so VoiceOver
    /// announces why Save is disabled.
    public static func valueFieldLabel(label: String, error: String?) -> String {
        guard let error, !error.isEmpty else { return label }
        return "\(label), \(error)"
    }

    /// The immutable-key note read after the key field in edit mode.
    public static func immutableNoteLabel(_ note: String) -> String {
        note
    }
}
