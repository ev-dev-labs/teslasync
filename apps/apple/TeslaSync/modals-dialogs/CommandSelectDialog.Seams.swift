//
//  CommandSelectDialog.Seams.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  The dependency seams the CommandSelectDialog view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the select / cancel command seam (web
//  `onSelect` / `onClose`), the coalesced source snapshot, the P1/S8 source protocol + an in-memory
//  source for previews / tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver
//  string builders. No view reads the store, persistence, or navigation directly — it only ever
//  talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol CommandSelectTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogCommandSelectTelemetry: CommandSelectTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Select / cancel command seam (web `onSelect` / `onClose`)

/// The dialog's two decisions. `select(value:)` is the web `onSelect(opt.value)` — the parent
/// forwards the chosen value to its command dispatch (the native seam awaits it so the in-flight
/// `submitting` state can drive the per-option spinner + disable the list, the parity of the web
/// `loading` prop). `cancel()` is the web `onClose` (Cancel button / Escape / backdrop). Keeps the
/// command plumbing out of the view; the production app injects an adapter over the caller's
/// handlers, previews / tests use the logging / spy defaults.
public protocol CommandSelectController: Sendable {
    /// Send the chosen option value (web `onSelect`). Awaited so the dialog can show the in-flight
    /// state on the tapped option.
    func select(_ value: String) async
    /// Dismiss without choosing (web `onClose`).
    func cancel()
}

/// `os.Logger`-backed default that records the decisions without dispatching a command, so previews
/// render safely. The chosen value is logged at `.private` since command parameters can be sensitive.
public struct OSLogCommandSelectController: CommandSelectController {
    private let logger: Logger
    private let surface = CommandSelectSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "command")
    }

    public func select(_ value: String) async {
        logger.info("command.select surface=\(surface, privacy: .public) value=\(value, privacy: .private)")
    }

    public func cancel() {
        logger.info("command.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `CommandSelectSource`: the delivery status, the resolved select
/// request, the live-state freshness, the in-flight background-reload flag, and the last-updated
/// timestamp.
public struct CommandSelectUpdate: Sendable, Equatable {
    public var status: CommandSelectLoadStatus
    public var request: CommandSelectRequest?
    public var connection: CommandSelectConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: CommandSelectLoadStatus = .loading,
        request: CommandSelectRequest? = nil,
        connection: CommandSelectConnection = .live,
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

/// The seam the view binds through. Production implements this over the shared P1/S8 command
/// coordinator (the command-center tile that opened the picker resolves its `def` + `selectConfig`
/// and the vehicle's live-state freshness); previews / tests use `InMemoryCommandSelectSource`. The
/// view never talks to persistence or the network.
@MainActor
public protocol CommandSelectSource: AnyObject {
    var onUpdate: (@MainActor (CommandSelectUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the pending request (web refetch / the error-state retry / the stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCommandSelectSource: CommandSelectSource {
    public var onUpdate: (@MainActor (CommandSelectUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CommandSelectUpdate?

    public init(initial: CommandSelectUpdate? = nil) {
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
    public func push(_ update: CommandSelectUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "CommandSelectDialog" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum CommandSelectStrings {
    public static let table = "CommandSelectDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver builders)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum CommandSelectAccessibility {
    /// The dialog's region label (web `Modal` `aria-labelledby` heading) — the request title, or the
    /// localized "Select an option" fallback when none is set.
    public static func summary(
        request: CommandSelectRequest?,
        localize: (String, String) -> String
    ) -> String {
        CommandSelectProjection.title(request, localize: localize)
    }

    /// An option row's VoiceOver label: the label followed by its description, so the whole option is
    /// read as one phrase (web button label + description span). The busy suffix is appended while
    /// that option is being sent so VoiceOver announces the in-flight state.
    public static func optionLabel(
        label: String,
        description: String?,
        busy: Bool,
        localize: (String, String) -> String
    ) -> String {
        var phrase = label
        if let description, !description.isEmpty {
            phrase += ", \(description)"
        }
        if busy {
            phrase += ", \(localize("command.select.a11y.busy", "Sending…"))"
        }
        return phrase
    }

    /// The close affordance's VoiceOver label (web `Modal` "×").
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("command.select.a11y.close", "Close")
    }
}
