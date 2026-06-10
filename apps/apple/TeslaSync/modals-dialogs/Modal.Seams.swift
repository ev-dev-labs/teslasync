//
//  Modal.Seams.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  The dependency seams the Modal view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S11 telemetry contract, the dismiss command seam (web `onClose`), the
//  coalesced body snapshot, the P1/S8 source protocol, an in-memory source for previews/tests, the
//  P1/S10 i18n facade (web `t(key, default)` — here the single web literal `aria-label="Close"` plus
//  the native state-envelope copy), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol ModalTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogModalTelemetry: ModalTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Dismiss command seam (web `onClose`)

/// The surface's dismiss command (web `onClose` — invoked by the backdrop click, the close button,
/// and Esc). Keeps host/window dismissal out of the view: the production app injects an adapter that
/// pops the presentation (e.g. flips the owning `@State` / routes a navigation event); previews and
/// tests use the logging / spy defaults.
public protocol ModalDismissController: Sendable {
    func dismiss()
}

/// `os.Logger`-backed default that records the dismiss intent without touching navigation, so
/// previews run safely.
public struct OSLogModalDismissController: ModalDismissController {
    private let logger: Logger
    private let surface = ModalSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func dismiss() {
        logger.info("modal.dismiss surface=\(surface, privacy: .public)")
    }
}

// MARK: - Body snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ModalSource`: the body load status, whether the loaded body
/// has content (drives empty vs data), the live-state freshness, the in-flight flag, and the time of
/// the read.
public struct ModalUpdate: Sendable, Equatable {
    public var status: ModalBodyStatus
    public var hasContent: Bool
    public var connection: ModalConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ModalBodyStatus = .loading,
        hasContent: Bool = false,
        connection: ModalConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.hasContent = hasContent
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through (P1/S8). Production implements this over the shared state holders
/// that own the modal's body data — reporting its load status, whether it resolved to content, and
/// live-state freshness — plus a refresh affordance. Previews/tests use `InMemoryModalSource`. The
/// view never reads persistence or the network directly.
@MainActor
public protocol ModalSource: AnyObject {
    var onUpdate: (@MainActor (ModalUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-loads the body (web content refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryModalSource: ModalSource {
    public var onUpdate: (@MainActor (ModalUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ModalUpdate?

    public init(initial: ModalUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: ModalUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "Modal" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ModalStrings {
    public static let table = "Modal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum ModalAccessibility {
    /// The dialog's accessibility label (web `aria-labelledby` heading text / `aria-label` / a
    /// generic fallback when the web passes `undefined`).
    public static func dialogLabel(for label: ModalLabel, localize: (String, String) -> String) -> String {
        switch label {
        case let .titled(title):
            title
        case let .anonymous(ariaLabel):
            ariaLabel
        case .untitled:
            localize("modal.dialog", "Dialog")
        }
    }

    /// The VoiceOver summary for the current body phase, so assistive tech announces what the modal
    /// body is conveying rather than leaving it silent.
    public static func summary(for phase: ModalBodyPhase, localize: (String, String) -> String) -> String {
        switch phase {
        case .loading:
            localize("modal.a11y.loading", "Loading")
        case .empty:
            localize("modal.empty.title", "Nothing to show")
        case .error:
            localize("modal.error.title", "Something went wrong")
        case .data:
            localize("modal.a11y.content", "Dialog content")
        }
    }
}
